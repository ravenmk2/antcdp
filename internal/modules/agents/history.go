package agents

import (
	"context"
	"encoding/json"
	"slices"

	"github.com/ravenmk2/antcdp/internal/agentcore"
	"github.com/ravenmk2/antcdp/internal/modules/identity"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
)

type observingKey struct{}

// ObservingContext makes passive WS reads authenticate without renewing login.
func ObservingContext(ctx context.Context) context.Context {
	return context.WithValue(ctx, observingKey{}, true)
}
func (s *Service) observationAccess(ctx context.Context, raw string, fn func(identity.Tx, Repository, *identity.Auth, *Result) error) (*Result, error) {
	if observing, _ := ctx.Value(observingKey{}).(bool); !observing {
		return s.access(ctx, raw, false, fn)
	}
	if s.Identity == nil || s.ETag == nil {
		return nil, unavailable()
	}
	out := &Result{Status: 200}
	auth, err := s.Identity.ObserveAccess(ctx, raw, func(tx identity.Tx, a *identity.Auth) error {
		r, e := RepositoryFor(tx)
		if e != nil {
			return e
		}
		*out = Result{Status: 200}
		return fn(tx, r, a, out)
	})
	out.Auth = auth
	return out, err
}
func (s *Service) History(ctx context.Context, raw string, id uint64, q HistoryQuery) (*Result, error) {
	return s.observationAccess(ctx, raw, func(tx identity.Tx, _ Repository, a *identity.Auth, out *Result) error {
		st, e := StateFor(tx)
		if e != nil {
			return e
		}
		v, e := s.sessionAccess(st, id, a, false, true)
		if e != nil {
			return e
		}
		repo, e := observationsFor(tx)
		if e != nil {
			return e
		}
		page, e := historyPage(st, repo, v, q)
		out.Data = page
		return e
	})
}

func historyPage(st StateRepository, repo ObservationRepository, v *SessionRow, q HistoryQuery) (HistoryPage, error) {
	out := HistoryPage{SessionID: v.ID, Through: v.LastSeq, Records: []DurableRecord{}}
	if q.Limit == 0 {
		q.Limit = 80
	}
	if q.Limit < 1 || q.Limit > 200 {
		return out, httpx.Invalid("limit", "out_of_range")
	}
	if q.Through != nil {
		out.Through = *q.Through
	}
	if out.Through > v.LastSeq || out.Through == ^uint64(0) {
		return out, httpx.Invalid("through_seq", "out_of_range")
	}
	cut := out.Through + 1
	if q.Before != nil {
		cut = *q.Before
	}
	if cut == 0 || cut > out.Through+1 {
		return out, httpx.Invalid("before_seq", "out_of_range")
	}
	if cut == 1 {
		return out, nil
	}
	rows, e := st.Events(v.ID, 0, cut-1, q.Limit, true)
	if e != nil {
		return out, e
	}
	if len(rows) == 0 {
		return out, integrity()
	}
	first := rows[len(rows)-1].Seq
	ranges, e := repo.HistoryGroups(v.ID, first, out.Through)
	if e != nil {
		return out, e
	}
	for _, r := range ranges {
		if r.From < cut && r.Through >= cut {
			return out, httpx.E(422, "HISTORY_GROUP_BOUNDARY", "分页位置位于消息组中间")
		}
		if r.From < first && r.Through >= first {
			first = r.From
		}
	}
	// Re-read the entire boundary group. The encoded byte budget remains the
	// authority; this guard bounds corrupt/unbounded interleaved projections.
	rows, e = st.Events(v.ID, first-1, cut-1, 10001, false)
	if e != nil {
		return out, e
	}
	if len(rows) > 10000 {
		return out, httpx.E(422, "HISTORY_GROUP_TOO_LARGE", "消息组超过读取上限")
	}
	groups := []agentcore.HistoryGroup{}
	var current agentcore.HistoryGroup
	groupEnd := uint64(0)
	for _, row := range rows {
		if len(current.Records) > 0 && row.Seq > groupEnd {
			groups = append(groups, current)
			current = agentcore.HistoryGroup{}
		}
		for _, r := range ranges {
			if r.From <= row.Seq && r.Through >= row.Seq {
				groupEnd = max(groupEnd, r.Through)
			}
		}
		record, e := projectEvent(row)
		if e != nil {
			return out, e
		}
		data, e := json.Marshal(record.Data)
		if e != nil {
			return out, e
		}
		current.Records = append(current.Records, agentcore.Event{Seq: agentcore.Seq(row.Seq), Type: record.Type, SchemaVersion: 1, OccurredAt: record.OccurredAt, Data: data, RunID: coreID(record.RunID)})
	}
	if len(current.Records) > 0 {
		groups = append(groups, current)
	}
	selected, e := agentcore.SelectHistory(groups, agentcore.Seq(out.Through), seqPointer(q.Before), q.Limit, agentcore.MaxHistoryBytes-256)
	if e != nil {
		return out, coreError(e)
	}
	if len(selected.Records) == 0 && len(rows) > 0 {
		return out, httpx.E(422, "HISTORY_GROUP_TOO_LARGE", "消息组超过读取上限")
	}
	for _, r := range selected.Records {
		out.Records = append(out.Records, DurableRecord{Seq: r.Seq, Type: r.Type, SchemaVersion: 1, OccurredAt: r.OccurredAt, RunID: uintPointer(r.RunID), Data: r.Data})
	}
	if len(out.Records) > 0 && out.Records[0].Seq > 1 {
		before := uint64(out.Records[0].Seq)
		out.Before = &before
		out.HasMore = true
	}
	encoded, e := json.Marshal(out)
	if e != nil {
		return out, e
	}
	if len(encoded) > agentcore.MaxHistoryBytes {
		return out, httpx.E(422, "HISTORY_GROUP_TOO_LARGE", "消息组超过读取上限")
	}
	return out, nil
}
func coreID(v *uint64) *agentcore.ID {
	if v == nil {
		return nil
	}
	n := agentcore.ID(*v)
	return &n
}
func uintPointer(v *agentcore.ID) *uint64 {
	if v == nil {
		return nil
	}
	n := uint64(*v)
	return &n
}
func seqPointer(v *uint64) *agentcore.Seq {
	if v == nil {
		return nil
	}
	n := agentcore.Seq(*v)
	return &n
}

