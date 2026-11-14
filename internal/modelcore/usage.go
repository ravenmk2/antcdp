package modelcore

// RawUsageFields is the finite protocol vocabulary accepted at storage and
// public boundaries. Unknown provider fields are deliberately not preserved.
func RawUsageFields(protocol Protocol) []string {
	switch protocol {
	case ChatCompletions:
		return []string{"prompt_tokens", "completion_tokens", "total_tokens", "prompt_cache_hit_tokens", "prompt_cache_miss_tokens", "prompt_tokens_details.cached_tokens", "prompt_tokens_details.audio_tokens", "completion_tokens_details.reasoning_tokens", "completion_tokens_details.audio_tokens", "completion_tokens_details.accepted_prediction_tokens", "completion_tokens_details.rejected_prediction_tokens"}
	case AnthropicMessages:
		return []string{"input_tokens", "output_tokens", "cache_read_input_tokens", "cache_creation_input_tokens", "cache_creation.ephemeral_5m_input_tokens", "cache_creation.ephemeral_1h_input_tokens", "server_tool_use.web_search_requests", "server_tool_use.web_fetch_requests"}
	default:
		return []string{}
	}
}

// FilterRawUsage returns a fresh map, retaining only real nonnegative integer
// counters. It is safe to use again when projecting persisted JSON to an API.
func FilterRawUsage(protocol Protocol, fields map[string]int64) map[string]int64 {
	out := map[string]int64{}
	for _, key := range RawUsageFields(protocol) {
		if value, ok := fields[key]; ok && value >= 0 {
			out[key] = value
		}
	}
	return out
}
