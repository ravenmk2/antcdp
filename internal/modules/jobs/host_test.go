package jobs

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"unicode/utf8"

	"github.com/ravenmk2/antcdp/internal/jobadapters/sobek"
	"github.com/ravenmk2/antcdp/internal/jobcore"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
)

func TestAgentScriptMethods(t *testing.T) {
	host := &runHost{s: &Service{AgentChat: func(_ context.Context, _, _, _ uint64, path string, opts AgentChatOptions) (any, error) {
		if path != "platform/review" || opts.Message != "review" || opts.RequestKey != "request" {
			return nil, httpx.Invalid("args", "invalid")
		}
		if opts.WaitForReply {
			return nil, httpx.E(409, "AGENT_RUN_FAILED", "助手调用失败")
		}
		return map[string]string{"status": "accepted"}, nil
	}}}
	result, err := (sobek.Executor{}).Execute(t.Context(), jobcore.Input{Script: `async function main(ctx) {
		const agent = ctx.agents.get("platform/review");
		const opts = {message:"review", requestKey:"request"};
		const receipt = await agent.submit(opts);
		try { await agent.chat(opts); } catch (err) { return [receipt.status, err.code, err.message]; }
	}`}, host)
	if err != nil || string(result.Value) != `["accepted","AGENT_RUN_FAILED","助手调用失败"]` {
		t.Fatalf("agent SDK result %s, error %v", result.Value, err)
	}
}

func TestLogTruncationUsesEncodedBytes(t *testing.T) {
	message := strings.Repeat("\x00中", 10000)
	fields := map[string]json.RawMessage{"a": json.RawMessage(`"kept"`), "large": safeJSON(strings.Repeat("x", 1<<20)), "z": json.RawMessage(`42`)}
	got, raw := boundedLog(message, fields)
	encoded, err := json.Marshal(got)
	if err != nil || !utf8.ValidString(got) || len(encoded)+len(raw) > 16<<10 {
		t.Fatal("invalid encoded log size", len(encoded), len(raw), err)
	}
	var out map[string]any
	if err := json.Unmarshal(raw, &out); err != nil || out["truncated"] != true || out["a"] != "kept" || out["z"] != float64(42) {
		t.Fatal("lost bounded fields or truncation marker", out, err)
	}
	if _, exists := out["large"]; exists {
		t.Fatal("oversized field retained")
	}
}