// EventsAfter is only an authenticated server-side WS catch-up operation. It
// does not introduce a public arbitrary after-cursor history endpoint.
func (s *Service) EventsAfter(ctx context.Context, raw string, id, after uint64, limit int) (*Result, error) {
	if limit < 1 || limit > 1000 {
		return nil, httpx.Invalid("limit", "out_of_range")
	}
	return s.observationAccess(ctx, raw, func(tx identity.Tx, _ Repository, a *identity.Auth, out *Result) error {
		st, e := StateFor(tx)
		if e != nil {
			return e
		}
		v, e := s.sessionAccess(st, id, a, false, true)
		if e != nil {
			return e
		}
		if after > v.LastSeq {
			return httpx.Invalid("after_seq", "out_of_range")
		}
		rows, e := st.Events(id, after, v.LastSeq, limit, false)
		if e != nil {
			return e
		}
		records := make([]DurableRecord, 0, len(rows))
		expected := after + 1
		for _, row := range rows {
			if row.Seq != expected {
				return integrity()
			}
			expected++
			r, e := projectEvent(row)
			if e != nil {
				return e
			}
			records = append(records, r)
		}
		out.Data = HistoryPage{SessionID: id, Through: v.LastSeq, Records: records, HasMore: len(rows) > 0 && rows[len(rows)-1].Seq < v.LastSeq}
		return nil
	})
}

// TrimSnapshot removes complete oldest groups, including interleaved records;
// it never slices content blocks or returns oversized WS frames.
func TrimSnapshot(snapshot ObservationSnapshot, stream agentcore.StreamSnapshot, subscription string) (map[string]any, error) {
	frame := func() map[string]any {
		return map[string]any{"type": "snapshot", "subscription_id": subscription, "session_id": agentcore.ID(snapshot.SessionID), "through_seq": agentcore.Seq(snapshot.Through), "state": snapshot.State, "records": snapshot.Records, "before_seq": seqPointer(snapshot.Before), "has_more": snapshot.HasMore, "stream": stream}
	}
	state, e := json.Marshal(snapshot.State)
	if e != nil || len(state) > 512<<10 {
		return nil, httpx.E(422, "SNAPSHOT_TOO_LARGE", "快照状态超过上限")
	}
	encoded, e := json.Marshal(frame())
	if e != nil {
		return nil, e
	}
	history, e := json.Marshal(snapshot.Records)
	if e != nil {
		return nil, e
	}
	if len(encoded) <= 2<<20 && len(history) <= agentcore.MaxHistoryBytes {
		return frame(), nil
	}
	// Empty history is always a valid complete-group boundary. HTTP keeps the
	// fixed through_seq and fetches whole groups using this exclusive cursor.
	snapshot.Records = slices.Clone(snapshot.Records[:0])
	if snapshot.Through > 0 {
		n := snapshot.Through + 1
		snapshot.Before = &n
		snapshot.HasMore = true
	}
	encoded, e = json.Marshal(frame())
	if e != nil {
		return nil, e
	}
	if len(encoded) > 2<<20 {
		return nil, httpx.E(422, "SNAPSHOT_TOO_LARGE", "快照状态超过上限")
	}
	return frame(), nil
}
