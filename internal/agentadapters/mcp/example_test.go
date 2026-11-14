package mcp

import (
	"encoding/json"
	"testing"
)

func TestExampleGenerationValidatesFullSchema(t *testing.T) {
	for _, raw := range []string{
		`{"type":"object","properties":{"x":{"type":"integer","minimum":3,"default":1,"examples":[4]},"flag":{"const":false}},"required":["x","flag"]}`,
		`{"type":"object","$defs":{"word":{"type":"string","minLength":8}},"properties":{"child":{"type":"object","properties":{"value":{"$ref":"#/$defs/word"}},"required":["value"]},"numbers":{"type":"array","minItems":2,"items":{"type":"integer","minimum":5,"maximum":9,"multipleOf":2}}},"required":["child","numbers"]}`,
		`{"type":"object","properties":{"choice":{"oneOf":[{"const":0},{"const":"ok"}]}},"required":["choice"]}`,
	} {
		example, err := GenerateExample(json.RawMessage(raw))
		if err != nil {
			t.Fatal(err)
		}
		if !example.Valid || len(example.Issues) != 0 {
			t.Fatalf("valid example not generated: %+v", example)
		}
		args, err := json.Marshal(example.Arguments)
		if err != nil {
			t.Fatal(err)
		}
		if err := ValidateArguments(json.RawMessage(raw), args); err != nil {
			t.Fatal(err)
		}
	}
}

func TestExampleGenerationMarksUnsupportedAndBoundedDrafts(t *testing.T) {
	for _, raw := range []string{
		`{"type":"object","properties":{"id":{"type":"string","pattern":"^ID-[0-9]{4}$"}},"required":["id"]}`,
		`{"type":"object","properties":{"items":{"type":"array","minItems":1000000,"items":{"type":"string"}}},"required":["items"]}`,
		`{"type":"object","properties":{"n":{"type":"number","minimum":10,"maximum":1}},"required":["n"]}`,
	} {
		example, err := GenerateExample(json.RawMessage(raw))
		if err != nil {
			t.Fatal(err)
		}
		if example.Valid || len(example.Issues) == 0 {
			t.Fatalf("unsupported constraints claimed valid: %+v", example)
		}
		data, _ := json.Marshal(example)
		if len(data) > 4096 {
			t.Fatalf("unbounded draft: %d", len(data))
		}
	}
}

func TestPersistentSessionInitializesOnceAndResetsDispatchGuard(t *testing.T) {
	for _, protocol := range Protocols() {
		t.Run(protocol.Version, func(t *testing.T) {
			client, _, calls, methods, mu := fixture(t, protocol.Version, true)
			session, err := client.Open(t.Context())
			if err != nil {
				t.Fatal(err)
			}
			defer func() { _ = session.Close() }()
			found, err := session.Discover(t.Context())
			if err != nil {
				t.Fatal(err)
			}
			request := CallRequest{RemoteName: "echo", Fingerprint: found.Tools[0].Fingerprint, Arguments: json.RawMessage(`{"value":"one"}`), ResultLimit: 4096}
			for range 2 {
				result, err := session.Call(t.Context(), request)
				if err != nil || result.Executed == nil || !*result.Executed {
					t.Fatalf("call: %+v %v", result, err)
				}
			}
			request.Arguments = json.RawMessage(`{"value":42}`)
			result, err := session.Call(t.Context(), request)
			testError(t, err, "MCP_ARGUMENTS_INVALID")
			if result.Executed == nil || *result.Executed || calls.Load() != 2 {
				t.Fatal("previous dispatch affected current invalid request")
			}
			_, err = session.Discover(t.Context())
			if err != nil {
				t.Fatal(err)
			}
			mu.Lock()
			defer mu.Unlock()
			initializations := 0
			for _, method := range *methods {
				if method == "initialize" {
					initializations++
				}
			}
			expected := 1
			if protocol.Lifecycle == "stateless" {
				expected = 0
			}
			if initializations != expected {
				t.Fatalf("initializations=%d methods=%v", initializations, *methods)
			}
		})
	}
}
