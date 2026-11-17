package events

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/ravenmk2/antcdp/internal/scriptadapters/sobek"
	"github.com/ravenmk2/antcdp/internal/scriptcore"
)

func TestConsumerSDKIsolationAndLazyReferences(t *testing.T) {
	h := &consumerHost{attempt: attempt{Revision: Revision{Script: `async function main(ctx) {
 if(ctx.inputs !== undefined || ctx.resources !== undefined || ctx.dingtalk !== undefined) throw Error("Job SDK leaked");
 if(!Object.isFrozen(ctx.event) || !Object.isFrozen(ctx.event.data) || !Object.isFrozen(ctx.run)) throw Error("mutable context");
 const unused = ctx.jobs.get("/project/example/build");
 const job = ctx.jobs.get("build");
 const agent = ctx.agents.get("platform/reviewer");
 if(!Object.isFrozen(unused) || typeof unused.start !== "function" || agent.run !== undefined) throw Error("wrong references");
 const first=await job.start({inputs:{branch:"main"},requestKey:"build:1"});
 const second=await agent.chat({message:"review",requestKey:"chat:1"});
 return {first,second};
}`}, Reference: Reference{Event: &Record{ID: 1, Data: json.RawMessage(`{"nested":{}}`), Raw: json.RawMessage(`{}`)}}}}
	input := h.input()
	calls := []string{}
	for _, name := range []string{"jobStart", "agentChat"} {
		input.Functions[name] = scriptcore.Function{Async: true, Call: func(_ context.Context, args []json.RawMessage) (any, error) {
			calls = append(calls, name)
			return map[string]any{"path": args[0]}, nil
		}}
	}
	result, err := (sobek.Executor{}).Execute(context.Background(), input)
	if err != nil || !result.HasValue || len(calls) != 2 || !strings.Contains(string(result.Value), "platform/reviewer") {
		t.Fatal("isolated consumer SDK", string(result.Value), calls, err)
	}
	input.Script = `function main(ctx){ctx.jobs.get("//build")}`
	if _, err = (sobek.Executor{}).Execute(context.Background(), input); err == nil {
		t.Fatal("invalid locator accepted")
	}
}

func TestPublicFailureDoesNotExposeScript(t *testing.T) {
	code, message := failure(scriptcore.Failure("SCRIPT_ERROR", "SECRET_INLINE_TOKEN at consumer.js:3"))
	if code != "SCRIPT_ERROR" || strings.Contains(message, "SECRET") || strings.Contains(message, "consumer.js") {
		t.Fatal("private source leaked", code, message)
	}
}
