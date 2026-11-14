import type { Availability, Timestamped, Versioned } from "./agents";
import type { Diagnostic, JsonObject } from "./models";

export interface SecretWrite {
  operation: "keep" | "replace" | "clear";
  value?: string;
}
export interface AuthenticationWrite {
  auth_method: "none" | "api_key";
  secret: SecretWrite;
}
export interface ResourceAuthentication {
  auth_method: string;
  has_secret: boolean;
}
export type WebOperation = "search" | "fetch";
export interface WebAccessProviderType {
  provider_type: "deepseek" | "glm";
  name: string;
  supported_operations: WebOperation[];
  auth_methods: string[];
  configuration_schema: JsonObject;
}
export interface BuiltinReader {
  id: "http";
  name: string;
  supported_operations: ["fetch"];
}
export interface WebAccessCatalog {
  items: WebAccessProviderType[];
  builtin_readers: BuiltinReader[];
}
export interface WebAccessProvider extends Versioned, Timestamped {
  id: string;
  code: string;
  name: string;
  description: string;
  provider_type: "deepseek" | "glm";
  enabled: boolean;
  supported_operations: WebOperation[];
  config: { base_url: string; timeout_seconds: number };
  authentication: ResourceAuthentication;
}
export type WebRoute =
  { kind: "provider"; id: string } | { kind: "builtin"; id: "http" };
export interface WebAccessSettingsWrite {
  search: { routes: WebRoute[]; max_results: number };
  fetch: {
    routes: WebRoute[];
    max_bytes: number;
    timeout_seconds: number;
    max_redirects: number;
    allowed_internal_hosts: string[];
  };
}
export interface WebAccessSettings extends WebAccessSettingsWrite, Versioned {}
export interface WebAccessState {
  search: Availability & {
    routes: { route: WebRoute; available: boolean; reason: string | null }[];
  };
  fetch: WebAccessState["search"];
}
export interface MCPConfig {
  url: string;
  transport: "streamable_http";
  timeout_seconds: number;
  requested_protocol_versions: string[];
}
export interface MCPAuthenticationWrite {
  auth_method: "none" | "bearer" | "custom_header";
  header_name: string | null;
  secret: SecretWrite;
}
export interface MCPServer extends Versioned, Timestamped {
  agent_count: number;
  id: string;
  code: string;
  name: string;
  description: string;
  enabled: boolean;
  config: MCPConfig;
  latest_test: MCPDiagnostic | null;
  authentication: ResourceAuthentication & { header_name?: string | null };
}
export interface MCPTool {
  name: string;
  title: string;
  description: string;
  input_schema: JsonObject;
  output_schema: JsonObject | null;
  annotations: JsonObject;
  definition_fingerprint: string;
}
export interface MCPDiagnostic extends Diagnostic {
  outdated: boolean;
  duration_ms: number;
  protocol_version?: string;
}
export interface MCPTestResult {
  session_id?: string;
  expires_at?: string;
  server_version: string;
  diagnostic: MCPDiagnostic;
  tool_count: number;
  tools: MCPTool[];
}
export interface MCPCallResult {
  session_active?: boolean;
  status: "succeeded" | "failed" | "outcome_unknown";
  executed: boolean | null;
  duration_ms: number;
  content: string;
  structured_content: unknown;
  truncated: boolean;
  error: string | null;
}
export interface MCPExample {
  arguments: Record<string, unknown>;
  valid: boolean;
  issues: { path: string; message: string }[];
}
export interface Skill extends Versioned, Timestamped {
  latest_version_id: string | null;
  latest_version_label?: string | null;
  id: string;
  name: string;
  title: string;
  description: string;
  enabled: boolean;
}
export interface SkillSummary extends Skill {
  latest_version_id: string | null;
  latest_version_label: string | null;
}
export interface SkillManifest {
  file_count: number;
  total_bytes: string;
  entries: {
    path: string;
    size_bytes: string;
    sha256: string;
    media_type: string;
  }[];
}
export interface SkillUpload {
  operation_id: string;
  skill_id: string | null;
  uploaded_by: string;
  filename: string;
  size_bytes: string;
  expires_at: string;
  validation_status: "queued" | "running" | "passed" | "failed";
  normalized_name: string | null;
  frontmatter: { name: string; description: string } | null;
  manifest: Pick<SkillManifest, "file_count" | "total_bytes"> | null;
  issues: { code: string; path?: string }[];
  published_skill_version_id: string | null;
}
export interface SkillVersionSummary extends Versioned {
  id: string;
  skill_id: string;
  version_label: string;
  change_note: string;
  content_sha256: string;
  state: "ready" | "deleted";
  created_by: string;
  created_at: string;
  deleted_at: string | null;
}
export interface SkillVersion extends SkillVersionSummary {
  archive_sha256: string;
  manifest: SkillManifest;
  frontmatter: { name: string; description: string };
}
export interface SkillEntry {
  path: string;
  kind: "file" | "directory";
  size_bytes: string | null;
  sha256: string | null;
  media_type: string | null;
}
