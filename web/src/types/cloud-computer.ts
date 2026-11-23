import type { DiagnosticDetail } from "./agent-events";
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
export interface SandboxSpec extends CloudEnvironment, Versioned {
  id: string;
  name: string;
  config_version: string;
}
export interface SpecBinding extends Versioned {
  agent_id: string | null;
  spec_id: string | null;
  spec: SandboxSpec | null;
}
export interface SpecReference {
  agent_id: string | null;
  name: string;
}
export interface SandboxConnection {
  configured: boolean;
  type: string;
  endpoint: string | null;
  access_mode: "direct" | "server_proxy";
  connect_timeout_seconds: number;
  operation_timeout_seconds: number;
  authentication: ResourceAuthentication;
  backend_generation: string;
  maintenance_state: string;
  capabilities: CloudCapabilities;
  last_diagnostic: {
    healthy: boolean;
    elapsed_ms: number;
    error_code: string;
  } | null;
  last_diagnostic_at: string | null;
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
  terminal_sessions?: number;
  id: string;
  owner_user_id: string;
  pool_agent_id: string | null;
  state: CloudState;
  backend_generation: string;
  sandbox_instance_id: string;
  storage_generation: string;
  effective_environment: CloudEnvironment | null;
  applied_spec_id?: string | null;
  applied_spec_version?: string | null;
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
  diagnostic?: DiagnosticDetail | null;
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
