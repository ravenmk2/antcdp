package sobek

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/ravenmk2/antcdp/internal/jobcore"
)

type testHost struct{}

type testETag string
type jsonHost struct{ testHost }

func (jsonHost) State(context.Context, string, string, json.RawMessage, json.RawMessage) (any, error) {
	return map[string]any{"etag": testETag("opaque"), "value": map[string]any{"items": []string{"a", "b"}}}, nil
}
func (jsonHost) Call(context.Context, string, []json.RawMessage) (any, error) {
	return map[string]any{"id": testETag("42")}, nil
}
func TestHostResultsAreNativeJSONValues(t *testing.T) {
	source := `async function main(ctx){const s=ctx.state.get("key");s.value.items.push("c");JSON.parse=()=>{throw Error("overridden")};const r=await ctx.dingtalk.send("x");return {etag:s.etag,items:s.value.items,id:r.id}}`
	result, err := (Executor{}).Execute(context.Background(), jobcore.Input{Script: source}, jsonHost{})
	if err != nil || string(result.Value) != `{"etag":"opaque","items":["a","b","c"],"id":"42"}` {
		t.Fatal(string(result.Value), err)
	}
}

func (testHost) State(context.Context, string, string, json.RawMessage, json.RawMessage) (any, error) {
	return nil, nil
}
func (testHost) Log(context.Context, string, string, json.RawMessage) error { return nil }
func (testHost) Call(context.Context, string, []json.RawMessage) (any, error) {
	return nil, jobcore.Failure("DENIED", "denied")
}
func TestLifecycle(t *testing.T) {
	cases := []struct{ name, source, code string }{
		{"sync", "function main(ctx){return {ok:true}}", ""},
		{"parallel", "async function main(ctx){await Promise.all([ctx.sleep(5),ctx.sleep(10)]); return 42}", ""},
		{"sleep rejects coercion", "async function main(ctx){await ctx.sleep('5')}", "INVALID_DELAY"},
		{"state key rejects coercion", "function main(ctx){return ctx.state.get(undefined)}", "INVALID_ARGUMENT"},
		{"settled errors", "async function main(ctx){return (await Promise.allSettled([ctx.dingtalk.send('x')]))[0].status}", ""},
		{"serializable host error", "async function main(ctx){return await Promise.allSettled([ctx.dingtalk.send('x')])}", ""},
		{"unawaited", "function main(ctx){ctx.sleep(1000)}", "UNAWAITED_HOST_CALL"},
		{"pending forever", "async function main(ctx){await new Promise(()=>{})}", "UNSETTLED_PROMISE"},
		{"rejected", "async function main(ctx){await ctx.dingtalk.send('x')}", "DENIED"},
		{"agent access denied", "async function main(ctx){await ctx.agents.get('review').chat({message:'Review',requestKey:'mr-42'})}", "DENIED"},
		{"unhandled", "async function main(ctx){Promise.reject('bad');await ctx.sleep(10)}", "UNHANDLED_REJECTION"},
		{"cycle", "function main(){let x={};x.x=x;return x}", "INVALID_RESULT"},
		{"non json", "function main(){return {bad:undefined}}", "INVALID_RESULT"},
		{"map is not an empty object", "function main(){return new Map([['key',1]])}", "INVALID_RESULT"},
		{"set is not an empty object", "function main(){return new Set([1])}", "INVALID_RESULT"},
		{"symbol property", "function main(){return {[Symbol('key')]:1}}", "INVALID_RESULT"},
		{"bigint toJSON", "BigInt.prototype.toJSON=function(){return 'hidden'};function main(){return 1n}", "INVALID_RESULT"},
		{"date is not a string", "function main(){return new Date()}", "INVALID_RESULT"},
		{"decorated array", "function main(){const a=[1];a.extra=2;return a}", "INVALID_RESULT"},
		{"inherited array entry", "function main(){const a=[,];a.extra=1;Object.setPrototypeOf(a,{0:2});return a}", "INVALID_RESULT"},
		{"getter is read once", "function main(){let n=0;return {get value(){if(++n>1)throw Error('twice');return 1}}}", ""},
		{"immutable clone", "function main(){Object.keys=()=>[];Object.prototype.toJSON=()=>null;return {bad:undefined}}", "INVALID_RESULT"},
		{"immutable serializer", "function main(){JSON.stringify=()=> 'null';Number.isFinite=()=>true;return {bad:undefined}}", "INVALID_RESULT"},
		{"script cannot forge host reason", "function main(){throw {code:'RUN_TIMEOUT',message:'custom'}}", "SCRIPT_ERROR"},
		{"serialization host work", "function main(ctx){return {get x(){ctx.sleep(1000);return 1}}}", "UNAWAITED_HOST_CALL"},
		{"throwing exception property", "function main(){throw {get stack(){throw Error('bad')}}}", "SCRIPT_ERROR"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			ctx, cancel := context.WithTimeout(context.Background(), time.Second)
			defer cancel()
			_, err := (Executor{}).Execute(ctx, jobcore.Input{Script: tc.source, Inputs: map[string]any{}, Run: map[string]any{}}, testHost{})
			if tc.code == "" {
				if err != nil {
					t.Fatal(err)
				}
			} else if err == nil || jobcore.Code(err) != tc.code {
				t.Fatalf("want %s, got %v", tc.code, err)
			}
		})
	}
}
func TestInterrupt(t *testing.T) {
	for _, source := range []string{"function main(){while(true){}}", "async function main(ctx){await ctx.sleep(5000)}", "while(true){};function main(){}"} {
		ctx, cancel := context.WithTimeout(context.Background(), 25*time.Millisecond)
		_, err := (Executor{}).Execute(ctx, jobcore.Input{Script: source}, testHost{})
		cancel()
		if !errors.Is(err, context.DeadlineExceeded) {
			t.Fatalf("not interrupted: %v", err)
		}
	}
}

type drainingHost struct {
	testHost
	release <-chan struct{}
}

func (h drainingHost) Call(ctx context.Context, _ string, _ []json.RawMessage) (any, error) {
	<-ctx.Done()
	<-h.release
	return nil, ctx.Err()
}
func TestFailureDrainsHostBeforeReturning(t *testing.T) {
	release := make(chan struct{})
	stopping := make(chan struct{})
	done := make(chan error, 1)
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	go func() {
		_, err := (Executor{}).Execute(ctx, jobcore.Input{Script: `function main(ctx){ctx.dingtalk.send("test")}`, OnStopping: func(error) { close(stopping) }}, drainingHost{release: release})
		done <- err
	}()
	select {
	case <-stopping:
	case <-ctx.Done():
		close(release)
		t.Fatal("stop intent was not emitted")
	}
	select {
	case <-done:
		close(release)
		t.Fatal("executor returned while host work was active")
	default:
	}
	close(release)
	select {
	case err := <-done:
		if jobcore.Code(err) != "UNAWAITED_HOST_CALL" {
			t.Fatal(err)
		}
	case <-ctx.Done():
		t.Fatal("host work was not drained")
	}
}
