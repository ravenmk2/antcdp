package modeladapters

import (
	"encoding/json"
	"math"
	"reflect"
	"strings"
	"testing"

	"github.com/ravenmk2/antcdp/internal/modelcore"
)

func TestRawUsagePreservesOnlyActualProtocolCounters(t *testing.T) {
	var chat modelcore.Usage
	mergeUsage(&chat, json.RawMessage(`{"prompt_tokens":20,"completion_tokens":7,"total_tokens":27,"prompt_cache_hit_tokens":12,"prompt_cache_miss_tokens":8,"prompt_tokens_details":{"cached_tokens":12,"audio_tokens":0,"secret":"never"},"completion_tokens_details":{"reasoning_tokens":4,"rejected_prediction_tokens":-1},"headers":{"Authorization":"secret"},"input_tokens":999}`), modelcore.ChatCompletions)
	want := map[string]int64{"prompt_tokens": 20, "completion_tokens": 7, "total_tokens": 27, "prompt_cache_hit_tokens": 12, "prompt_cache_miss_tokens": 8, "prompt_tokens_details.cached_tokens": 12, "prompt_tokens_details.audio_tokens": 0, "completion_tokens_details.reasoning_tokens": 4}
	if !reflect.DeepEqual(chat.RawNumericFields, want) {
		t.Fatalf("raw counters=%v", chat.RawNumericFields)
	}
	if chat.InputTokens == nil || *chat.InputTokens != 20 || chat.CacheReadTokens == nil || *chat.CacheReadTokens != 12 || chat.CacheWriteTokens != nil {
		t.Fatal("cache read double-counted or unknown cache write fabricated")
	}
	var messages modelcore.Usage
	mergeUsage(&messages, json.RawMessage(`{"input_tokens":5,"output_tokens":1,"cache_read_input_tokens":12}`), modelcore.AnthropicMessages)
	if messages.InputTokens != nil {
		t.Fatal("missing cache write became zero")
	}
	mergeUsage(&messages, json.RawMessage(`{"cache_creation_input_tokens":3,"cache_creation":{"ephemeral_5m_input_tokens":3,"ephemeral_1h_input_tokens":0},"output_tokens":7}`), modelcore.AnthropicMessages)
	if messages.InputTokens == nil || *messages.InputTokens != 20 || messages.OutputTokens == nil || *messages.OutputTokens != 7 || messages.RawNumericFields["input_tokens"] != 5 || messages.RawNumericFields["output_tokens"] != 7 {
		t.Fatal("incremental usage lost original counters or cumulative output")
	}
	before, _ := json.Marshal(messages.RawNumericFields)
	mergeUsage(&messages, json.RawMessage(`{"input_tokens":null,"output_tokens":"8","cache_read_input_tokens":-1,"cache_creation_input_tokens":1.5,"unknown_count":1}`), modelcore.AnthropicMessages)
	after, _ := json.Marshal(messages.RawNumericFields)
	if string(before) != string(after) {
		t.Fatal("malformed counters replaced known actual values")
	}
}

func TestRawUsageIntegerOverflowDoesNotFabricateTotal(t *testing.T) {
	var usage modelcore.Usage
	mergeUsage(&usage, json.RawMessage(`{"input_tokens":9223372036854775807,"cache_read_input_tokens":1,"cache_creation_input_tokens":0,"output_tokens":9223372036854775808}`), modelcore.AnthropicMessages)
	if usage.InputTokens != nil || usage.OutputTokens != nil || usage.RawNumericFields["input_tokens"] != math.MaxInt64 {
		t.Fatal("overflow was converted to a valid total")
	}
	if _, ok := usage.RawNumericFields["output_tokens"]; ok {
		t.Fatal("overflow raw counter accepted")
	}
}

func TestSSEUsageKeepsRawAndNormalizedFactsSeparate(t *testing.T) {
	emit := func(modelcore.Delta) error { return nil }
	chat, e := decodeChat(t.Context(), strings.NewReader(chatToolStream), emit)
	if e != nil {
		t.Fatal(e)
	}
	if chat.Usage.RawNumericFields["prompt_tokens"] != 20 || chat.Usage.RawNumericFields["prompt_cache_hit_tokens"] != 12 {
		t.Fatal("chat stream dropped raw usage")
	}
	messages, e := decodeMessages(t.Context(), strings.NewReader(messagesToolStream), emit)
	if e != nil {
		t.Fatal(e)
	}
	if messages.Usage.RawNumericFields["input_tokens"] != 5 || messages.Usage.RawNumericFields["output_tokens"] != 7 || messages.Usage.InputTokens == nil || *messages.Usage.InputTokens != 20 {
		t.Fatal("messages stream confused uncached and total input")
	}
}
