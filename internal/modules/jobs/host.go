package jobs

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"time"
	"unicode/utf8"

	"github.com/ravenmk2/antcdp/internal/jobcore"
	"github.com/ravenmk2/antcdp/internal/modules/collaboration"
	"github.com/ravenmk2/antcdp/internal/modules/credentials"
	"github.com/ravenmk2/antcdp/internal/modules/dingtalk"
	"github.com/ravenmk2/antcdp/internal/modules/identity"
	"github.com/ravenmk2/antcdp/internal/modules/integrations"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
	"github.com/ravenmk2/antcdp/internal/platform/resourcecode"
	"github.com/ravenmk2/antcdp/internal/statestore"
)

type runHost struct {
	s   *Service
	job Job
	run Run
	kv  statestore.KV
}

func decode(raw json.RawMessage, target any) error {
	d := json.NewDecoder(bytes.NewReader(raw))
	d.DisallowUnknownFields()
	return d.Decode(target)
}
func (h *runHost) State(ctx context.Context, method, key string, value, options json.RawMessage) (any, error) {
	var opts struct {
		IfAbsent bool            `json:"ifAbsent"`
		IfMatch  statestore.ETag `json:"ifMatch"`
	}
	if len(options) > 0 {
		if err := decode(options, &opts); err != nil {
			return nil, jobcore.Failure("INVALID_ARGUMENT", "状态条件参数无效")
		}
	}
	var result any
	var err error
	switch method {
	case "get":
		var entry statestore.Entry
		entry, err = h.kv.Get(ctx, key)
		if errors.Is(err, statestore.ErrKeyNotFound) {
			return nil, nil
		}
		if err == nil {
			var v any
			if json.Unmarshal(entry.Value, &v) != nil {
				return nil, jobcore.Failure("INVALID_STATE_VALUE", "状态不是有效 JSON")
			}
			result = map[string]any{"value": v, "etag": entry.ETag}
		}
	case "put":
		result, err = h.kv.Put(ctx, key, value, statestore.PutOptions{IfAbsent: opts.IfAbsent, IfMatch: opts.IfMatch})
	case "delete":
		if opts.IfAbsent {
			return nil, jobcore.Failure("INVALID_ARGUMENT", "删除不支持 ifAbsent")
		}
		err = h.kv.Delete(ctx, key, statestore.DeleteOptions{IfMatch: opts.IfMatch})
	}
	if errors.Is(err, statestore.ErrConflict) {
		return nil, jobcore.Failure("STATE_CONFLICT", "状态已变化")
	}
	if err != nil {
		return nil, jobcore.Failure("STATE_ERROR", "状态操作失败："+err.Error())
	}
	return result, nil
}
func cut(s string, max int) string {
	if len(s) <= max {
		return s
	}
	s = s[:max]
	for !utf8.ValidString(s) {
		s = s[:len(s)-1]
	}
	return s
}
func (h *runHost) lockRun(r Repository) (*Run, error) {
	j, err := r.Job(h.job.ID)
	if err != nil {
		return nil, err
	}
	if j == nil {
		return nil, missing()
	}
	v, err := r.Run(h.run.ID)
	if err != nil {
		return nil, err
	}
	if v == nil || v.Status != "running" {
		return nil, jobcore.Failure("RUN_STOPPING", "运行正在停止")
	}
	return v, nil
}
func (h *runHost) withResource(ctx context.Context, call *Call, fn func(identity.Tx, Repository, *Run, *collaboration.Resource) error) error {
	initial := *call
	return h.s.transaction(ctx, func(tx identity.Tx, r Repository) error {
		*call = initial
		project, authErr := collaboration.AutomationProject(tx, h.job.ProjectID, h.run.RunAsUserID)
		v, err := h.lockRun(r)
		if err != nil {
			return err
		}
		if authErr != nil {
			var failure *httpx.Error
			if !errors.As(authErr, &failure) || failure.Status >= 500 {
				return authErr
			}
			call.ErrorCode = failure.Code
			call.FinishedAt = ptr(now())
			return callLog(r, v, call)
		}
		return fn(tx, r, v, project)
	})
}
func (h *runHost) Log(ctx context.Context, level, message string, fields json.RawMessage) error {
	var object map[string]json.RawMessage
	if json.Unmarshal(fields, &object) != nil || object == nil {
		return jobcore.Failure("INVALID_LOG_FIELDS", "日志字段必须是 JSON 对象")
	}
	message, fields = boundedLog(message, object)
	return h.s.transaction(ctx, func(_ identity.Tx, r Repository) error {
		v, err := h.lockRun(r)
		if err != nil {
			return err
		}
		if v.Truncated {
			return nil
		}
		encoded, _ := json.Marshal(message)
		size := uint64(len(encoded) + len(fields))
		if v.LogCount >= 10000 || v.LogBytes+size > 10<<20 {
			v.Truncated = true
			return r.AppendLog(v, &Log{Kind: "execution", Level: "warn", Message: "脚本日志达到限额，后续脚本日志已截断"})
		}
		v.LogCount++
		v.LogBytes += size
		return r.AppendLog(v, &Log{Kind: "script", Level: level, Message: message, Fields: fields})
	})
}
func boundedLog(message string, object map[string]json.RawMessage) (string, json.RawMessage) {
	encoded, _ := json.Marshal(message)
	fields := safeJSON(object)
	if len(encoded)+len(fields) <= 16<<10 {
		return message, fields
	}
	// Budget encoded bytes, including escaped control characters. Preserve
	// smaller fields in stable key order and reserve an explicit truncation mark.
	lo, hi := 0, len(message)
	for lo < hi {
		mid := lo + (hi-lo+1)/2
		candidate, _ := json.Marshal(cut(message, mid))
		if len(candidate) <= 12<<10 {
			lo = mid
		} else {
			hi = mid - 1
		}
	}
	message = cut(message, lo)
	encoded, _ = json.Marshal(message)
	kept := map[string]json.RawMessage{"truncated": json.RawMessage(`true`)}
	keys := make([]string, 0, len(object))
	for key := range object {
		keys = append(keys, key)
	}
	slices.Sort(keys)
	for _, key := range keys {
		if key == "truncated" {
			continue
		}
		kept[key] = object[key]
		if len(encoded)+len(safeJSON(kept)) > 16<<10 {
			delete(kept, key)
		}
	}
	return message, safeJSON(kept)
}
func (h *runHost) Call(ctx context.Context, kind string, args []json.RawMessage) (any, error) {
	if kind == "agentChat" || kind == "agentSubmit" {
		var path string
		var opts AgentChatOptions
		if len(args) != 2 || decode(args[0], &path) != nil || decode(args[1], &opts) != nil || h.s.AgentChat == nil {
			return nil, jobcore.Failure("INVALID_ARGUMENT", "助手调用参数无效")
		}
		opts.WaitForReply = kind == "agentChat"
		result, err := h.s.AgentChat(ctx, h.job.ProjectID, h.run.ID, h.run.RunAsUserID, path, opts)
		var failure *httpx.Error
		if errors.As(err, &failure) {
			return nil, jobcore.Failure(failure.Code, failure.Message)
		}
		return result, err
	}
	if kind == "dingtalk" {
		return h.send(ctx, args)
	}
	return h.resource(ctx, args)
}
func callLog(r Repository, v *Run, c *Call) error {
	if err := r.SaveCall(c); err != nil {
		return err
	}
	return r.AppendLog(v, &Log{Kind: "resource", Level: "info", Message: c.Operation + ": " + c.Outcome, Fields: safeJSON(map[string]string{"outcome": c.Outcome, "error_code": c.ErrorCode}), CallID: &c.ID})
}
func callError(c Call) error {
	return &jobcore.Error{Code: c.ErrorCode, Message: c.ErrorCode, CallID: fmt.Sprint(c.ID)}
}
func (h *runHost) resource(ctx context.Context, args []json.RawMessage) (any, error) {
	var path string
	var request struct {
		Target    string          `json:"target"`
		Operation string          `json:"operation"`
		Params    json.RawMessage `json:"params"`
	}
	if len(args) != 2 || decode(args[0], &path) != nil || decode(args[1], &request) != nil || len(request.Target) > 1000 || len(request.Operation) > 64 || request.Operation == "" {
		return nil, jobcore.Failure("INVALID_ARGUMENT", "资源调用参数无效")
	}
	locator, err := resourcecode.Parse(path)
	if err != nil || (locator.ScopeKind != "platform" && locator.ScopeKind != "project") {
		return nil, jobcore.Failure("INVALID_RESOURCE_PATH", "连接路径应为 platform/连接编码 或 project/项目编码/连接编码")
	}
	call := Call{RunID: h.run.ID, Kind: "service_connection", Authorization: "account", Target: request.Target, Operation: request.Operation, Outcome: "denied", ErrorCode: "RESOURCE_ACCESS_DENIED", Snapshot: safeJSON(map[string]string{"path": locator.String()}), CreatedAt: now(), FinishedAt: ptr(now())}
	err = h.withResource(ctx, &call, func(tx identity.Tx, r Repository, v *Run, project *collaboration.Resource) error {
		ir, ok := tx.(integrations.Repository)
		if !ok {
			return errors.New("missing integrations repository")
		}
		if err := resolveResourceCall(ir, project, v.RunAsUserID, locator, &call); err != nil {
			return err
		}
		return callLog(r, v, &call)
	})
	if err != nil {
		return nil, err
	}
	return nil, callError(call)
}
func resolveResourceCall(ir integrations.Repository, project *collaboration.Resource, account uint64, locator resourcecode.Locator, call *Call) error {
	var owner uint64
	if locator.ScopeKind == "project" {
		if locator.ScopeCode != project.Code {
			return nil
		}
		owner = project.ID
	}
	conn, err := ir.ConnectionByCode(locator.ScopeKind, owner, locator.Code)
	if err != nil || conn == nil || !conn.Enabled {
		return err
	}
	allowed, err := integrations.JobConnectionAllowed(ir, conn, project.ID, account)
	if err != nil || !allowed {
		return err
	}
	call.ResourceID = &conn.ID
	call.ConnectionID = &conn.ID
	call.Snapshot = safeJSON(map[string]string{"path": locator.String(), "name": conn.Name, "code": conn.Code})
	cred, _, err := credentials.Selected(ir, "service_connection", conn.ID, credentials.Scope{Type: "user", Owner: account}, conn.Type)
	if err != nil || !cred.Usable() {
		return err
	}
	call.ConfiguredCredential = &cred.ID
	call.Outcome = "failed"
	call.ErrorCode = "RESOURCE_NOT_IMPLEMENTED"
	return nil
}
func (h *runHost) send(ctx context.Context, args []json.RawMessage) (any, error) {
	var code string
	var message dingtalk.TestInput
	options := struct {
		TimeoutMS uint64 `json:"timeoutMs"`
	}{30000}
	if len(args) < 2 || len(args) > 3 || decode(args[0], &code) != nil || decode(args[1], &message) != nil || code == "" || len(code) > 64 {
		return nil, jobcore.Failure("INVALID_MESSAGE", "机器人编码或消息参数无效")
	}
	if len(args) == 3 {
		if decode(args[2], &options) != nil || options.TimeoutMS == 0 || options.TimeoutMS > 9223372036854 {
			return nil, jobcore.Failure("INVALID_ARGUMENT", "发送超时参数无效")
		}
	}
	if err := dingtalk.ValidateMessage(message); err != nil {
		return nil, jobcore.Failure("INVALID_MESSAGE", "消息内容无效")
	}
	var auth dingtalk.Authentication
	var robot *dingtalk.Robot
	call := Call{RunID: h.run.ID, Kind: "dingtalk_robot", Authorization: "account", Target: code, Operation: "send", Outcome: "denied", ErrorCode: "ROBOT_NOT_FOUND", Snapshot: json.RawMessage(`{}`), CreatedAt: now()}
	err := h.withResource(ctx, &call, func(tx identity.Tx, r Repository, v *Run, project *collaboration.Resource) error {
		var err error
		source, ok := tx.(interface{ DingTalk() dingtalk.Repository })
		if !ok {
			return errors.New("missing robot repository")
		}
		robot, err = source.DingTalk().RobotByCode("project", project.ID, code)
		if err != nil {
			return err
		}
		if robot != nil {
			call.ResourceID = &robot.ID
			call.Snapshot = safeJSON(map[string]string{"id": fmt.Sprint(robot.ID), "scope_kind": robot.ScopeKind, "scope_id": fmt.Sprint(robot.ScopeID), "code": robot.Code, "name": robot.Name})
			call.ErrorCode = "RESOURCE_DISABLED"
			if robot.Enabled && robot.HasSecret {
				sealed, err := source.DingTalk().Secret(robot.ID)
				if err != nil {
					return err
				}
				plain, err := h.s.Cipher(fmt.Sprintf("dingtalk/robot/%d/v1", robot.ID), sealed, false)
				if err != nil || json.Unmarshal([]byte(plain), &auth) != nil {
					call.Outcome = "failed"
					call.ErrorCode = "ROBOT_AUTHENTICATION_UNAVAILABLE"
				} else {
					call.RobotVersion = &robot.MaterialVersion
					call.Outcome = "pending"
					call.ErrorCode = ""
				}
			}
		}
		if call.Outcome != "pending" {
			call.FinishedAt = ptr(now())
		}
		return callLog(r, v, &call)
	})
	if err != nil {
		return nil, err
	}
	if call.Outcome != "pending" {
		return nil, callError(call)
	}
	work, cancel := context.WithTimeout(ctx, time.Duration(options.TimeoutMS)*time.Millisecond)
	defer cancel()
	diagnostic := dingtalk.Diagnostic{Status: "failed_before_submit"}
	if work.Err() == nil {
		send := h.s.Send
		if send == nil {
			send = dingtalk.SendMessage
		}
		diagnostic = send(work, auth, message)
	}
	auth = dingtalk.Authentication{}
	call.Outcome = "failed"
	call.ErrorCode = "DINGTALK_REJECTED"
	switch diagnostic.Status {
	case "accepted":
		call.Outcome = "succeeded"
		call.ErrorCode = ""
	case "unknown":
		call.Outcome = "unknown"
		call.ErrorCode = "RESOURCE_RESULT_UNKNOWN"
	case "failed_before_submit":
		call.ErrorCode = "SEND_NOT_SUBMITTED"
	}
	persist, stop := context.WithTimeout(context.Background(), 10*time.Second)
	defer stop()
	err = h.s.transaction(persist, func(_ identity.Tx, r Repository) error {
		if _, err := r.Job(h.job.ID); err != nil {
			return err
		}
		v, err := r.Run(h.run.ID)
		if err != nil || v == nil {
			return err
		}
		c, err := r.Call(call.ID)
		if err != nil {
			return err
		}
		if c == nil {
			return missing()
		}
		if c.Outcome != "pending" {
			return nil
		}
		c.Outcome = call.Outcome
		c.ErrorCode = call.ErrorCode
		c.FinishedAt = ptr(now())
		return callLog(r, v, c)
	})
	if err != nil {
		return nil, &jobcore.Error{Code: "SEND_RESULT_UNAVAILABLE", Message: "发送可能已完成，但结果暂无法保存", CallID: fmt.Sprint(call.ID)}
	}
	if call.Outcome != "succeeded" {
		return nil, callError(call)
	}
	return map[string]any{"callId": fmt.Sprint(call.ID), "status": "accepted", "robot": map[string]string{"id": fmt.Sprint(robot.ID), "scopeKind": "project", "scopeId": fmt.Sprint(h.job.ProjectID), "code": robot.Code}}, nil
}

var _ jobcore.Host = (*runHost)(nil)
