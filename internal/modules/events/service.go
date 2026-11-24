package events

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"slices"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/ravenmk2/antcdp/internal/modules/collaboration"
	"github.com/ravenmk2/antcdp/internal/modules/identity"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
)

func now() time.Time   { return time.Now().UTC().Truncate(time.Millisecond) }
func missing() error   { return httpx.E(404, "NOT_FOUND", "事件对象不存在或不可见") }
func forbidden() error { return httpx.E(403, "FORBIDDEN", "需要项目管理员权限") }
func integrity() error { return httpx.E(500, "EVENT_INTEGRITY_ERROR", "事件数据不完整") }
func repository(tx identity.Tx) (Repository, error) {
	r, ok := tx.(interface{ Events() Repository })
	if !ok {
		return nil, httpx.E(503, "EVENTS_UNAVAILABLE", "事件服务暂不可用")
	}
	return r.Events(), nil
}
func project(tx identity.Tx, projectID, userID uint64, lock bool) (*collaboration.Resource, error) {
	r, ok := tx.(collaboration.Repository)
	if !ok {
		return nil, integrity()
	}
	if lock {
		if err := r.LockCollaboration(collaboration.Project, projectID, 0); err != nil {
			return nil, err
		}
	}
	return r.Resource(collaboration.Project, projectID, userID)
}
func runAccount(tx identity.Tx, projectID, userID uint64, active bool) error {
	users, err := tx.LockUsers([]uint64{userID})
	if err != nil {
		return err
	}
	u := users[userID]
	if u == nil || u.AccountType != "robot" || u.DeletedAt != nil || (active && u.Status != "active") {
		return httpx.E(409, "EXECUTOR_UNAVAILABLE", "请选择项目内已启用的机器人作为运行账号")
	}
	p, err := project(tx, projectID, userID, false)
	if err != nil {
		return err
	}
	if p == nil || !p.IsMember || p.EndedAt != nil {
		return httpx.E(409, "EXECUTOR_ACCESS_REVOKED", "运行账号已无当前项目的执行资格")
	}
	return nil
}
func (s *Service) transaction(ctx context.Context, fn func(identity.Tx, Repository) error) error {
	store, err := s.Store()
	if err != nil {
		return err
	}
	return store.Transact(ctx, func(tx identity.Tx) error {
		r, err := repository(tx)
		if err != nil {
			return err
		}
		return fn(tx, r)
	})
}
func (s *Service) access(ctx context.Context, raw string, projectID uint64, manage, write bool, discover func(identity.Tx) ([]uint64, error), fn func(identity.Tx, Repository, *identity.Auth, bool) error) (*identity.Auth, error) {
	return s.Identity.BusinessAccess(ctx, raw, discover, func(tx identity.Tx, a *identity.Auth) error {
		p, err := project(tx, projectID, a.User.ID, write)
		if err != nil {
			return err
		}
		if p == nil || !p.IsMember {
			return missing()
		}
		canManage := p.Role == "admin" || a.User.Role == "admin"
		if manage && !canManage {
			return forbidden()
		}
		if write && p.EndedAt != nil {
			return httpx.E(409, "RESOURCE_READ_ONLY", "项目已归档")
		}
		r, err := repository(tx)
		if err != nil {
			return err
		}
		return fn(tx, r, a, canManage)
	})
}
func audit(tx identity.Tx, a *identity.Auth, action string, subscription uint64) error {
	id := fmt.Sprint(subscription)
	return tx.Audit(identity.Event{ActorID: &a.User.ID, ActorType: "user", ActorName: a.User.DisplayName, ActorUsername: &a.User.Username, Action: "event_subscription." + action, TargetType: "event_subscription", TargetID: &id, OccurredAt: now(), Detail: safeJSON(map[string]any{})})
}
func requireSubscription(r Repository, projectID, id uint64, lock bool) (*Subscription, error) {
	v, err := r.Subscription(id, lock)
	if err != nil {
		return nil, err
	}
	if v == nil || v.ScopeKind != "project" || v.ScopeID != projectID {
		return nil, missing()
	}
	return v, nil
}

