package papi

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/ravenmk2/antcdp/internal/agentcore"
)

func TestEchoReturnsExactArguments(t *testing.T) {
	r, err := New()
	if err != nil {
		t.Fatal(err)
	}
	grant, ok := r.Freeze("echo", json.RawMessage(`{}`))
	if !ok {
		t.Fatal("missing echo")
	}
	x := agentcore.ExecutionContext{PAPIGrants: []agentcore.PAPIGrant{grant}}
	for _, args := range []string{`{}`, `{ "n":9007199254740993, "precision": 0.1234567890123456789, "a":[null,true,{"message":"\u4f60好"}] }`, `{"s":"` + strings.Repeat("a", (8<<10)-8) + `"}`} {
		raw := `{"api":"echo","args":` + args + `}`
		permit, err := r.Prepare(t.Context(), x, CallTool, raw)
		if err != nil {
			t.Fatal(err)
		}
		got, err := r.Dispatch(t.Context(), x, CallTool, raw, permit)
		if err != nil || string(got) != args {
			t.Fatalf("echo changed input, length=%d: %v", len(args), err)
		}
	}
	for _, args := range []string{`null`, `[]`, `"string"`, `{"a":[{"x":1,"\u0078":2}]}`, `{"s":"` + strings.Repeat("a", (8<<10)-7) + `"}`} {
		_, err := r.Prepare(t.Context(), x, CallTool, `{"api":"echo","args":`+args+`}`)
		var failure *Failure
		if !errors.As(err, &failure) || failure.Code != InvalidArguments || failure.Field == "" {
			t.Fatalf("invalid arguments accepted or not explained: %v", err)
		}
	}
}

func TestDiscoveryAndExecutionShareFrozenAuthorization(t *testing.T) {
	r, err := New()
	if err != nil {
		t.Fatal(err)
	}
	const constraints = `{"args_schema":{"properties":{"n":{"type":"integer","minimum":9007199254740993,"enum":[9007199254740993,9007199254740994]}},"required":["n"],"additionalProperties":false}}`
	if _, err = ParseConstraints(json.RawMessage(constraints)); err != nil {
		t.Fatal(err)
	}
	grant, _ := r.Freeze("echo", json.RawMessage(constraints))
	x := agentcore.ExecutionContext{PAPIGrants: []agentcore.PAPIGrant{grant}}
	description, err := r.Prepare(t.Context(), x, DescTool, `{"api":"echo"}`)
	if err != nil {
		t.Fatal(err)
	}
	got, err := r.Dispatch(t.Context(), x, DescTool, `{"api":"echo"}`, description)
	if err != nil || !strings.Contains(string(got), `"allOf"`) || !strings.Contains(string(got), `9007199254740993`) || strings.Contains(string(got), `"example_args"`) {
		t.Fatalf("description did not apply the same restriction: %s (%v)", got, err)
	}
	if _, err := r.Prepare(t.Context(), x, CallTool, `{"api":"echo","args":{"n":9007199254740993}}`); err != nil {
		t.Fatal(err)
	}
	_, err = r.Prepare(t.Context(), x, CallTool, `{"api":"echo","args":{"n":9007199254740992}}`)
	var failure *Failure
	if !errors.As(err, &failure) || failure.Field != "/args/n" || failure.Code != InvalidArguments {
		t.Fatalf("numeric constraint error: %v", err)
	}
	empty := agentcore.ExecutionContext{}
	for _, key := range []string{DescTool, CallTool} {
		_, err = r.Prepare(t.Context(), empty, key, `{"api":"echo","args":{}}`)
		if !errors.As(err, &failure) || failure.Code != Unavailable {
			t.Fatalf("missing grant not enforced by %s: %v", key, err)
		}
	}
	x.PAPIGrants[0].Fingerprint = "old"
	_, err = r.Prepare(t.Context(), x, DescTool, `{"api":"echo"}`)
	if !errors.As(err, &failure) || failure.Code != DefinitionChanged {
		t.Fatalf("wrong error after definition change: %v", err)
	}
}

func TestOffsetListingFiltersBeforePaging(t *testing.T) {
	r, err := New()
	if err != nil {
		t.Fatal(err)
	}
	original := r.Operation("echo")
	for _, code := range []string{"a.unauthorized", "b.echo", "c.echo"} {
		op := *original
		op.Code = code
		r.operations[code] = &op
	}
	r.codes = []string{"a.unauthorized", "b.echo", "c.echo", "echo"}
	grants := make([]agentcore.PAPIGrant, 0, 2)
	for _, code := range []string{"b.echo", "c.echo"} {
		grant, _ := r.Freeze(code, json.RawMessage(`{}`))
		grants = append(grants, grant)
	}
	first := r.list(grants, toolInput{Query: "ECHO", Limit: "1"})
	if len(first.Items) != 1 || first.Items[0].API != "b.echo" || first.NextOffset != 1 {
		t.Fatalf("first page: %#v", first)
	}
	last := r.list(grants, toolInput{Offset: "1.0", Limit: "1"})
	if len(last.Items) != 1 || last.Items[0].API != "c.echo" || last.NextOffset != 0 {
		t.Fatalf("last page: %#v", last)
	}
	if got := r.list(grants, toolInput{Offset: "1000000000000000000000"}); len(got.Items) != 0 || got.Items == nil {
		t.Fatalf("out of range: %#v", got)
	}
}

func TestUnsupportedParameterSchemas(t *testing.T) {
	for _, schema := range []string{`null`, `{"$ref":"https://example.test"}`, `{"type":"string"}`, `{"Minimum":0}`, `{"enum":[]}`, `{"properties":{"value":{"minimum":"7"}}}`} {
		if _, err := ParseConstraints(json.RawMessage(`{"args_schema":` + schema + `}`)); err == nil {
			t.Fatalf("accepted invalid schema: %s", schema)
		}
	}
}
