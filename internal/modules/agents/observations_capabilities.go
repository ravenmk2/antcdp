package agents

import (
	"context"

	"github.com/ravenmk2/antcdp/internal/modules/identity"
)

type ImplementedFeatures struct {
	Chat    bool `json:"chat"`
	Child   bool `json:"temporary_child"`
	Skills  bool `json:"skills"`
	MCP     bool `json:"mcp_http"`
	Sandbox bool `json:"sandbox"`
}

func (s *Service) Capabilities(ctx context.Context, raw string, features ImplementedFeatures) (*Result, error) {
	return s.observationAccess(ctx, raw, func(_ identity.Tx, _ Repository, _ *identity.Auth, out *Result) error {
		out.Data = map[string]any{"features": features, "attachments": map[string]any{"image_media_types": []string{"image/png", "image/jpeg", "image/webp"}, "image_max_width": 4096, "image_max_height": 4096, "image_max_pixels": 16777216, "other_files": true}, "limits": map[string]int{"json_bytes": 64 << 10, "agent_json_bytes": 256 << 10, "system_prompt_bytes": 128 << 10, "input_text_blocks": 16, "input_text_bytes": 32 << 10, "input_file_refs": 10, "attachment_file_bytes": 32 << 20, "attachment_multipart_bytes": 33 << 20, "skill_zip_bytes": 20 << 20, "skill_multipart_bytes": 21 << 20, "skill_expanded_bytes": 100 << 20, "skill_file_bytes": 10 << 20, "skill_file_count": 2000, "skill_compression_ratio": 100, "skill_parse_timeout_seconds": 30, "present_file_count": 20, "present_file_bytes": 100 << 20, "present_total_bytes": 200 << 20, "model_bindings": 32, "tool_bindings": 128, "skill_bindings": 32, "mcp_bindings": 32, "event_payload_bytes": 256 << 10, "history_bytes": 1 << 20, "ws_frame_bytes": 2 << 20, "ws_client_frame_bytes": 16 << 10, "ws_connections_per_user": 3, "ws_subscriptions_per_connection": 8}}
		return nil
	})
}
