package modelcore

import "testing"

func TestRawUsageWhitelistRejectsSecretFieldsAndDoesNotAlias(t *testing.T) {
	input := map[string]int64{"prompt_tokens": 12, "completion_tokens": -1, "secret": 2, "input_tokens": 9}
	filtered := FilterRawUsage(ChatCompletions, input)
	if len(filtered) != 1 || filtered["prompt_tokens"] != 12 {
		t.Fatal(filtered)
	}
	filtered["prompt_tokens"] = 20
	if input["prompt_tokens"] != 12 {
		t.Fatal("mutated caller counters")
	}
	if len(FilterRawUsage("unsupported", input)) != 0 {
		t.Fatal("unknown protocol accepted counters")
	}
}
