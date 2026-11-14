package mysql

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	a "github.com/ravenmk2/antcdp/internal/modules/agents"
)

func init() {
	agentIntegrationCases = append(agentIntegrationCases, struct {
		Name string
		Run  func(*testing.T, *agentIntegrationFixture)
	}{"observations and usage", agentObservationQueries})
}

func agentObservationQueries(t *testing.T, f *agentIntegrationFixture) {
	ctx, raw, svc := f.Context, f.AdminToken, f.Agents
	var session, run uint64
	if e := f.Store.db.QueryRowContext(ctx, "SELECT session_id,id FROM agent_run WHERE status='succeeded' ORDER BY id LIMIT 1").Scan(&session, &run); e != nil {
		t.Fatal(e)
	}
	if out, e := svc.ListRuns(ctx, raw, session, a.ObservationQuery{}); e != nil || out.Pagination.Total < 1 {
		t.Fatal("runs", e)
	}
	if _, e := svc.GetRun(ctx, raw, run); e != nil {
		t.Fatal("run detail", e)
	}
	if _, e := svc.ListChildren(ctx, raw, run, a.ObservationQuery{}); e != nil {
		t.Fatal("children", e)
	}
	if _, e := svc.ListToolCalls(ctx, raw, run, a.ObservationQuery{}); e != nil {
		t.Fatal("tools", e)
	}
	if _, e := svc.ListInteractions(ctx, raw, session, a.ObservationQuery{}); e != nil {
		t.Fatal("interactions", e)
	}
	if _, e := svc.History(ctx, raw, session, a.HistoryQuery{Limit: 1}); e != nil {
		t.Fatal("history", e)
	}
	if _, e := svc.Snapshot(ctx, raw, session, 20); e != nil {
		t.Fatal("snapshot", e)
	}
	if _, e := svc.WorkspaceAttentionSummary(ctx, raw); e != nil {
		t.Fatal("attention summary", e)
	}
	for _, kind := range []string{"response_required", "result_unviewed"} {
		if _, e := svc.WorkspaceAttention(ctx, raw, kind, a.ObservationQuery{}); e != nil {
			t.Fatal(kind, e)
		}
	}
	usage, e := svc.SessionUsage(ctx, raw, session)
	if e != nil {
		t.Fatal("session usage", e)
	}
	report := usage.Data.(a.SessionUsageReport)
	totals := report.UsageTotals
	if totals.Calls < 1 || totals.Completed < 1 || totals.Input == nil || totals.Output == nil || totals.CacheRead != nil {
		t.Fatalf("nullable usage: %+v", totals)
	}
	if report.Context.Window == 0 || report.Context.Input == nil || report.Cache.Calls == 0 || report.Cache.Covered != 0 || report.Cache.Read != nil {
		t.Fatalf("session context and unknown cache: %+v", report)
	}
	t.Run("paired cache coverage", func(t *testing.T) { agentCacheCoverage(t, f, session) })
	from, to := time.Now().UTC().Add(-24*time.Hour), time.Now().UTC().Add(time.Minute)
	for _, group := range []string{"day", "agent", "model", "provider", "agent_type"} {
		if _, e = svc.UsageReport(ctx, raw, a.UsageQuery{From: &from, To: &to, GroupBy: group}); e != nil {
			t.Fatal(group, e)
		}
	}
	for _, admin := range []bool{false, true} {
		out, e := svc.ModelCalls(ctx, raw, a.UsageQuery{RunID: run, Status: "succeeded"}, admin)
		if e != nil {
			t.Fatal("model metadata", e)
		}
		if out.Pagination.Total < 1 {
			t.Fatal("public succeeded filter lost completed call")
		}
		for _, row := range out.Data.([]map[string]any) {
			if row["status"] != "succeeded" {
				t.Fatal("internal model status leaked")
			}
		}
		encoded, e := json.Marshal(out.Data)
		if e != nil {
			t.Fatal(e)
		}
		for _, secret := range []string{"native", "执行完成", "connection_snapshot", "secret_ciphertext", "parameters"} {
			if strings.Contains(string(encoded), secret) {
				t.Fatal("metadata exposes model content", secret)
			}
		}
	}
	if _, e = svc.RunMetadata(ctx, raw, a.UsageQuery{}); e != nil {
		t.Fatal("run metadata", e)
	}
}

func agentCacheCoverage(t *testing.T, f *agentIntegrationFixture, session uint64) {
	tx, err := f.Store.db.BeginTxx(f.Context, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = tx.Rollback() }()
	repo := &agentsTx{ctx: f.Context, tx: tx}
	if _, err = tx.ExecContext(f.Context, "UPDATE agent_model_call SET input_tokens=NULL,cache_read_tokens=NULL WHERE session_id=?", session); err != nil {
		t.Fatal(err)
	}
	base, latest, _, err := repo.SessionUsageMetrics(session)
	if err != nil || latest == nil || base.Covered != 0 || base.Read != nil {
		t.Fatal(base, latest, err)
	}
	for _, test := range []struct {
		name                        string
		input, read                 any
		covered                     uint64
		expectedInput, expectedRead string
	}{
		{"reported zero hit", "100", "0", 1, "100", "0"},
		{"reported hit", "100", "80", 1, "100", "80"},
		{"missing cache", "100", nil, 0, "", ""},
		{"missing input", nil, "80", 0, "", ""},
		{"invalid pair", "10", "80", 0, "", ""},
	} {
		t.Run(test.name, func(t *testing.T) {
			if _, err = tx.ExecContext(f.Context, "UPDATE agent_model_call SET input_tokens=?,cache_read_tokens=? WHERE id=?", test.input, test.read, latest.ID); err != nil {
				t.Fatal(err)
			}
			cache, _, _, err := repo.SessionUsageMetrics(session)
			if err != nil || cache.Calls != base.Calls || cache.Covered != test.covered {
				t.Fatal(cache, err)
			}
			if test.covered == 0 {
				if cache.Input != nil || cache.Read != nil {
					t.Fatal("unpaired counters leaked", cache)
				}
			} else if cache.Input == nil || cache.Read == nil || *cache.Input != test.expectedInput || *cache.Read != test.expectedRead {
				t.Fatal("paired totals", cache)
			}
		})
	}
	if _, err = tx.ExecContext(f.Context, "UPDATE agent_model_call SET purpose='title' WHERE id=?", latest.ID); err != nil {
		t.Fatal(err)
	}
	cache, _, _, err := repo.SessionUsageMetrics(session)
	if err != nil || cache.Calls+1 != base.Calls {
		t.Fatal("title included in cache metrics", cache, err)
	}
}