// ReceiveGitLab participates in the authenticated source transaction. No network or script runs here.
func (s *Service) ReceiveGitLab(_ context.Context, tx identity.Tx, connection uint64, h http.Header, body []byte) (map[string]any, error) {
	e, err := NormalizeGitLab(connection, h, body, now())
	if err != nil {
		return nil, err
	}
	return s.Receive(tx, e, func(r Repository) ([]Reference, error) {
		targets, err := r.Targets(connection, e.RepositoryID)
		if err != nil {
			return nil, err
		}
		refs := make([]Reference, 0, len(targets))
		for _, target := range targets {
			refs = append(refs, Reference{ScopeKind: "project", ScopeID: target.ProjectID, Basis: safeJSON(map[string]any{"projectRepositoryId": fmt.Sprint(target.RepositoryID), "connectionId": fmt.Sprint(connection), "repositoryId": e.RepositoryID})})
		}
		return refs, nil
	})
}

// Receive records a normalized message in the authenticated producer's transaction.
// The producer supplies authorized project targets and their routing evidence.
func (s *Service) Receive(tx identity.Tx, e *Record, targets func(Repository) ([]Reference, error)) (map[string]any, error) {
	r, err := repository(tx)
	if err != nil {
		return nil, err
	}
	if e.MessageID != nil {
		prior, err := r.RecordByMessage(e.SourceKind, e.SourceID, *e.MessageID)
		if err != nil {
			return nil, err
		}
		if prior != nil {
			status := "duplicate"
			if prior.PayloadHash != e.PayloadHash {
				status = "conflict"
			}
			return map[string]any{"event_id": fmt.Sprint(prior.ID), "status": status}, nil
		}
	}
	if e.Type != "" {
		if err = s.validateRecord(r, e); err != nil {
			return nil, err
		}
	} else if e.RoutingResult != "unsupported" {
		return nil, httpx.Invalid("type", "required")
	}
	// Take the source's committed target snapshot without locking projects here.
	// Repository management locks projects before connections.
	refs, err := targets(r)
	if err != nil {
		return nil, err
	}
	if e.Type != "" {
		e.RoutingResult = "unmatched"
		if len(refs) > 0 {
			e.RoutingResult = "routed"
		}
	}
	if err = r.InsertRecord(e); err != nil {
		return nil, err
	}
	queued := 0
	for i := range refs {
		ref := &refs[i]
		if ref.ScopeKind != "project" || ref.ScopeID == 0 {
			return nil, integrity()
		}
		ref.EventID, ref.CreatedAt = e.ID, e.ReceivedAt
		if err = r.InsertReference(ref); err != nil {
			return nil, err
		}
		if e.Type == "" {
			continue
		}
		subscriptions, err := r.Subscriptions(ref.ScopeID, true)
		if err != nil {
			return nil, err
		}
		for i := range subscriptions {
			sub := &subscriptions[i]
			if !sub.Enabled {
				continue
			}
			rev, err := r.Revision(sub.RevisionID)
			if err != nil {
				return nil, err
			}
			if rev == nil {
				return nil, integrity()
			}
			var types []string
			if json.Unmarshal(rev.EventTypes, &types) != nil {
				return nil, integrity()
			}
			if !slices.Contains(types, e.Type) {
				continue
			}
			if _, err = enqueue(r, sub, rev.ID, ref.ID, nil, nil); err != nil {
				return nil, err
			}
			queued++
		}
	}
	return map[string]any{"event_id": fmt.Sprint(e.ID), "status": e.RoutingResult, "scope_count": len(refs), "queued_count": queued}, nil
}

