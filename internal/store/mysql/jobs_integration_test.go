package mysql

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	driver "github.com/go-sql-driver/mysql"
	"github.com/ravenmk2/antcdp/internal/jobadapters/sobek"
	"github.com/ravenmk2/antcdp/internal/modules/dingtalk"
	"github.com/ravenmk2/antcdp/internal/modules/identity"
	"github.com/ravenmk2/antcdp/internal/modules/install"
	"github.com/ravenmk2/antcdp/internal/modules/jobs"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
	"github.com/ravenmk2/antcdp/internal/statestore"
)

func testJobService(installer *install.Service) *jobs.Service {
	provider := func() (identity.Store, error) {
		if s, ok := installer.Backend().(*Store); ok {
			return s, nil
		}
		return nil, httpx.E(503, "INSTANCE_NOT_READY", "")
	}
	return &jobs.Service{Identity: identity.New(provider), Store: provider, State: func() (statestore.Backend, error) {
		if s, ok := installer.Backend().(*Store); ok {
			return s.StateStore(), nil
		}
		return nil, fmt.Errorf("not installed")
	}, Executor: sobek.Executor{}, Cipher: installer.DingTalkSecret}
}
func verifyJobs(t *testing.T, db *Store, service *jobs.Service, admin, member, outsider *apiClient, adminID, memberID string) {
	p := testData(admin.call(t, "POST", "/projects", map[string]any{"code": "job-tests", "name": "任务测试", "admin_user_ids": []string{adminID}}, 201, nil))["id"].(string)
	project := "/projects/" + p
	runner := testData(admin.call(t, "POST", "/admin/robots", map[string]string{"username": "job_runner", "display_name": "作业机器人"}, 201, nil))["id"].(string)
	runnerPath := "/admin/robots/" + runner
	// Fixture membership, then all job behavior is exercised through authenticated HTTP.
	if _, err := db.db.Exec("INSERT INTO project_member(project_id,user_id,role,created_at,updated_at) VALUES(?,?,'member',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", p, memberID); err != nil {
		t.Fatal(err)
	}
	projectInfo := testData(admin.call(t, "GET", project, nil, 200, nil))
	admin.call(t, "PUT", runnerPath+"/grants"+project, map[string]string{"role": "member"}, 204, map[string]string{"If-Match": projectInfo["membership_etag"].(string)})
	base := project + "/jobs"
	script := `async function main(ctx){const prev=ctx.state.get("计数");const n=(prev?.value??0)+1;ctx.state.put("计数",n,prev?{ifMatch:prev.etag}:{ifAbsent:true});await Promise.all([ctx.sleep(10),ctx.sleep(15)]);ctx.log.info("已完成",{n});return {n,actor:ctx.run.actorUserId};}`
	config := func(source string) map[string]any {
		return map[string]any{"run_as_user_id": runner, "script": source, "parameters": []any{}}
	}
	body := map[string]any{"code": "parallel", "name": "并行任务", "description": "测试", "enabled": true, "max_concurrency": 1, "busy_policy": "queue", "timeout_ms": 5000, "config": config(script), "grants": []any{}}
	job := testData(admin.call(t, "POST", base, body, 200, nil))
	path := base + "/" + job["id"].(string)
	humanConfig := config(script)
	humanConfig["run_as_user_id"] = adminID
	body["version"], body["config"] = job["version"], humanConfig
	admin.call(t, "PUT", path, body, 409, nil)
	admin.call(t, "POST", path+"/debug", map[string]any{"request_key": "human-debug", "config": humanConfig}, 409, nil)
	body["config"] = config(script)
	member.call(t, "GET", path, nil, 200, nil)
	outsider.call(t, "GET", path, nil, 404, nil)
	if _, visible := testData(member.call(t, "GET", path, nil, 200, nil))["config"]; visible {
		t.Fatal("script exposed to member")
	}
	member.call(t, "POST", path+"/runs", map[string]any{"request_key": "unauthorized", "inputs": map[string]any{}}, 403, nil)
	body["version"] = job["version"]
	body["grants"] = []any{map[string]string{"kind": "user", "id": memberID}}
	job = testData(admin.call(t, "PUT", path, body, 200, nil))
	// Saving unchanged content must reuse the immutable revision.
	var revisions int
	if err := db.db.Get(&revisions, "SELECT COUNT(*) FROM job_revision WHERE job_id=?", job["id"]); err != nil || revisions != 1 {
		t.Fatal("revision deduplication", revisions, err)
	}
	submit := func(client *apiClient, key string, debug bool, extra map[string]any) map[string]any {
		b := map[string]any{"request_key": key, "inputs": map[string]any{}}
		for k, v := range extra {
			b[k] = v
		}
		suffix := "/runs"
		if debug {
			suffix = "/debug"
		}
		return testData(client.call(t, "POST", path+suffix, b, 200, nil))
	}
	receipt := submit(member, "once", false, nil)
	again := submit(member, "once", false, nil)
	if receipt["run_id"] != again["run_id"] {
		t.Fatal("idempotent trigger duplicated run")
	}
	member.call(t, "POST", path+"/runs", map[string]any{"request_key": "once", "inputs": map[string]any{"other": "value"}}, 409, nil)
	first := receipt["run_id"].(string)
	// A queued run reserves the slot for skip, and accepted runs keep their revision.
	body["version"] = job["version"]
	body["busy_policy"] = "skip"
	body["config"] = config(`function main(){return "new configuration"}`)
	job = testData(admin.call(t, "PUT", path, body, 200, nil))
	skipped := submit(member, "skip", false, nil)
	if skipped["outcome"] != "skipped" || skipped["run_id"] != nil {
		t.Fatal("queued slot not reserved", skipped)
	}
	body["version"] = job["version"]
	body["busy_policy"] = "queue"
	body["config"] = config(script)
	admin.call(t, "PUT", path, body, 200, nil)
	if submit(member, "skip", false, nil)["outcome"] != "skipped" {
		t.Fatal("skipped receipt changed on replay")
	}
	var sends atomic.Int32
	service.Send = func(ctx context.Context, auth dingtalk.Authentication, input dingtalk.TestInput) dingtalk.Diagnostic {
		if auth.Token == "" || input.Body == "" {
			t.Error("missing send material")
		}
		sends.Add(1)
		return dingtalk.Diagnostic{Status: "accepted"}
	}
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() { defer close(done); service.Work(ctx, logger) }()
	defer func() { cancel(); <-done }()
	wait := func(id, status string) map[string]any {
		t.Helper()
		deadline := time.Now().Add(10 * time.Second)
		for time.Now().Before(deadline) {
			o := testData(member.call(t, "GET", path+"/runs/"+id, nil, 200, nil))
			r := o["run"].(map[string]any)
			if r["status"] == status {
				return o
			}
			if status != "running" && status != "queued" && (r["status"] == "failed" || r["status"] == "timed_out") {
				t.Fatalf("unexpected terminal run: %#v", r)
			}
			time.Sleep(25 * time.Millisecond)
		}
		t.Fatalf("run %s did not reach %s", id, status)
		return nil
	}
	observed := wait(first, "succeeded")
	result := observed["run"].(map[string]any)["result"].(map[string]any)
	if result["n"] != float64(1) || result["actor"] != memberID || observed["run"].(map[string]any)["run_as_user_id"] != runner {
		t.Fatal("state or read-only actor", result)
	}
	formalStore := observed["run"].(map[string]any)["state_store_id"]
	if formalStore == nil {
		t.Fatal("run did not retain its state store identity")
	}
	// Separate debug storage and optional real state.
	d := submit(admin, "debug-1", true, map[string]any{"config": config(script)})["run_id"].(string)
	if wait(d, "succeeded")["run"].(map[string]any)["result"].(map[string]any)["n"] != float64(1) {
		t.Fatal("debug state not isolated")
	}
	real := submit(admin, "debug-real", true, map[string]any{"config": config(script), "state_mode": "default"})["run_id"].(string)
	if wait(real, "succeeded")["run"].(map[string]any)["result"].(map[string]any)["n"] != float64(2) {
		t.Fatal("debug real state ignored")
	}
	if wait(real, "succeeded")["run"].(map[string]any)["state_store_id"] != formalStore {
		t.Fatal("real-state debug used a different store")
	}
	admin.call(t, "POST", path+"/clear-debug-state", map[string]any{}, 200, nil)
	// Service access resolves the running member's preferred credential but never decrypts it.
	conn := testData(admin.call(t, "POST", "/admin/service-connections/jenkins", map[string]any{"name": "Job 未实现适配器", "code": "job-jenkins", "config": map[string]string{"base_url": "https://jenkins.example.com"}}, 201, nil))
	grantServiceConnection(t, admin, "/admin/service-connections/jenkins/"+conn["id"].(string), "project", strings.TrimPrefix(project, "/projects/"), true)
	cred := testData(admin.call(t, "POST", runnerPath+"/credentials", map[string]any{"name": "Job 凭证", "kind": "username_password", "identifier": "build-bot", "material": map[string]string{"value": "must-never-be-decrypted"}}, 201, nil))
	preferred := runnerPath + "/service-connections/jenkins/" + conn["id"].(string) + "/credentials/preferred"
	admin.call(t, "GET", preferred, nil, 200, nil)
	admin.call(t, "PUT", preferred, map[string]any{"credential_id": cred["id"]}, 200, map[string]string{"If-Match": admin.last.Header().Get("ETag")})
	resourceScript := config(`async function main(ctx){try {await ctx.resources.call("platform/job-jenkins",{target:"example",operation:"build",params:{}})}catch(e){return e.code}}`)
	resourceID := submit(admin, "unimplemented", true, map[string]any{"config": resourceScript})["run_id"].(string)
	resourceRun := wait(resourceID, "succeeded")
	if resourceRun["run"].(map[string]any)["result"] != "RESOURCE_NOT_IMPLEMENTED" {
		t.Fatal("adapter boundary", resourceRun)
	}
	var actual int
	if err := db.db.Get(&actual, "SELECT COUNT(*) FROM job_resource_call WHERE job_run_id=? AND (credential_id IS NOT NULL OR credential_material_version IS NOT NULL)", resourceID); err != nil || actual != 0 {
		t.Fatal("unused credential marked used", err)
	}
	var platformAudit int
	if err := db.db.Get(&platformAudit, "SELECT COUNT(*) FROM job_resource_call WHERE job_run_id=? AND connection_id=? AND configured_credential_id=? AND resource_snapshot->>'$.path'=?", resourceID, conn["id"], cred["id"], "platform/job-jenkins"); err != nil || platformAudit != 1 {
		t.Fatal("platform path or selected account credential missing from audit", platformAudit, err)
	}
	projectConn := testData(admin.call(t, "POST", project+"/service-connections/jenkins", map[string]any{"name": "Project Jenkins", "code": "job-jenkins", "config": map[string]string{"base_url": "https://jenkins.example.com"}}, 201, nil))
	paths := config(`async function main(ctx){
		const request = {target:"example", operation:"build"};
		const codes = [];
		for (const args of [
			["/project:job-tests/job-jenkins", request],
			["project:other/job-jenkins", request],
			["job-jenkins", request],
			["team:other/job-jenkins", request],
			["job-jenkins", "build", request]
		]) {
			try { await ctx.resources.call(...args) } catch(e) { codes.push(e.code) }
		}
		return codes;
	}`)
	pathRun := submit(admin, "connection-paths", true, map[string]any{"config": paths})["run_id"].(string)
	if result := wait(pathRun, "succeeded")["run"].(map[string]any)["result"]; fmt.Sprint(result) != "[RESOURCE_ACCESS_DENIED RESOURCE_ACCESS_DENIED INVALID_RESOURCE_PATH INVALID_RESOURCE_PATH INVALID_ARGUMENT]" {
		t.Fatal("project path without a preferred credential, foreign scope or invalid signature", result)
	}
	var projectAudit int
	if err := db.db.Get(&projectAudit, "SELECT COUNT(*) FROM job_resource_call WHERE job_run_id=? AND connection_id=? AND configured_credential_id IS NULL AND resource_snapshot->>'$.path'=?", pathRun, projectConn["id"], "project:job-tests/job-jenkins"); err != nil || projectAudit != 1 {
		t.Fatal("same-code project connection did not resolve independently", projectAudit, err)
	}
	// Revocation is checked at the call, including runs accepted before revocation.
	delayed := config(`async function main(ctx){await ctx.sleep(2000);try {await ctx.resources.call("platform/job-jenkins",{target:"example",operation:"build",params:{}})}catch(e){return e.code}}`)
	pending := submit(admin, "connection-revoked", true, map[string]any{"config": delayed})["run_id"].(string)
	wait(pending, "running")
	grantServiceConnection(t, admin, "/admin/service-connections/jenkins/"+conn["id"].(string), "project", p, false)
	if result := wait(pending, "succeeded")["run"].(map[string]any)["result"]; result != "RESOURCE_ACCESS_DENIED" {
		t.Fatal("revoked connection remained callable", result)
	}
	revokedRun := submit(admin, "connection-revoked-new", true, map[string]any{"config": resourceScript})["run_id"].(string)
	if result := wait(revokedRun, "succeeded")["run"].(map[string]any)["result"]; result != "RESOURCE_ACCESS_DENIED" {
		t.Fatal("new run retained revoked access", result)
	}
	grantServiceConnection(t, admin, "/admin/service-connections/jenkins/"+conn["id"].(string), "project", p, true)
	// Project-scoped code uniqueness and real host send via injected transport.
	robotBody := map[string]any{"code": "notify", "name": "通知机器人", "description": "", "enabled": true, "authentication": map[string]string{"access_token": "abcdefghijklmnopqrstuvwx", "secret": "SECabcdefghijklmnopqrstuvwx"}}
	robot := testData(admin.call(t, "POST", project+"/dingtalk/robots", robotBody, 201, nil))
	admin.call(t, "POST", project+"/dingtalk/robots", robotBody, 409, nil)
	admin.call(t, "POST", "/admin/dingtalk/robots", robotBody, 201, nil)
	member.call(t, "GET", project+"/dingtalk/robots", nil, 403, nil)
	admin.call(t, "GET", "/admin/dingtalk/robots/"+robot["id"].(string), nil, 404, nil)
	notification := submit(admin, "notification", true, map[string]any{"config": config(`async function main(ctx){return await ctx.dingtalk.send("notify",{format:"text",body:"完成"})}`)})["run_id"].(string)
	o := wait(notification, "succeeded")
	if sends.Load() != 1 || len(o["calls"].([]any)) != 1 {
		t.Fatal("send/audit", sends.Load(), o)
	}
	adminObservation := testData(admin.call(t, "GET", path+"/runs/"+notification, nil, 200, nil))
	if adminObservation["calls"].([]any)[0].(map[string]any)["robot_material_version"] != "1" {
		t.Fatal("administrator cannot audit the material used", adminObservation)
	}
	if _, leaked := o["calls"].([]any)[0].(map[string]any)["robot_material_version"]; leaked {
		t.Fatal("member received administrator credential audit details")
	}
	// A caught call changes from intent to outcome in the incremental log stream;
	// later observations do not retransmit the entire call history.
	high := o["run"].(map[string]any)["last_log_seq"].(float64)
	tail := testData(member.call(t, "GET", fmt.Sprintf("%s/runs/%s?after_seq=%.0f", path, notification, high), nil, 200, nil))
	if len(tail["calls"].([]any)) != 0 || len(tail["logs"].([]any)) != 0 {
		t.Fatal("observation replayed old logs/calls", tail)
	}
	raw, _ := json.Marshal(o)
	if strings.Contains(string(raw), "abcdefghijkl") {
		t.Fatal("secret leaked")
	}
	// Missing project robot is audited and can be caught by Promise.allSettled.
	denied := submit(admin, "denied", true, map[string]any{"config": config(`async function main(ctx){return await Promise.allSettled([ctx.dingtalk.send("absent",{format:"text",body:"x"})])}`)})["run_id"].(string)
	deniedObservation := wait(denied, "succeeded")
	if deniedObservation["calls"].([]any)[0].(map[string]any)["outcome"] != "denied" {
		t.Fatal("missing denial audit")
	}
	ordinary := config(`async function main(ctx){return await ctx.dingtalk.send("notify",{format:"text",body:"x"})}`)
	memberSend := submit(admin, "member-send", true, map[string]any{"config": ordinary})["run_id"].(string)
	sendResult := wait(memberSend, "succeeded")["run"].(map[string]any)["result"].(map[string]any)
	if sendResult["status"] != "accepted" || sendResult["robot"].(map[string]any)["id"] != robot["id"] || sends.Load() != 2 {
		t.Fatal("member run did not send through the project robot", sendResult)
	}
	// Cancellation stops a long host wait and releases the same concurrency slot.
	long := submit(admin, "cancel", true, map[string]any{"config": config(`async function main(ctx){await ctx.sleep(60000)}`)})["run_id"].(string)
	wait(long, "running")
	member.call(t, "POST", path+"/runs/"+long+"/cancel", map[string]any{}, 403, nil)
	admin.call(t, "POST", path+"/runs/"+long+"/cancel", map[string]any{}, 200, nil)
	wait(long, "cancelled")
	timeout := submit(admin, "timeout", true, map[string]any{"config": config(`async function main(ctx){while(true){}}`), "timeout_ms": 100})["run_id"].(string)
	wait(timeout, "timed_out")
	// Persisted running work cannot be silently resumed after service recovery.
	cancel()
	<-done
	receipt = submit(member, "recover", false, nil)
	recoveryID := receipt["run_id"].(string)
	if _, err := db.db.Exec("UPDATE job_run SET status='running',started_at=UTC_TIMESTAMP(3) WHERE id=?", recoveryID); err != nil {
		t.Fatal(err)
	}
	ctx2, cancel2 := context.WithCancel(context.Background())
	done2 := make(chan struct{})
	go func() { defer close(done2); service.Work(ctx2, logger) }()
	defer func() { cancel2(); <-done2 }()
	recovered := wait(recoveryID, "failed")["run"].(map[string]any)
	if recovered["error_code"] != "SERVICE_INTERRUPTED" {
		t.Fatal("recovery", recovered)
	}
	// Schedule preview and durable misfire handling.
	schedule := testData(admin.call(t, "POST", path+"/schedules", map[string]any{"code": "every-minute", "name": "每分钟", "cron": "* * * * *", "timezone": "UTC", "enabled": true, "inputs": map[string]any{}}, 200, nil))
	admin.call(t, "POST", path+"/schedule-preview", map[string]string{"cron": "* * * * *", "timezone": "Asia/Shanghai"}, 200, nil)
	if _, err := db.db.Exec("UPDATE job_schedule SET next_fire_at=UTC_TIMESTAMP(3)-INTERVAL 1 SECOND WHERE id=?", schedule["id"]); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(5 * time.Second)
	for {
		var count int
		if err := db.db.Get(&count, "SELECT COUNT(*) FROM job_schedule_fire WHERE schedule_id=?", schedule["id"]); err != nil {
			t.Fatal(err)
		}
		if count == 1 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("scheduler did not persist fire")
		}
		time.Sleep(25 * time.Millisecond)
	}
	member.call(t, "GET", path+"/schedules", nil, 200, nil)
	member.call(t, "GET", path+"/schedules/"+schedule["id"].(string)+"/fires", nil, 200, nil)
	member.call(t, "POST", path+"/schedules", map[string]any{"name": "forbidden", "cron": "* * * * *", "timezone": "UTC", "inputs": map[string]any{}}, 403, nil)
	verifyScheduleCommands(t, db, service, admin, path, p, adminID, memberID, config("function main(){}"))
	// Freeze the dispatcher to make admission/disable/revocation ordering exact.
	cancel2()
	<-done2
	queued := submit(member, "disable-queued", false, nil)["run_id"].(string)
	debugQueued := submit(admin, "disabled-debug", true, map[string]any{"config": config(`function main(){return "debug"}`)})["run_id"].(string)
	job = testData(admin.call(t, "GET", path, nil, 200, nil))
	body["version"], body["enabled"] = job["version"], false
	job = testData(admin.call(t, "PUT", path, body, 200, nil))
	if wait(queued, "cancelled")["run"].(map[string]any)["error_code"] != "JOB_DISABLED" {
		t.Fatal("disabling did not atomically cancel queued formal work")
	}
	wait(debugQueued, "queued")
	// Role grants are evaluated again at claim time, not frozen on admission.
	role := testData(admin.call(t, "POST", project+"/roles", map[string]string{"name": "Job operator"}, 201, nil))
	rolePath := project + "/roles/" + role["id"].(string)
	admin.call(t, "PUT", rolePath+"/members", map[string]any{"user_ids": []string{memberID}}, 204, map[string]string{"If-Match": role["etag"].(string)})
	body["version"], body["enabled"] = job["version"], true
	body["grants"] = []any{map[string]any{"kind": "role", "id": role["id"]}}
	job = testData(admin.call(t, "PUT", path, body, 200, nil))
	// A stale editor cannot replace the saved configuration.
	admin.call(t, "PUT", path, body, 412, nil)
	revoked := submit(member, "role-revoked", false, nil)["run_id"].(string)
	legacy := submit(admin, "legacy-human", false, nil)["run_id"].(string)
	if _, err := db.db.Exec("UPDATE job_run SET run_as_user_id=? WHERE id=?", adminID, legacy); err != nil {
		t.Fatal(err)
	}
	role = testData(admin.call(t, "GET", rolePath, nil, 200, nil))
	admin.call(t, "PUT", rolePath+"/members", map[string]any{"user_ids": []string{}}, 204, map[string]string{"If-Match": role["etag"].(string)})
	member.call(t, "POST", path+"/runs", map[string]any{"request_key": "after-revoke", "inputs": map[string]any{}}, 403, nil)
	if submit(member, "role-revoked", false, nil)["run_id"] != revoked {
		t.Fatal("permission revocation prevented reading original receipt")
	}
	ctx3, cancel3 := context.WithCancel(context.Background())
	done3 := make(chan struct{})
	go func() { defer close(done3); service.Work(ctx3, logger) }()
	defer func() { cancel3(); <-done3 }()
	wait(debugQueued, "succeeded")
	if wait(legacy, "cancelled")["run"].(map[string]any)["error_code"] != "START_NOT_ALLOWED" {
		t.Fatal("legacy human run passed the execution gate")
	}
	if wait(revoked, "cancelled")["run"].(map[string]any)["error_code"] != "START_NOT_ALLOWED" {
		t.Fatal("role revocation was not rechecked")
	}
	// Search/status apply to the entire result set, and counters are read from
	// durable run state rather than client-side estimates.
	listed := testData(member.call(t, "GET", base+"?q=并行&status=enabled", nil, 200, nil))["items"].([]any)
	if len(listed) != 1 || listed[0].(map[string]any)["id"] != job["id"] {
		t.Fatal("job filtering", listed)
	}
	if len(testData(member.call(t, "GET", base+"?status=disabled", nil, 200, nil))["items"].([]any)) != 0 {
		t.Fatal("enabled job appeared in disabled filter")
	}
}

