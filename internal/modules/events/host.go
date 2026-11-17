package events

import (
	"bytes"
	"context"
	_ "embed"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"time"
	"unicode/utf8"

	"github.com/ravenmk2/antcdp/internal/modules/identity"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
	"github.com/ravenmk2/antcdp/internal/platform/resourcecode"
	"github.com/ravenmk2/antcdp/internal/scriptcore"
	"github.com/ravenmk2/antcdp/internal/statestore"
)

//go:embed bindings.js
var bootstrap string

var actionKey = regexp.MustCompile(`^[A-Za-z0-9_.:-]{1,128}$`)

type consumerHost struct {
	s       *Service
	attempt attempt
}

func decode(raw json.RawMessage, v any) error {
	d := json.NewDecoder(bytes.NewReader(raw))
	d.DisallowUnknownFields()
	return d.Decode(v)
}
func scriptError(err error) error {
	var h *httpx.Error
	if errors.As(err, &h) {
		return scriptcore.Failure(h.Code, h.Message)
	}
	return err
}

func (h *consumerHost) withAttempt(ctx context.Context, authorize bool, fn func(identity.Tx, Repository, *Consumption) error) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	return h.s.transaction(ctx, func(tx identity.Tx, r Repository) error {
		if authorize {
			if _, err := tx.LockUsers([]uint64{h.attempt.Revision.ExecutorID}); err != nil {
				return err
			}
			p, err := project(tx, h.attempt.Subscription.ScopeID, h.attempt.Revision.ExecutorID, true)
			if err != nil {
				return err
			}
			if p == nil || !p.IsMember || p.EndedAt != nil {
				return httpx.E(409, "EXECUTOR_ACCESS_REVOKED", "机器人已无当前项目的执行资格")
			}
			if err = robot(tx, h.attempt.Subscription.ScopeID, h.attempt.Revision.ExecutorID, true); err != nil {
				return err
			}
		}
		sub, err := r.Subscription(h.attempt.Subscription.ID, true)
		if err != nil {
			return err
		}
		if sub == nil {
			return missing()
		}
		c, err := r.Consumption(h.attempt.Consumption.ID, true)
		if err != nil {
			return err
		}
		if c == nil || c.Attempt != h.attempt.Consumption.Attempt || (c.Status != "running" && (authorize || c.Status != "stopping")) {
			return scriptcore.Failure("CONSUMPTION_STOPPING", "本次消费已结束或正在停止")
		}
		return fn(tx, r, c)
	})
}

func (h *consumerHost) input() scriptcore.Input {
	e := h.attempt.Reference.Event
	functions := map[string]scriptcore.Function{
		"sleep": {Async: true, Call: scriptcore.Sleep},
		"parsePath": {Call: func(_ context.Context, args []json.RawMessage) (any, error) {
			var path string
			if len(args) != 1 || json.Unmarshal(args[0], &path) != nil {
				return nil, scriptcore.Failure("INVALID_RESOURCE_PATH", "资源路径必须是字符串")
			}
			locator, err := resourcecode.Parse(path)
			if err != nil {
				return nil, scriptcore.Failure("INVALID_RESOURCE_PATH", err.Error())
			}
			return locator.String(), nil
		}},
	}
	for name, kind := range map[string]string{"jobStart": "jobs.start", "agentChat": "agents.chat"} {
		functions[name] = scriptcore.Function{Async: true, Call: func(ctx context.Context, args []json.RawMessage) (any, error) { return h.action(ctx, kind, args) }}
	}
	for name, method := range map[string]string{"stateGet": "get", "statePut": "put", "stateDelete": "delete"} {
		functions[name] = scriptcore.Function{Async: true, Call: func(ctx context.Context, args []json.RawMessage) (any, error) { return h.state(ctx, method, args) }}
	}
	for name, level := range map[string]string{"logInfo": "info", "logWarn": "warn", "logError": "error"} {
		functions[name] = scriptcore.Function{Call: func(ctx context.Context, args []json.RawMessage) (any, error) { return nil, h.log(ctx, level, args) }}
	}
	return scriptcore.Input{Script: h.attempt.Revision.Script, SourceName: "consumer.js", EntryPoint: "main", Bootstrap: bootstrap, Functions: functions, MaxJSONBytes: 4 << 20, Values: map[string]any{
		"event": map[string]any{"id": fmt.Sprint(e.ID), "type": e.Type, "group": e.Group, "schemaVersion": e.SchemaVersion, "source": map[string]any{"kind": e.SourceKind, "id": fmt.Sprint(e.SourceID), "messageId": e.MessageID}, "subject": map[string]any{"kind": e.SubjectKind, "id": e.SubjectID}, "occurredAt": e.OccurredAt, "receivedAt": e.ReceivedAt, "data": e.Data, "raw": e.Raw},
		"run":   map[string]any{"id": fmt.Sprint(h.attempt.Consumption.ID), "subscriptionId": fmt.Sprint(h.attempt.Subscription.ID), "revisionId": fmt.Sprint(h.attempt.Revision.ID), "scopeRefId": fmt.Sprint(h.attempt.Reference.ID), "attemptNo": h.attempt.Consumption.Attempt},
	}}
}