func enqueue(r Repository, sub *Subscription, revision, reference uint64, retryOf, actor *uint64) (*Consumption, error) {
	c := &Consumption{SubscriptionID: sub.ID, RevisionID: revision, ReferenceID: reference, QueueSeq: sub.NextEnqueue, Status: "queued", Result: json.RawMessage(`null`), RetryOf: retryOf, OperatorID: actor, CreatedAt: now()}
	if err := r.InsertConsumption(c); err != nil {
		return nil, err
	}
	sub.NextEnqueue++
	if err := r.SaveSubscription(sub); err != nil {
		return nil, err
	}
	if err := r.AppendLog(c, &Log{Kind: "execution", Level: "info", Message: "消费已入队"}); err != nil {
		return nil, err
	}
	return c, nil
}

func (s *Service) Catalog(ctx context.Context, raw string) ([]Group, *identity.Auth, error) {
	var groups []Group
	auth, err := s.Identity.BusinessAccess(ctx, raw, nil, func(tx identity.Tx, _ *identity.Auth) error {
		r, err := repository(tx)
		if err != nil {
			return err
		}
		groups, err = r.Catalog()
		return err
	})
	return groups, auth, err
}

func (s *Service) Events(ctx context.Context, raw string, pid uint64, f Filter) ([]Reference, *identity.Auth, error) {
	var rows []Reference
	a, err := s.access(ctx, raw, pid, false, false, nil, func(_ identity.Tx, r Repository, _ *identity.Auth, _ bool) error {
		var err error
		rows, err = r.References(pid, f)
		return err
	})
	return rows, a, err
}
func (s *Service) Event(ctx context.Context, raw string, pid, id uint64) (*Reference, *identity.Auth, error) {
	var out *Reference
	a, err := s.access(ctx, raw, pid, false, false, nil, func(_ identity.Tx, r Repository, _ *identity.Auth, _ bool) error {
		var err error
		out, err = r.Reference(id)
		if err != nil {
			return err
		}
		if out == nil || out.ScopeKind != "project" || out.ScopeID != pid {
			return missing()
		}
		return nil
	})
	return out, a, err
}
func (s *Service) Subscriptions(ctx context.Context, raw string, pid uint64) ([]Subscription, *identity.Auth, error) {
	var rows []Subscription
	a, err := s.access(ctx, raw, pid, false, false, nil, func(_ identity.Tx, r Repository, _ *identity.Auth, canManage bool) error {
		var err error
		rows, err = r.Subscriptions(pid, false)
		if err != nil {
			return err
		}
		for i := range rows {
			rows[i].Config, err = r.Revision(rows[i].RevisionID)
			if err != nil {
				return err
			}
			rows[i].CanManage = canManage
		}
		return nil
	})
	return rows, a, err
}
func (s *Service) Subscription(ctx context.Context, raw string, pid, id uint64) (*Subscription, *identity.Auth, error) {
	var out *Subscription
	a, err := s.access(ctx, raw, pid, false, false, nil, func(_ identity.Tx, r Repository, _ *identity.Auth, canManage bool) error {
		var err error
		out, err = requireSubscription(r, pid, id, false)
		if err != nil {
			return err
		}
		out.Config, err = r.Revision(out.RevisionID)
		out.CanManage = canManage
		return err
	})
	return out, a, err
}

type Source struct {
	Revision *Revision `json:"revision"`
	Script   string    `json:"script"`
}