func verifyScheduleCommands(t *testing.T, db *Store, service *jobs.Service, admin *apiClient, path, projectID, adminID, memberID string, config map[string]any) {
	t.Helper()
	ctx := t.Context()
	id := func(raw string) uint64 {
		n, err := strconv.ParseUint(raw, 10, 64)
		if err != nil {
			t.Fatal(err)
		}
		return n
	}
	target := jobs.ScheduleTarget{ProjectID: id(projectID), ActorID: id(adminID), JobCode: "parallel", ScheduleCode: "notify"}
	future := time.Now().UTC().Add(time.Hour).Truncate(time.Millisecond)
	body := map[string]any{"code": "notify", "name": "Notify", "schedule_kind": "once", "run_at": future, "enabled": false, "inputs": map[string]any{}}
	admin.call(t, "POST", path+"/schedules", body, 200, nil)
	admin.call(t, "POST", path+"/schedules", body, 409, nil)
	config["parameters"] = []jobs.Parameter{{Name: "target", Label: "Target", Type: "text"}}
	base := "/projects/" + projectID + "/jobs"
	peer := testData(admin.call(t, "POST", base, map[string]any{"code": "peer-job", "name": "Peer", "enabled": true, "max_concurrency": 1, "busy_policy": "queue", "timeout_ms": 3000, "config": config}, 200, nil))
	peerPlan := testData(admin.call(t, "POST", base+"/"+peer["id"].(string)+"/schedules", body, 200, nil))
	peerTarget := target
	peerTarget.JobCode = "peer-job"
	resolved, err := service.ScheduleByCode(ctx, peerTarget)
	if err != nil || resolved.ID != id(peerPlan["id"].(string)) {
		t.Fatal("job-local code lookup", resolved, err)
	}
	expr := "0 9 * * *"
	targetCron := peerTarget
	targetCron.ScheduleCode = "daily"
	admin.call(t, "POST", base+"/"+peer["id"].(string)+"/schedules", map[string]any{"code": "daily", "name": "Daily", "cron": expr, "inputs": map[string]any{}, "max_fires": 2}, 200, nil)
	expr = "0 8 * * *"
	_, err = service.UpdateScheduleByCode(ctx, targetCron, jobs.ScheduleUpdate{ExpectedVersion: 1, RequestKey: "cron-patch", Cron: &expr, Inputs: map[string]json.RawMessage{"target": json.RawMessage(`"release"`)}})
	if err != nil {
		t.Fatal(err)
	}
	updated, err := service.ScheduleByCode(ctx, targetCron)
	var values map[string]string
	if err != nil || updated.Kind != "cron" || updated.Cron != expr || updated.MaxFires == nil || *updated.MaxFires != 2 || json.Unmarshal(updated.Inputs, &values) != nil || values["target"] != "release" {
		t.Fatal("cron update", updated, err)
	}
	read := func() jobs.Schedule {
		p, err := service.ScheduleByCode(ctx, target)
		if err != nil {
			t.Fatal(err)
		}
		return p
	}
	wantStatus := func(err error, status int) {
		t.Helper()
		var e *httpx.Error
		if !errors.As(err, &e) || e.Status != status {
			t.Fatalf("expected %d, got %v", status, err)
		}
	}
	p := read()
	for _, invalid := range []string{"max_fires=NULL", "max_fires=2", "run_at=NULL", "cron='* * * * *'", "schedule_kind='cron'", "schedule_kind='other'"} {
		_, err := db.db.Exec("UPDATE job_schedule SET "+invalid+" WHERE id=?", p.ID)
		var rejected *driver.MySQLError
		if !errors.As(err, &rejected) || rejected.Number != 3819 {
			t.Fatal("expected mode constraint violation", invalid, err)
		}
	}
	other := target
	other.ActorID = id(memberID)
	_, err = service.ScheduleByCode(ctx, other)
	wantStatus(err, 403)
	other = target
	other.JobCode = "unknown"
	_, err = service.ScheduleByCode(ctx, other)
	wantStatus(err, 404)
	enabled := true
	expr = "* * * * *"
	_, err = service.UpdateScheduleByCode(ctx, target, jobs.ScheduleUpdate{ExpectedVersion: p.Version, RequestKey: "wrong-mode", Cron: &expr})
	wantStatus(err, 422)
	_, err = service.UpdateScheduleByCode(ctx, target, jobs.ScheduleUpdate{ExpectedVersion: p.Version, RequestKey: "bad-input", Inputs: map[string]json.RawMessage{"unknown": json.RawMessage("1")}})
	wantStatus(err, 422)
	// Start at a distant time, then move the appointment while armed.
	start := jobs.ScheduleUpdate{ExpectedVersion: p.Version, RequestKey: "enable", Enabled: &enabled}
	result, err := service.UpdateScheduleByCode(ctx, target, start)
	if err != nil {
		t.Fatal(err)
	}
	due := time.Now().UTC().Add(time.Second).Truncate(time.Millisecond)
	move := jobs.ScheduleUpdate{ExpectedVersion: result.Version, RequestKey: "retime", RunAt: &due, Inputs: map[string]json.RawMessage{}}
	type reply struct {
		receipt jobs.ScheduleCommandReceipt
		err     error
	}
	replies := make(chan reply, 2)
	for range 2 {
		go func() {
			receipt, err := service.UpdateScheduleByCode(ctx, target, move)
			replies <- reply{receipt, err}
		}()
	}
	first, second := <-replies, <-replies
	if first.err != nil || second.err != nil || first.receipt != second.receipt {
		t.Fatal(first, second)
	}
	deadline := time.Now().Add(6 * time.Second)
	for p = read(); p.Enabled && time.Now().Before(deadline); p = read() {
		time.Sleep(30 * time.Millisecond)
	}
	if p.Enabled || p.Next != nil || p.FireCount != 1 || !p.RunAt.Equal(due) || p.MaxFires == nil || *p.MaxFires != 1 {
		t.Fatal("once did not finish", p)
	}
	replay, err := service.UpdateScheduleByCode(ctx, target, move)
	if err != nil || replay != first.receipt {
		t.Fatal("replay", replay, err)
	}
	conflict := move
	conflict.RunAt = &future
	_, err = service.UpdateScheduleByCode(ctx, target, conflict)
	wantStatus(err, 409)
	conflict.RequestKey = "stale-retime"
	_, err = service.UpdateScheduleByCode(ctx, target, conflict)
	wantStatus(err, 412)
	var runs int
	if err = db.db.Get(&runs, "SELECT COUNT(*) FROM job_schedule_fire WHERE schedule_id=? AND scheduled_at=? AND job_run_id IS NOT NULL", p.ID, due); err != nil || runs != 1 {
		t.Fatal("once runs", runs, err)
	}
	start.ExpectedVersion, start.RequestKey, start.RunAt = p.Version, "rearm", &future
	_, err = service.UpdateScheduleByCode(ctx, target, start)
	if err != nil {
		t.Fatal(err)
	}
	p = read()
	if !p.Enabled || p.FireCount != 0 || p.Next == nil || !p.Next.Equal(future) {
		t.Fatal("rearm", p)
	}
	disabled := false
	_, err = service.UpdateScheduleByCode(ctx, target, jobs.ScheduleUpdate{ExpectedVersion: p.Version, RequestKey: "disable", Enabled: &disabled})
	if err != nil || read().Next != nil {
		t.Fatal("disable", err)
	}
}
