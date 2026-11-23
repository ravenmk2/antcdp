package events

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"sync"
	"time"

	"github.com/ravenmk2/antcdp/internal/modules/identity"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
	"github.com/ravenmk2/antcdp/internal/scriptcore"
)

type attempt struct {
	Subscription Subscription
	Consumption  Consumption
	Revision     Revision
	Reference    Reference
}

func (s *Service) Work(ctx context.Context, logger *slog.Logger) {
	ticker := time.NewTicker(250 * time.Millisecond)
	defer ticker.Stop()
	active := map[uint64]bool{}
	done := make(chan uint64, 8)
	var workers sync.WaitGroup
	defer workers.Wait()
	recovered := false
	var lastError time.Time
	report := func(err error) {
		if err != nil && ctx.Err() == nil && time.Since(lastError) > 10*time.Second {
			logger.Error("event consumer worker failed", "error", err)
			lastError = time.Now()
		}
	}
	for {
		select {
		case <-ctx.Done():
			return
		case id := <-done:
			delete(active, id)
		case <-ticker.C:
		}
		if !recovered {
			if err := s.recover(ctx); err != nil {
				report(err)
				continue
			}
			recovered = true
		}
		if len(active) >= 8 {
			continue
		}
		var ids []uint64
		err := s.transaction(ctx, func(_ identity.Tx, r Repository) error { var e error; ids, e = r.WorkSubscriptions(false); return e })
		if err != nil {
			report(err)
			continue
		}
		for _, id := range ids {
			if len(active) >= 8 {
				break
			}
			if active[id] {
				continue
			}
			work, err := s.claim(ctx, id)
			if err != nil {
				report(err)
				continue
			}
			if work == nil {
				continue
			}
			active[id] = true
			workers.Go(func() { defer func() { done <- id }(); s.execute(ctx, *work, logger) })
		}
	}
}

func (s *Service) claim(ctx context.Context, id uint64) (*attempt, error) {
	var out *attempt
	err := s.transaction(ctx, func(tx identity.Tx, r Repository) error {
		peek, err := r.Subscription(id, false)
		if err != nil {
			return err
		}
		if peek == nil {
			return nil
		}
		head, err := r.Head(id, peek.NextConsume, false)
		if err != nil {
			return err
		}
		if head == nil {
			return nil
		}
		rev, err := r.Revision(head.RevisionID)
		if err != nil {
			return err
		}
		if rev == nil {
			return integrity()
		}
		// Match request lock order: execution account, project, subscription, task.
		if _, err = tx.LockUsers([]uint64{rev.RunAsUserID}); err != nil {
			return err
		}
		p, err := project(tx, peek.ScopeID, rev.RunAsUserID, true)
		if err != nil {
			return err
		}
		sub, err := r.Subscription(id, true)
		if err != nil {
			return err
		}
		if sub == nil || !sub.Enabled || sub.DeletedAt != nil || p == nil || p.EndedAt != nil || sub.NextConsume != peek.NextConsume {
			return nil
		}
		c, err := r.Head(id, sub.NextConsume, true)
		if err != nil {
			return err
		}
		if c == nil || c.ID != head.ID {
			return nil
		}
		if c.Status != "queued" && (c.Status != "retry_wait" || c.NextRetryAt == nil || c.NextRetryAt.After(now())) {
			return nil
		}
		at := now()
		deadline := at.Add(time.Duration(rev.TimeoutMS) * time.Millisecond)
		c.Status, c.StartedAt, c.DeadlineAt, c.NextRetryAt, c.FinishedAt = "running", &at, &deadline, nil, nil
		c.Attempt++
		c.LogCount, c.LogBytes, c.Truncated = 0, 0, false
		c.ErrorCode, c.ErrorSummary = "", ""
		if err = r.AppendLog(c, &Log{Kind: "execution", Level: "info", Message: "开始消费", Fields: safeJSON(map[string]any{"revisionId": fmt.Sprint(rev.ID)})}); err != nil {
			return err
		}
		if err = runAccount(tx, sub.ScopeID, rev.RunAsUserID, true); err != nil {
			return settle(r, sub, c, rev, scriptcore.Result{}, err)
		}
		ref, err := r.Reference(c.ReferenceID)
		if err != nil {
			return err
		}
		if ref == nil || ref.Event == nil {
			return integrity()
		}
		out = &attempt{*sub, *c, *rev, *ref}
		return nil
	})
	return out, err
}

func failure(err error) (string, string) {
	if errors.Is(err, context.DeadlineExceeded) {
		return "SCRIPT_TIMEOUT", "消费脚本执行超时"
	}
	if errors.Is(err, context.Canceled) {
		return "SERVICE_INTERRUPTED", "消费执行被中断"
	}
	var h *httpx.Error
	if errors.As(err, &h) {
		return h.Code, h.Message
	}
	code := scriptcore.Code(err)
	// VM errors can contain the script's source and literals. Public logs expose
	// the reason category; the full error remains in the administrator server log.
	message := map[string]string{"UNAWAITED_HOST_CALL": "脚本结束时仍有未等待的异步调用", "UNHANDLED_REJECTION": "脚本存在未处理的 Promise 拒绝", "UNSETTLED_PROMISE": "脚本 Promise 无法继续推进", "SERVICE_INTERRUPTED": "上次执行被服务重启中断"}[code]
	if message == "" {
		message = "消费脚本执行失败，请管理员检查脚本或脚本主动记录的日志"
	}
	return code, message
}