func (s *Service) Source(ctx context.Context, raw string, pid, id, revision uint64) (Source, *identity.Auth, error) {
	var out Source
	a, err := s.access(ctx, raw, pid, true, false, nil, func(_ identity.Tx, r Repository, _ *identity.Auth, _ bool) error {
		sub, err := requireSubscription(r, pid, id, false)
		if err != nil {
			return err
		}
		if revision == 0 {
			revision = sub.RevisionID
		}
		rev, err := r.Revision(revision)
		if err != nil {
			return err
		}
		if rev == nil || rev.SubscriptionID != id {
			return missing()
		}
		out = Source{rev, rev.Script}
		return nil
	})
	return out, a, err
}
func (s *Service) Revisions(ctx context.Context, raw string, pid, id uint64) ([]Revision, *identity.Auth, error) {
	var rows []Revision
	a, err := s.access(ctx, raw, pid, true, false, nil, func(_ identity.Tx, r Repository, _ *identity.Auth, _ bool) error {
		if _, err := requireSubscription(r, pid, id, false); err != nil {
			return err
		}
		var err error
		rows, err = r.Revisions(id)
		return err
	})
	return rows, a, err
}
func (s *Service) Save(ctx context.Context, raw string, pid, id uint64, w Write) (*Subscription, *identity.Auth, error) {
	w.Name = strings.TrimSpace(w.Name)
	if w.Name == "" || utf8.RuneCountInString(w.Name) > 100 || utf8.RuneCountInString(w.Description) > 1000 {
		return nil, nil, httpx.Invalid("name", "invalid_length")
	}
	if w.TimeoutMS == 0 {
		w.TimeoutMS = 60000
	}
	if w.MaxRetries == nil {
		w.MaxRetries = new(uint32(3))
	}
	if w.TimeoutMS < 1000 || w.TimeoutMS > 600000 || *w.MaxRetries > 10 {
		return nil, nil, httpx.Invalid("execution", "invalid_settings")
	}
	slices.Sort(w.EventTypes)
	w.EventTypes = slices.Compact(w.EventTypes)
	if len(w.EventTypes) == 0 {
		return nil, nil, httpx.Invalid("event_types", "required")
	}
	if w.RunAsUserID == 0 {
		return nil, nil, httpx.Invalid("run_as_user_id", "required")
	}
	// Compilation errors are returned only after project administrator authorization.
	var out *Subscription
	a, err := s.access(ctx, raw, pid, true, true, func(identity.Tx) ([]uint64, error) { return []uint64{w.RunAsUserID}, nil }, func(tx identity.Tx, r Repository, a *identity.Auth, _ bool) error {
		groups, err := r.Catalog()
		if err != nil {
			return err
		}
		if !containsTypes(groups, w.EventTypes) {
			return httpx.Invalid("event_types", "unsupported")
		}
		if err := s.Executor.Validate(w.Script, "consumer.js", "main"); err != nil {
			return httpx.E(422, "INVALID_SCRIPT", err.Error())
		}
		if err := runAccount(tx, pid, w.RunAsUserID, w.Enabled); err != nil {
			return err
		}
		created := id == 0
		var sub *Subscription
		var previous *Revision
		if created {
			sub = &Subscription{ScopeKind: "project", ScopeID: pid, Version: 1, NextEnqueue: 1, NextConsume: 1, Creator: a.User.ID, CreatedAt: now()}
		} else {
			var err error
			sub, err = requireSubscription(r, pid, id, true)
			if err != nil {
				return err
			}
			if sub.DeletedAt != nil {
				return missing()
			}
			if w.Version != strconv.FormatUint(sub.Version, 10) {
				return httpx.E(412, "VERSION_CONFLICT", "订阅已变化，请重新加载")
			}
			previous, err = r.Revision(sub.RevisionID)
			if err != nil {
				return err
			}
			if previous == nil {
				return integrity()
			}
			sub.Version++
		}
		sub.Name, sub.Description, sub.Enabled, sub.Updater, sub.UpdatedAt = w.Name, w.Description, w.Enabled, a.User.ID, now()
		if created {
			if err := r.SaveSubscription(sub); err != nil {
				return err
			}
		}
		var oldTypes []string
		if previous != nil {
			if json.Unmarshal(previous.EventTypes, &oldTypes) != nil {
				return integrity()
			}
		}
		changed := previous == nil || previous.Script != w.Script || previous.RunAsUserID != w.RunAsUserID || previous.TimeoutMS != w.TimeoutMS || previous.MaxRetries != *w.MaxRetries || !slices.Equal(oldTypes, w.EventTypes)
		if changed {
			number := uint64(1)
			if previous != nil {
				number = previous.Number + 1
			}
			rev := &Revision{SubscriptionID: sub.ID, Number: number, EventTypes: safeJSON(w.EventTypes), RunAsUserID: w.RunAsUserID, APIVersion: 1, Script: w.Script, TimeoutMS: w.TimeoutMS, MaxRetries: *w.MaxRetries, RetryIntervalMS: 30000, Creator: a.User.ID, CreatedAt: now()}
			if err := r.InsertRevision(rev); err != nil {
				return err
			}
			sub.RevisionID = rev.ID
			previous = rev
		}
		if err := r.SaveSubscription(sub); err != nil {
			return err
		}
		sub.Config, sub.CanManage = previous, true
		out = sub
		action := "updated"
		if created {
			action = "created"
		}
		return audit(tx, a, action, sub.ID)
	})
	return out, a, err
}

