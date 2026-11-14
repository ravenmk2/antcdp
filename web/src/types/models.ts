export type ProviderKind = "deepseek" | "minimax" | "glm" | "ollama" | "custom";
export type ModelProtocol = "chat_completions" | "anthropic_messages";
export type JsonObject = Record<string, unknown>;
export interface ProviderType {
  default_base_url: string;
  default_icon_key: string;
  provider_type: ProviderKind;
  name: string;
  protocols: {
    protocol: ModelProtocol;
    available: boolean;
    reason: string | null;
    parameter_schema: JsonObject;
    thinking_options?: ThinkingOption[];
  }[];
  auth_methods: ("none" | "api_key")[];
  discovery_supported: boolean;
}
export interface ProviderConfig {
  base_url: string;
  region: string | null;
  custom_ca_pem: string | null;
  connect_timeout_seconds: number;
  request_timeout_seconds: number;
}
export interface ModelProvider {
  icon_key: string | null;
  id: string;
  code: string;
  name: string;
  description: string;
  provider_type: ProviderKind;
  enabled: boolean;
  config: ProviderConfig;
  authentication: { auth_method: "none" | "api_key"; has_secret: boolean };
  version: string;
  created_at: string;
  updated_at: string;
}
export interface ModelProviderSummary extends Omit<
  ModelProvider,
  "config" | "authentication"
> {
  endpoint_display: string;
  model_count: number;
  has_secret: boolean;
  auth_method: "none" | "api_key";
}
export type CapabilityState = "supported" | "unsupported" | "unknown";
export type ModelCapabilities = Record<
  "text_input" | "image_input" | "tool_calling" | "streaming" | "thinking",
  CapabilityState
>;
export interface ThinkingOption {
  key: string;
  label: string;
  parameters: JsonObject;
}
export interface ModelSummary {
  icon_key: string | null;
  id: string;
  provider_id: string;
  name: string;
  model_id: string;
  protocol: ModelProtocol;
  enabled: boolean;
  declared_capabilities: ModelCapabilities;
  version: string;
}
export interface ModelDefinition extends ModelSummary {
  description: string;
  context_window: number;
  max_output_tokens: number;
  default_parameters: JsonObject;
  thinking_options: ThinkingOption[];
  thinking_levels: string[];
  thinking_mapping: Record<string, JsonObject>;
  created_at: string;
  updated_at: string;
}
export interface Diagnostic {
  kind: string;
  status: "succeeded" | "failed" | "unsupported";
  started_at: string;
  finished_at: string;
  checks: {
    name: string;
    status: "succeeded" | "failed" | "unsupported" | "skipped";
    reason: string | null;
  }[];
  capabilities?: ModelCapabilities | null;
  usage?: {
    input_tokens: number | null;
    output_tokens: number | null;
    cache_read_tokens: number | null;
    cache_write_tokens: number | null;
    normalization_version: string;
  } | null;
}

export interface ModelIconOption {
  key: string;
  label: string;
}
export interface ModelCatalog {
  items: ProviderType[];
  icons: ModelIconOption[];
}
export interface ModelTestResult {
  diagnostic?: Diagnostic;
  models?: { model_id: string; display_name: string | null }[];
  truncated?: boolean;
}