func settle(r Repository, sub *Subscription, c *Consumption, rev *Revision, result scriptcore.Result, executionErr error) error {
	at := now()
	c.NextRetryAt = nil
	c.DeadlineAt = nil
	level, message := "info", "消费成功"
	if executionErr == nil {
		c.Status, c.FinishedAt, c.ErrorCode, c.ErrorSummary = "succeeded", &at, "", ""
		c.HasResult = result.HasValue
		c.Result = result.Value
		if !result.HasValue {
			c.Result = json.RawMessage(`null`)
		}
	} else {
		c.ErrorCode, c.ErrorSummary = failure(executionErr)
		c.Result = json.RawMessage(`null`)
		c.HasResult = false
		level = "error"
		if c.Attempt <= rev.MaxRetries && sub.DeletedAt == nil {
			next := at.Add(time.Duration(rev.RetryIntervalMS) * time.Millisecond)
			c.Status, c.NextRetryAt, c.FinishedAt = "retry_wait", &next, nil
			message = "本次消费失败，等待自动重试"
		} else {
			c.Status, c.FinishedAt = "failed", &at
			message = "消费最终失败，继续处理后续事件"
		}
	}
	if err := r.AppendLog(c, &Log{At: at, Kind: "execution", Level: level, Message: message, Fields: safeJSON(map[string]any{"status": c.Status, "errorCode": c.ErrorCode, "errorSummary": c.ErrorSummary, "nextRetryAt": c.NextRetryAt})}); err != nil {
		return err
	}
	if c.Terminal() {
		if sub.NextConsume == c.QueueSeq {
			sub.NextConsume++
		}
		for sub.NextConsume < sub.NextEnqueue {
			next, err := r.Head(sub.ID, sub.NextConsume, true)
			if err != nil {
				return err
			}
			if next == nil {
				return integrity()
			}
			if !next.Terminal() {
				break
			}
			sub.NextConsume++
		}
		return r.SaveSubscription(sub)
	}
	return nil
}

func (s *Service) recover(ctx context.Context) error {
	var rows []Consumption
	if err := s.transaction(ctx, func(_ identity.Tx, r Repository) error { var err error; rows, err = r.ActiveConsumptions(); return err }); err != nil {
		return err
	}
	for _, row := range rows {
		if err := s.transaction(ctx, func(_ identity.Tx, r Repository) error {
			sub, err := r.Subscription(row.SubscriptionID, true)
			if err != nil {
				return err
			}
			if sub == nil {
				return integrity()
			}
			c, err := r.Consumption(row.ID, true)
			if err != nil {
				return err
			}
			if c == nil || c.Terminal() {
				return nil
			}
			rev, err := r.Revision(c.RevisionID)
			if err != nil {
				return err
			}
			if rev == nil {
				return integrity()
			}
			return settle(r, sub, c, rev, scriptcore.Result{}, scriptcore.Failure("SERVICE_INTERRUPTED", "上次执行被服务重启中断"))
		}); err != nil {
			return err
		}
	}
	return nil
}

func (s *Service) execute(parent context.Context, a attempt, logger *slog.Logger) {
	ctx, cancel := context.WithDeadline(parent, *a.Consumption.DeadlineAt)
	defer cancel()
	host := &consumerHost{s: s, attempt: a}
	input := host.input()
	input.OnStopping = func(error) {
		persist, stop := context.WithTimeout(context.Background(), 10*time.Second)
		defer stop()
		if err := host.withAttempt(persist, false, func(_ identity.Tx, r Repository, c *Consumption) error {
			c.Status = "stopping"
			return r.AppendLog(c, &Log{Kind: "execution", Level: "warn", Message: "执行正在收尾，等待宿主调用结束"})
		}); err != nil {
			logger.Error("event stopping state could not be saved", "consumption_id", a.Consumption.ID, "error", err)
		}
	}
	result, executionErr := s.Executor.Execute(ctx, input)
	if executionErr != nil {
		logger.Warn("event script failed", "consumption_id", a.Consumption.ID, "attempt", a.Consumption.Attempt, "error", executionErr)
	}
	for {
		persist, stop := context.WithTimeout(context.Background(), 10*time.Second)
		err := s.transaction(persist, func(_ identity.Tx, r Repository) error {
			sub, err := r.Subscription(a.Subscription.ID, true)
			if err != nil {
				return err
			}
			if sub == nil {
				return integrity()
			}
			c, err := r.Consumption(a.Consumption.ID, true)
			if err != nil {
				return err
			}
			if c == nil || c.Attempt != a.Consumption.Attempt || c.Terminal() {
				return nil
			}
			return settle(r, sub, c, &a.Revision, result, executionErr)
		})
		stop()
		if err == nil {
			return
		}
		logger.Error("event result could not be saved", "consumption_id", a.Consumption.ID, "error", err)
		timer := time.NewTimer(time.Second)
		select {
		case <-parent.Done():
			timer.Stop()
			return
		case <-timer.C:
		}
	}
}
