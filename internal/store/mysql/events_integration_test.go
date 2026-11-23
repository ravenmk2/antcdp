package mysql

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/ravenmk2/antcdp/internal/modules/collaboration"
	"github.com/ravenmk2/antcdp/internal/modules/events"
	"github.com/ravenmk2/antcdp/internal/modules/identity"
	"github.com/ravenmk2/antcdp/internal/scriptadapters/sobek"
	"github.com/ravenmk2/antcdp/internal/statestore"
)

func init() {
	agentIntegrationCases = append(agentIntegrationCases, struct {
		Name string
		Run  func(*testing.T, *agentIntegrationFixture)
	}{"event_subscriptions", eventSubscriptionsIntegration})
}

func eventSubscriptionsIntegration(t *testing.T, f *agentIntegrationFixture) {
	ctx, raw := f.Context, f.AdminToken
	store := func() (identity.Store, error) { return f.Store, nil }
	s := &events.Service{Identity: f.Identity, Store: store, State: func() (statestore.Backend, error) { return f.Store.StateStore(), nil }, Executor: sobek.Executor{}}
	robot := createTestRobot(t, f)
	_, auth, err := f.Identity.User(ctx, raw, robot.ID)
	if err != nil {
		t.Fatal(err)
	}
	collab := &collaboration.Service{Identity: f.Identity}
	projects := []*collaboration.Resource{}
	for _, code := range []string{"event_primary", "event_secondary"} {
		p, _, e := collab.Create(ctx, raw, collaboration.Project, collaboration.Write{Code: code, Name: new(code), Admins: []string{fmt.Sprint(auth.User.ID)}}, identity.Metadata{})
		if e != nil {
			t.Fatal(e)
		}
		projects = append(projects, p)
		if _, e = collab.SetRobotMember(ctx, raw, robot.ID, collaboration.Project, p.ID, "member", p.MembershipETag, identity.Metadata{}); e != nil {
			t.Fatal(e)
		}
	}
	p := projects[0]
	member, reader := favoriteTestUser(t, f, "event_reader")
	if _, err = f.Store.db.ExecContext(ctx, "INSERT INTO project_member(project_id,user_id,role,created_at,updated_at) VALUES(?,?,'member',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", p.ID, member.ID); err != nil {
		t.Fatal(err)
	}
	result, err := f.Store.db.ExecContext(ctx, `INSERT INTO service_connection(service_type,ownership_type,code,name,config,created_by_user_id,created_at,updated_at) VALUES('gitlab','platform','events_fixture','Events fixture','{}',?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`, auth.User.ID)
	if err != nil {
		t.Fatal(err)
	}
	connection, _ := result.LastInsertId()
	for _, project := range projects {
		if _, err = f.Store.db.ExecContext(ctx, `INSERT INTO project_repository(project_id,connection_id,repo_id,name,full_path,last_synced_at,created_by_user_id,created_at,updated_at) VALUES(?,?,'42','Repo','org/repo',UTC_TIMESTAMP(3),?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`, project.ID, connection, auth.User.ID); err != nil {
			t.Fatal(err)
		}
	}
	options, _, err := collab.RunAccountOptions(ctx, raw, p.ID)
	if err != nil {
		t.Fatal(err)
	}
	found := map[uint64]string{}
	for _, v := range options {
		found[v.ID] = v.AccountType
	}
	if len(found) != 1 || found[robot.ID] != "robot" {
		t.Fatal("expected only the project robot", found)
	}
	_, _, err = s.Save(ctx, raw, p.ID, 0, events.Write{Name: "Member account", RunAsUserID: member.ID, EventTypes: []string{"gitlab.push"}, Script: "function main(){}"})
	modelsExpectCode(t, err, "EXECUTOR_UNAVAILABLE")
	w := events.Write{Name: "顺序消费", Enabled: true, RunAsUserID: robot.ID, EventTypes: []string{"gitlab.push", "gitlab.merge_request.created"}, MaxRetries: new(uint32(1)), Script: `async function main(ctx){ if(ctx.event.raw.fail) throw new Error("SECRET_SOURCE_LITERAL");const old=await ctx.state.get("count"); const value=(old?.value??0)+1; await ctx.state.put("count",value); ctx.log.info("processed",{value}); return "v1"; }`}
	sub, _, err := s.Save(ctx, raw, p.ID, 0, w)
	if err != nil {
		t.Fatal(err)
	}
	t.Run("source_does_not_lock_projects", func(t *testing.T) {
		// Repository management locks a project before acquiring its connection.
		management, err := f.Store.db.BeginTxx(ctx, nil)
		if err != nil {
			t.Fatal(err)
		}
		defer func() { _ = management.Rollback() }()
		var projectID uint64
		if err = management.GetContext(ctx, &projectID, "SELECT id FROM project WHERE id=? FOR UPDATE", p.ID); err != nil {
			t.Fatal(err)
		}
		receiveCtx, cancel := context.WithTimeout(ctx, 2*time.Second)
		defer cancel()
		if err = f.Store.Transact(receiveCtx, func(tx identity.Tx) error {
			if _, err := tx.(*identityTx).Connection(uint64(connection)); err != nil {
				return err
			}
			_, err := s.ReceiveGitLab(receiveCtx, tx, uint64(connection), http.Header{"X-Gitlab-Event": {"System Hook"}}, []byte(`{"object_kind":"future_event","project_id":42}`))
			return err
		}); err != nil {
			t.Fatal("ingress blocked behind a project lock", err)
		}
	})
	if _, _, err = s.Save(ctx, reader, p.ID, 0, w); err == nil {
		t.Fatal("member created subscription")
	}
	if _, _, err = s.Source(ctx, reader, p.ID, sub.ID, 0); err == nil {
		t.Fatal("member read source")
	}
	list, _, err := s.Subscriptions(ctx, reader, p.ID)
	if err != nil {
		t.Fatal(err)
	}
	encoded, _ := json.Marshal(list)
	if strings.Contains(string(encoded), "SECRET_SOURCE_LITERAL") || strings.Contains(string(encoded), `"script":`) {
		t.Fatal("public subscription leaked source")
	}
	receive := func(key string, fail bool, kind string, rollback bool) map[string]any {
		t.Helper()
		var summary map[string]any
		header := http.Header{}
		header.Set("X-Gitlab-Event", "System Hook")
		header.Set("X-Gitlab-Event-UUID", "reused-uuid")
		if key != "" {
			header.Set("webhook-id", key)
		}
		body := []byte(fmt.Sprintf(`{"object_kind":%q,"project_id":42,"ref":"refs/heads/main","fail":%t}`, kind, fail))
		abort := errors.New("fixture transaction rollback")
		err := f.Store.Transact(ctx, func(tx identity.Tx) error {
			var err error
			summary, err = s.ReceiveGitLab(ctx, tx, uint64(connection), header, body)
			if err != nil {
				return err
			}
			if rollback {
				return abort
			}
			return nil
		})
		if rollback {
			if !errors.Is(err, abort) {
				t.Fatal(err)
			}
		} else if err != nil {
			t.Fatal(err)
		}
		return summary
	}
	first := receive("", false, "push", false)
	second := receive("", false, "push", false)
	if first["event_id"] == second["event_id"] || first["scope_count"] != 2 {
		t.Fatal("legacy duplicates or project fanout lost", first, second)
	}
	keyed := receive("delivery-1", false, "push", false)
	duplicate := receive("delivery-1", false, "push", false)
	if duplicate["status"] != "duplicate" || duplicate["event_id"] != keyed["event_id"] {
		t.Fatal("delivery replay", keyed, duplicate)
	}
	if got := receive("delivery-1", true, "push", false); got["status"] != "conflict" {
		t.Fatal("changed delivery overwrote event", got)
	}
	unknown := receive("unknown", false, "future_event", false)
	if unknown["status"] != "unsupported" || unknown["queued_count"] != 0 {
		t.Fatal("unsupported dispatch", unknown)
	}
	before, _, err := s.Events(ctx, reader, p.ID, events.Filter{})
	if err != nil {
		t.Fatal(err)
	}
	receive("rolled-back", false, "push", true)
	after, _, err := s.Events(ctx, reader, p.ID, events.Filter{})
	if err != nil || len(after) != len(before) {
		t.Fatal("ingress transaction did not roll back", len(before), len(after), err)
	}
	if _, _, err = s.Events(ctx, reader, projects[1].ID, events.Filter{}); err == nil {
		t.Fatal("nonmember saw another project's events")
	}
	receive("fails", true, "push", false)
	receive("after-failure", false, "push", false)
	queued, _, err := s.Consumptions(ctx, raw, p.ID, events.Filter{SubscriptionID: sub.ID})
	if err != nil || len(queued) != 5 {
		t.Fatal("queue count", len(queued), err)
	}
	failedID, tailID := queued[1].ID, queued[0].ID
	// A new configuration applies only to newly enqueued/manual records.
	w.Version = fmt.Sprint(sub.Version)
	w.Script = `function main(){return "v2"}`
	sub, _, err = s.Save(ctx, raw, p.ID, sub.ID, w)
	if err != nil {
		t.Fatal(err)
	}
	workerCtx, cancel := context.WithCancel(ctx)
	done := make(chan struct{})
	go func() { defer close(done); s.Work(workerCtx, slog.New(slog.NewTextHandler(io.Discard, nil))) }()
	t.Cleanup(func() { cancel(); <-done })
	wait := func(id uint64, status string) *events.Consumption {
		t.Helper()
		deadline := time.Now().Add(15 * time.Second)
		for time.Now().Before(deadline) {
			run, _, e := s.Consumption(ctx, raw, p.ID, id)
			if e != nil {
				t.Fatal(e)
			}
			if run.Status == status {
				return run
			}
			time.Sleep(25 * time.Millisecond)
		}
		run, _, e := s.Consumption(ctx, raw, p.ID, id)
		t.Fatalf("consumption %d expected %s, got %+v %v", id, status, run, e)
		return nil
	}
	for i := len(queued) - 1; i >= 2; i-- {
		run := wait(queued[i].ID, "succeeded")
		if string(run.Result) != `"v1"` {
			t.Fatal("queued script revision changed", string(run.Result))
		}
	}
	failed := wait(failedID, "retry_wait")
	if failed.Attempt != 1 {
		t.Fatal("retry budget", failed)
	}
	tail, _, err := s.Consumption(ctx, raw, p.ID, tailID)
	if err != nil || tail.Attempt != 0 || tail.Status != "queued" {
		t.Fatal("retry wait did not block FIFO", tail, err)
	}
	sub, _, err = s.SetEnabled(ctx, raw, p.ID, sub.ID, fmt.Sprint(sub.Version), false)
	if err != nil {
		t.Fatal(err)
	}
	if got := receive("while-disabled", false, "push", false); got["queued_count"] != 0 {
		t.Fatal("disabled subscription enqueued", got)
	}
	if _, err = f.Store.db.ExecContext(ctx, "UPDATE event_consumption SET next_retry_at=UTC_TIMESTAMP(3) WHERE id=?", failedID); err != nil {
		t.Fatal(err)
	}
	time.Sleep(350 * time.Millisecond)
	still, _, err := s.Consumption(ctx, raw, p.ID, failedID)
	if err != nil || still.Attempt != 1 {
		t.Fatal("disabled subscription continued", still, err)
	}
	sub, _, err = s.SetEnabled(ctx, raw, p.ID, sub.ID, fmt.Sprint(sub.Version), true)
	if err != nil {
		t.Fatal(err)
	}
	failed = wait(failedID, "failed")
	if failed.Attempt != 2 {
		t.Fatal("automatic retries ignored frozen budget", failed)
	}
	wait(tailID, "succeeded")
	lines, _, err := s.Logs(ctx, reader, p.ID, failedID, 0)
	if err != nil {
		t.Fatal(err)
	}
	encoded, _ = json.Marshal(lines)
	if strings.Contains(string(encoded), "SECRET_SOURCE_LITERAL") {
		t.Fatal("VM exception leaked script literal")
	}
	if _, _, err = s.Retry(ctx, reader, p.ID, failedID); err == nil {
		t.Fatal("member manually retried")
	}
	children := make([]*events.Consumption, 2)
	errs := make([]error, 2)
	var concurrent sync.WaitGroup
	for i := range children {
		concurrent.Go(func() { children[i], _, errs[i] = s.Retry(ctx, raw, p.ID, failedID) })
	}
	concurrent.Wait()
	if errs[0] != nil || errs[1] != nil || children[0].ID != children[1].ID {
		t.Fatal("manual retry duplicated", children, errs)
	}
	child := wait(children[0].ID, "succeeded")
	if child.RevisionID != sub.RevisionID || string(child.Result) != `"v2"` || child.QueueSeq <= tail.QueueSeq {
		t.Fatal("manual retry did not append current revision", child)
	}
	// Deletion cancels pending work but keeps all source revisions and history.
	sub, _, err = s.SetEnabled(ctx, raw, p.ID, sub.ID, fmt.Sprint(sub.Version), false)
	if err != nil {
		t.Fatal(err)
	}
	w.Version = fmt.Sprint(sub.Version)
	w.Enabled = true
	w.Script = `async function main(ctx){await ctx.sleep(10000)}`
	sub, _, err = s.Save(ctx, raw, p.ID, sub.ID, w)
	if err != nil {
		t.Fatal(err)
	}
	receive("pending-delete", false, "push", false)
	sub, _, err = s.SetEnabled(ctx, raw, p.ID, sub.ID, fmt.Sprint(sub.Version), false)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.Delete(ctx, raw, p.ID, sub.ID, fmt.Sprint(sub.Version)); err != nil {
		t.Fatal(err)
	}
	if _, _, err = s.Source(ctx, raw, p.ID, sub.ID, 0); err != nil {
		t.Fatal("deleted source not retained", err)
	}
	if _, _, err = s.Retry(ctx, raw, p.ID, failedID); err != nil {
		t.Fatal("existing manual successor should remain replayable", err)
	}
	if _, err = strconv.ParseUint(keyed["event_id"].(string), 10, 64); err != nil {
		t.Fatal(err)
	}
}