func (s *Service) SetEnabled(ctx context.Context, raw string, pid, id uint64, version string, enabled bool) (*Subscription, *identity.Auth, error) {
	var out *Subscription
	discover := func(tx identity.Tx) ([]uint64, error) {
		r, err := repository(tx)
		if err != nil {
			return nil, err
		}
		sub, err := requireSubscription(r, pid, id, false)
		if err != nil {
			return nil, err
		}
		rev, err := r.Revision(sub.RevisionID)
		if err != nil {
			return nil, err
		}
		if rev == nil {
			return nil, integrity()
		}
		return []uint64{rev.RunAsUserID}, nil
	}
	a, err := s.access(ctx, raw, pid, true, true, discover, func(tx identity.Tx, r Repository, a *identity.Auth, _ bool) error {
		sub, err := requireSubscription(r, pid, id, true)
		if err != nil {
			return err
		}
		if sub.DeletedAt != nil {
			return missing()
		}
		if version != fmt.Sprint(sub.Version) {
			return httpx.E(412, "VERSION_CONFLICT", "订阅已变化，请重新加载")
		}
		rev, err := r.Revision(sub.RevisionID)
		if err != nil {
			return err
		}
		if rev == nil {
			return integrity()
		}
		if enabled {
			if err = runAccount(tx, pid, rev.RunAsUserID, true); err != nil {
				return err
			}
		}
		sub.Enabled, sub.Updater, sub.UpdatedAt = enabled, a.User.ID, now()
		sub.Version++
		if err = r.SaveSubscription(sub); err != nil {
			return err
		}
		sub.Config, sub.CanManage = rev, true
		out = sub
		return audit(tx, a, "enabled_changed", id)
	})
	return out, a, err
}
func (s *Service) Delete(ctx context.Context, raw string, pid, id uint64, version string) (*identity.Auth, error) {
	return s.access(ctx, raw, pid, true, true, nil, func(tx identity.Tx, r Repository, a *identity.Auth, _ bool) error {
		sub, err := requireSubscription(r, pid, id, true)
		if err != nil {
			return err
		}
		if version != fmt.Sprint(sub.Version) {
			return httpx.E(412, "VERSION_CONFLICT", "订阅已变化，请重新加载")
		}
		at := now()
		sub.Enabled, sub.DeletedAt, sub.UpdatedAt, sub.Updater = false, &at, at, a.User.ID
		sub.Version++
		if err = r.CancelQueued(id, at); err != nil {
			return err
		}
		if err = r.SaveSubscription(sub); err != nil {
			return err
		}
		return audit(tx, a, "deleted", id)
	})
}
func (s *Service) Consumptions(ctx context.Context, raw string, pid uint64, f Filter) ([]Consumption, *identity.Auth, error) {
	var rows []Consumption
	a, err := s.access(ctx, raw, pid, false, false, nil, func(_ identity.Tx, r Repository, _ *identity.Auth, _ bool) error {
		var err error
		rows, err = r.Consumptions(pid, f)
		return err
	})
	return rows, a, err
}
func scopedConsumption(r Repository, pid, id uint64, lock bool) (*Consumption, error) {
	c, err := r.Consumption(id, false)
	if err != nil {
		return nil, err
	}
	if c == nil {
		return nil, missing()
	}
	if _, err = requireSubscription(r, pid, c.SubscriptionID, lock); err != nil {
		return nil, err
	}
	if lock {
		return r.Consumption(id, true)
	}
	return c, nil
}
func (s *Service) Consumption(ctx context.Context, raw string, pid, id uint64) (*Consumption, *identity.Auth, error) {
	var out *Consumption
	a, err := s.access(ctx, raw, pid, false, false, nil, func(_ identity.Tx, r Repository, _ *identity.Auth, _ bool) error {
		var err error
		out, err = scopedConsumption(r, pid, id, false)
		return err
	})
	return out, a, err
}
func (s *Service) Logs(ctx context.Context, raw string, pid, id, after uint64) ([]Log, *identity.Auth, error) {
	var rows []Log
	a, err := s.access(ctx, raw, pid, false, false, nil, func(_ identity.Tx, r Repository, _ *identity.Auth, _ bool) error {
		if _, err := scopedConsumption(r, pid, id, false); err != nil {
			return err
		}
		var err error
		rows, err = r.Logs(id, after)
		return err
	})
	return rows, a, err
}
func (s *Service) Retry(ctx context.Context, raw string, pid, id uint64) (*Consumption, *identity.Auth, error) {
	var out *Consumption
	var lockedExecutor uint64
	discover := func(tx identity.Tx) ([]uint64, error) {
		r, err := repository(tx)
		if err != nil {
			return nil, err
		}
		c, err := scopedConsumption(r, pid, id, false)
		if err != nil {
			return nil, err
		}
		sub, err := r.Subscription(c.SubscriptionID, false)
		if err != nil {
			return nil, err
		}
		rev, err := r.Revision(sub.RevisionID)
		if err != nil {
			return nil, err
		}
		if rev == nil {
			return nil, integrity()
		}
		lockedExecutor = rev.RunAsUserID
		return []uint64{rev.RunAsUserID}, nil
	}
	a, err := s.access(ctx, raw, pid, true, true, discover, func(tx identity.Tx, r Repository, a *identity.Auth, _ bool) error {
		original, err := scopedConsumption(r, pid, id, true)
		if err != nil {
			return err
		}
		child, err := r.RetryChild(id)
		if err != nil {
			return err
		}
		if child != nil {
			out = child
			return nil
		}
		if original.Status != "failed" {
			return httpx.E(409, "RETRY_NOT_ALLOWED", "仅最终失败的消费记录可人工重试")
		}
		sub, err := r.Subscription(original.SubscriptionID, true)
		if err != nil {
			return err
		}
		if !sub.Enabled || sub.DeletedAt != nil {
			return httpx.E(409, "SUBSCRIPTION_DISABLED", "请先启用订阅")
		}
		rev, err := r.Revision(sub.RevisionID)
		if err != nil {
			return err
		}
		if rev == nil {
			return integrity()
		}
		if rev.RunAsUserID != lockedExecutor {
			return httpx.E(412, "VERSION_CONFLICT", "订阅运行账号已变化，请重新加载后重试")
		}
		if err = runAccount(tx, pid, rev.RunAsUserID, true); err != nil {
			return err
		}
		out, err = enqueue(r, sub, rev.ID, original.ReferenceID, &original.ID, &a.User.ID)
		if err != nil {
			return err
		}
		return audit(tx, a, "manual_retry", sub.ID)
	})
	return out, a, err
}
