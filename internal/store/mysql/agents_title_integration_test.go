package mysql

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	core "github.com/ravenmk2/antcdp/internal/agentcore"
	"github.com/ravenmk2/antcdp/internal/modelcore"
	a "github.com/ravenmk2/antcdp/internal/modules/agents"
	"github.com/ravenmk2/antcdp/internal/platform/cryptox"
)

type titleTestModel struct {
	generate func(context.Context, modelcore.Request) (modelcore.Response, error)
}

func (m titleTestModel) Open(context.Context, core.LockedModel) (modelcore.Client, error) {
	return m, nil
}
func (m titleTestModel) Generate(ctx context.Context, r modelcore.Request, _ modelcore.Emit) (modelcore.Response, error) {
	return m.generate(ctx, r)
}

func runtimeSessionTitles(t *testing.T, f *agentIntegrationFixture, agent uint64) {
	svc := f.Agents
	old := svc.RuntimeModels
	started, release := make(chan struct{}, 1), make(chan struct{})
	svc.RuntimeModels = titleTestModel{generate: func(ctx context.Context, request modelcore.Request) (modelcore.Response, error) {
		if len(request.Tools) != 0 || len(request.Messages) != 2 {
			return modelcore.Response{}, errors.New("invalid auxiliary request")
		}
		input := request.Messages[1].Content
		if strings.Contains(input, "manual-race") {
			select {
			case started <- struct{}{}:
			default:
			}
			select {
			case <-release:
			case <-ctx.Done():
				return modelcore.Response{}, ctx.Err()
			}
		}
		if strings.Contains(input, "provider-failure") {
			return modelcore.Response{}, errors.New("controlled provider failure")
		}
		in, out, hit := int64(30), int64(4), int64(12)
		return modelcore.Response{Message: modelcore.Message{Role: "assistant", Content: "自动命名测试"}, FinishReason: "stop", Usage: modelcore.Usage{InputTokens: &in, OutputTokens: &out, CacheReadTokens: &hit}}, nil
	}}
	ctx, cancel := context.WithCancel(f.Context)
	done := make(chan struct{})
	errorsSeen := make(chan error, 64)
	go func() {
		defer close(done)
		svc.RunSessionTitles(ctx, func(err error) {
			select {
			case errorsSeen <- err:
			default:
			}
		})
	}()
	t.Cleanup(func() { cancel(); <-done; svc.RuntimeModels = old })
	wait := func(t *testing.T, id uint64, want string) {
		t.Helper()
		deadline := time.NewTimer(10 * time.Second)
		defer deadline.Stop()
		tick := time.NewTicker(20 * time.Millisecond)
		defer tick.Stop()
		for {
			var status string
			if err := f.Store.db.GetContext(f.Context, &status, "SELECT title_generation_status FROM agent_session WHERE id=?", id); err != nil {
				t.Fatal(err)
			}
			if status == want {
				return
			}
			select {
			case <-deadline.C:
				select {
				case err := <-errorsSeen:
					t.Fatal("title worker", err)
				default:
					t.Fatal("title status", status, "want", want)
				}
			case <-tick.C:
			}
		}
	}
	get := func(t *testing.T, id uint64) a.SessionConfiguration {
		t.Helper()
		r, err := svc.GetSessionConfiguration(f.Context, f.AdminToken, id)
		if err != nil {
			t.Fatal(err)
		}
		return r.Data.(a.SessionConfiguration)
	}
	t.Run("success_usage_prefix_and_checkpoint_repair", func(t *testing.T) {
		session := runtimeSession(t, f, agent)
		id := session.Configuration.ID
		x := runtimeClaim(t, f, id, "successful naming")
		before, err := svc.PrepareStep(f.Context, x, 1)
		if err != nil {
			t.Fatal(err)
		}
		wait(t, id, "succeeded")
		if get(t, id).Title != "自动命名测试" {
			t.Fatal("title not installed")
		}
		after, err := svc.PrepareStep(f.Context, x, 2)
		if err != nil {
			t.Fatal(err)
		}
		h1, _ := core.ContentHash(before.Request)
		h2, _ := core.ContentHash(after.Request)
		if h1 != h2 {
			t.Fatal("naming changed main request")
		}
		var calls, in, hit int
		if err = f.Store.db.QueryRowContext(f.Context, "SELECT COUNT(*),SUM(input_tokens),SUM(cache_read_tokens) FROM agent_model_call WHERE session_id=? AND purpose='title'", id).Scan(&calls, &in, &hit); err != nil || calls != 1 || in != 30 || hit != 12 {
			t.Fatal("auxiliary usage not recorded separately", calls, in, hit, err)
		}
		snapshot, err := svc.Snapshot(f.Context, f.AdminToken, id, 2)
		if err != nil {
			t.Fatal(err)
		}
		want := snapshot.Data.(a.ObservationSnapshot)
		if _, err = f.Store.db.ExecContext(f.Context, "UPDATE agent_session_projection SET projection_version=99,payload_sha256=REPEAT('x',32) WHERE session_id=?", id); err != nil {
			t.Fatal(err)
		}
		rebuilt, err := svc.Snapshot(f.Context, f.AdminToken, id, 2)
		if err != nil {
			t.Fatal(err)
		}
		got := rebuilt.Data.(a.ObservationSnapshot)
		if got.State.Conversation.Through != want.State.Conversation.Through || got.State.Conversation.Title != want.State.Conversation.Title || got.State.Conversation.Runs != 1 {
			t.Fatal("checkpoint fallback changed snapshot")
		}
		runtimeEnd(t, f, x)
	})
	t.Run("manual_title_wins_and_refresh_is_explicit", func(t *testing.T) {
		session := runtimeSession(t, f, agent)
		id := session.Configuration.ID
		x := runtimeClaim(t, f, id, "manual-race")
		select {
		case <-started:
		case <-time.After(10 * time.Second):
			t.Fatal("auxiliary request did not start")
		}
		current, err := svc.GetSessionConfiguration(f.Context, f.AdminToken, id)
		if err != nil {
			t.Fatal(err)
		}
		_, err = svc.PatchSessionConfiguration(f.Context, f.AdminToken, id, current.Tag, a.SessionPatch{Title: a.Field[string]{Set: true, Value: "我的手动标题"}})
		if err != nil {
			t.Fatal(err)
		}
		close(release)
		wait(t, id, "succeeded")
		if get(t, id).Title != "我的手动标题" {
			t.Fatal("late result overwrote manual title")
		}
		current, err = svc.GetSessionConfiguration(f.Context, f.AdminToken, id)
		if err != nil {
			t.Fatal(err)
		}
		key := cryptox.ID()
		if _, err = svc.RefreshSessionTitle(f.Context, f.AdminToken, id, current.Tag, key); err != nil {
			t.Fatal(err)
		}
		if _, err = svc.RefreshSessionTitle(f.Context, f.AdminToken, id, current.Tag, key); err != nil {
			t.Fatal("idempotent title refresh", err)
		}
		wait(t, id, "succeeded")
		if get(t, id).Title != "自动命名测试" {
			t.Fatal("explicit refresh did not release manual pin")
		}
		runtimeEnd(t, f, x)
	})
	t.Run("failure_keeps_fallback_without_automatic_retry", func(t *testing.T) {
		session := runtimeSession(t, f, agent)
		id := session.Configuration.ID
		x := runtimeClaim(t, f, id, "provider-failure keep fallback")
		wait(t, id, "failed")
		if get(t, id).Title != "provider-failure keep fallback" {
			t.Fatal("fallback lost")
		}
		var count int
		if err := f.Store.db.GetContext(f.Context, &count, "SELECT COUNT(*) FROM agent_model_call WHERE session_id=? AND purpose='title'", id); err != nil || count != 1 {
			t.Fatal("unexpected naming attempts", count, err)
		}
		runtimeEnd(t, f, x)
	})
	t.Run("old_executor_call_is_interrupted_without_resending", func(t *testing.T) {
		session := runtimeSession(t, f, agent)
		id := session.Configuration.ID
		x := runtimeClaim(t, f, id, "restart recovery")
		wait(t, id, "succeeded")
		// Reconstruct the committed in-flight state left by an old process.
		if _, err := f.Store.db.ExecContext(f.Context, "UPDATE agent_model_call SET status='running',executor_epoch='retired-title-executor',response_event_seq=NULL,finished_at=NULL WHERE session_id=? AND purpose='title'", id); err != nil {
			t.Fatal(err)
		}
		if _, err := f.Store.db.ExecContext(f.Context, "UPDATE agent_session SET title_generation_status='running',title_source='fallback' WHERE id=?", id); err != nil {
			t.Fatal(err)
		}
		wait(t, id, "interrupted")
		var calls int
		var status string
		if err := f.Store.db.QueryRowContext(f.Context, "SELECT COUNT(*),MAX(status) FROM agent_model_call WHERE session_id=? AND purpose='title'", id).Scan(&calls, &status); err != nil || calls != 1 || status != "interrupted" {
			t.Fatal("old title call was resent or not settled", calls, status, err)
		}
		if get(t, id).Title != "自动命名测试" {
			t.Fatal("recovery changed existing title")
		}
		runtimeEnd(t, f, x)
	})
}
