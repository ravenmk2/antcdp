import type { SandboxNetworkPolicy, Versioned } from "./agents";
import type { ResourceAuthentication } from "./agent-resources";

export type CapabilityState = "supported" | "unsupported" | "unknown";
export type CloudCapabilities = Record<
  | "lifecycle"
  | "execution"
  | "execution_inspection"
  | "cancellation"
  | "file_transfer"
  | "persistent_workspace"
  | "network_enforcement"
  | "volume_deletion",
  CapabilityState
>;
export interface CloudEnvironment {
  image: string;
  cpu_millicores: number;
  memory_mib: number;
  network: SandboxNetworkPolicy;
}
export interface CloudTemplate extends Versioned {
  agent_id: string | null;
  environment: CloudEnvironment;
  config_version: string;
}
export interface SandboxConnection extends Versioned {
  endpoint: string | null;
  access_mode: "direct" | "server_proxy";
  connect_timeout_seconds: number;
  operation_timeout_seconds: number;
  authentication: ResourceAuthentication;
  backend_generation: string;
  maintenance_state: string;
  capabilities: CloudCapabilities;
  last_diagnostic: unknown;
  last_diagnostic_at: string | null;
}
export interface CloudConnectionWrite {
  endpoint: string;
  access_mode: "direct" | "server_proxy";
  connect_timeout_seconds: number;
  operation_timeout_seconds: number;
  authentication?: {
    auth_method: "api_key";
    secret: { operation: "keep" | "replace" | "clear"; value?: string };
  };
  confirmation_token?: string;
}
export interface ConnectionPreview {
  confirmation_token: string;
  affected_computers: number;
  busy_activities: number;
  resets_storage: boolean;
  expires_at: string;
}
export type CloudState =
  | "uninitialized"
  | "provisioning"
  | "ready"
  | "paused"
  | "unavailable"
  | "deleting"
  | "deleted";
export interface CloudComputer extends Versioned {
  id: string;
  owner_user_id: string;
  pool_agent_id: string | null;
  state: CloudState;
  backend_generation: string;
  runtime_generation: string;
  storage_generation: string;
  effective_environment: CloudEnvironment | null;
  applied_template_version: string | null;
  volume_state: string;
  runtime_id: string | null;
  volume_id: string | null;
  volume_name: string | null;
  volume_cleanup_state: string;
  capabilities: CloudCapabilities;
  active_leases: number;
  pending_transfers: number;
  unknown_executions: number;
  latest_operation_id: string | null;
  idle_since: string;
  last_activity_at: string;
  error_code: string | null;
}
export type CloudAction = "create" | "rebuild" | "pause" | "resume" | "delete";
export interface CloudOperationResult {
  cloud_computer_id?: string;
  state?: CloudState;
  affected_paths?: string[];
}
export interface CloudFileEntry {
  name: string;
  path: string;
  kind: "file" | "directory";
  size_bytes: string | null;
  modified_at: string | null;
  entry_token: string;
}