func (h *consumerHost) action(ctx context.Context, kind string, args []json.RawMessage) (any, error) {
	var path string
	var options map[string]json.RawMessage
	if len(args) != 2 || json.Unmarshal(args[0], &path) != nil || json.Unmarshal(args[1], &options) != nil || options == nil {
		return nil, scriptcore.Failure("INVALID_ARGUMENT", "动作需要资源路径和参数对象")
	}
	var key string
	if json.Unmarshal(options["requestKey"], &key) != nil || !actionKey.MatchString(key) {
		return nil, scriptcore.Failure("INVALID_REQUEST_KEY", "requestKey 必须为 1–128 位字母、数字或 _ . : -")
	}
	if h.s.Dispatch == nil {
		return nil, scriptcore.Failure("ACTION_UNAVAILABLE", "动作服务尚未就绪")
	}
	if err := h.withAttempt(ctx, true, func(_ identity.Tx, r Repository, c *Consumption) error {
		return r.AppendLog(c, &Log{Kind: "action", Level: "info", Message: "提交动作", Fields: safeJSON(map[string]any{"operation": kind, "path": path})})
	}); err != nil {
		return nil, scriptError(err)
	}
	out, actionErr := h.s.Dispatch(ctx, Action{Kind: kind, Path: path, Args: args[1], ProjectID: h.attempt.Subscription.ScopeID, ActorID: h.attempt.Revision.ExecutorID, SubscriptionID: h.attempt.Subscription.ID, ConsumptionID: h.attempt.Consumption.ID, Attempt: h.attempt.Consumption.Attempt})
	persist, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	logErr := h.withAttempt(persist, false, func(_ identity.Tx, r Repository, c *Consumption) error {
		level, message := "info", "动作受理完成"
		fields := map[string]any{"operation": kind, "path": path}
		if actionErr != nil {
			level, message = "error", "动作未受理"
			code, _ := failure(scriptError(actionErr))
			fields["errorCode"] = code
		} else {
			fields["receipt"] = out
		}
		return r.AppendLog(c, &Log{Kind: "action", Level: level, Message: message, Fields: safeJSON(fields)})
	})
	if actionErr != nil {
		return nil, scriptError(actionErr)
	}
	if logErr != nil {
		return nil, scriptError(logErr)
	}
	return out, nil
}

func (h *consumerHost) state(ctx context.Context, method string, args []json.RawMessage) (any, error) {
	var key string
	if len(args) == 0 || json.Unmarshal(args[0], &key) != nil || key == "" {
		return nil, scriptcore.Failure("INVALID_ARGUMENT", "状态键必须是非空字符串")
	}
	var opts struct {
		IfAbsent bool            `json:"ifAbsent"`
		IfMatch  statestore.ETag `json:"ifMatch"`
	}
	index := 1
	if method == "put" {
		index = 2
	}
	if len(args) > index {
		if err := decode(args[index], &opts); err != nil {
			return nil, scriptcore.Failure("INVALID_ARGUMENT", "状态条件参数无效")
		}
	}
	if err := h.withAttempt(ctx, true, func(identity.Tx, Repository, *Consumption) error { return nil }); err != nil {
		return nil, scriptError(err)
	}
	backend, err := h.s.State()
	if err != nil {
		return nil, err
	}
	_, kv, err := backend.OpenStore(ctx, fmt.Sprintf("event_subscription:%d", h.attempt.Subscription.ID), "default")
	if err != nil {
		return nil, err
	}
	var out any
	switch method {
	case "get":
		entry, e := kv.Get(ctx, key)
		err = e
		if errors.Is(err, statestore.ErrKeyNotFound) {
			return nil, nil
		}
		if err == nil {
			out = map[string]any{"value": json.RawMessage(entry.Value), "etag": entry.ETag}
		}
	case "put":
		if len(args) != 3 {
			return nil, scriptcore.Failure("INVALID_ARGUMENT", "状态写入缺少值")
		}
		out, err = kv.Put(ctx, key, args[1], statestore.PutOptions{IfAbsent: opts.IfAbsent, IfMatch: opts.IfMatch})
	case "delete":
		if opts.IfAbsent {
			return nil, scriptcore.Failure("INVALID_ARGUMENT", "删除不支持 ifAbsent")
		}
		err = kv.Delete(ctx, key, statestore.DeleteOptions{IfMatch: opts.IfMatch})
	}
	if errors.Is(err, statestore.ErrConflict) {
		return nil, scriptcore.Failure("STATE_CONFLICT", "状态已变化")
	}
	if err != nil {
		return nil, scriptcore.Failure("STATE_ERROR", "状态操作失败")
	}
	return out, nil
}

func (h *consumerHost) log(ctx context.Context, level string, args []json.RawMessage) error {
	var message string
	var fields map[string]json.RawMessage
	if len(args) != 2 || json.Unmarshal(args[0], &message) != nil || json.Unmarshal(args[1], &fields) != nil || fields == nil {
		return scriptcore.Failure("INVALID_LOG_FIELDS", "日志字段必须是 JSON 对象")
	}
	if len(message) > 8192 {
		message = message[:8192]
		for !utf8.ValidString(message) {
			message = message[:len(message)-1]
		}
	}
	raw := args[1]
	if len(raw) > 16<<10 {
		raw = json.RawMessage(`{"truncated":true}`)
	}
	return h.withAttempt(ctx, false, func(_ identity.Tx, r Repository, c *Consumption) error {
		if c.Truncated {
			return nil
		}
		encoded, _ := json.Marshal(message)
		size := uint64(len(encoded) + len(raw))
		if c.LogCount >= 10000 || c.LogBytes+size > 10<<20 {
			c.Truncated = true
			return r.AppendLog(c, &Log{Kind: "execution", Level: "warn", Message: "脚本日志达到限额，后续输出已截断"})
		}
		c.LogCount++
		c.LogBytes += size
		return r.AppendLog(c, &Log{Kind: "script", Level: level, Message: message, Fields: raw})
	})
}
