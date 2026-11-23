export interface ConnectionConfig {
  host?: string;
  port?: number;
  database?: string;
  tls_mode?: string;
  default_organization?: string;
  base_url?: string;
  custom_ca_pem: string | null;
  host_keys?: string[];
}
export interface ServiceConnection {
  ownership_type?: "platform" | "project";
  project_id?: string | null;
  id: string;
  code: string;
  service_type: string;
  name: string;
  description: string;
  enabled: boolean;
  config?: ConnectionConfig;
  host_key_fingerprints?: Record<string, string>;
  version?: string;
  created_at?: string;
  updated_at?: string;
}
export interface ServiceType {
  service_type: string;
  name: string;
  credentials: boolean;
  credential_verification?: boolean;
  connection_test: boolean;
  auth_methods: string[];
  webhook: { supported: boolean; verification_methods: string[] };
  operations: string[];
}
export interface Authentication {
  auth_method: string;
  identity_config: Record<string, string>;
  secret: Record<string, string>;
}
export type CredentialKind =
  "username_password" | "secret" | "ssh_private_key" | "access_key_pair";
export interface Credential {
  id: string;
  code: string;
  name: string;
  description: string;
  kind: CredentialKind;
  identifier: string;
  enabled: boolean;
  expires_at: string | null;
  scope_kind: "platform" | "project" | "user";
  scope_id: string;
  version: string;
}
export interface CredentialSet {
  items: Credential[];
}
export interface Selection {
  credential_id: string | null;
  version: string;
}
export interface Diagnostic {
  id: string;
  kind: string;
  outdated: boolean;
  status: string;
  started_at: string;
  finished_at: string;
  summary: {
    reachability?: string;
    authentication?: string;
    permissions?: string;
    reason?: string;
    transport?: string;
    database_access?: string;
    organization_access?: string;
    service?: string;
    http_status?: number;
    external_identity?: { id?: string; username: string };
    event_type?: string;
    source_project_id?: string;
    delivery_id?: string;
    host_key?: string;
    fingerprint?: string;
    host_identity?: string;
    host_key_algorithm?: string;
  };
}
export interface WebhookSettings {
  connection_id: string;
  enabled: boolean;
  has_secret: boolean;
  verification_method: string;
  version: string;
  updated_at: string | null;
}
export interface RemoteRepository {
  repo_id: string;
  name: string;
  namespace_path: string;
  full_path: string;
  default_branch: string | null;
  remote_archived: boolean | null;
  web_url: string | null;
  http_clone_url: string | null;
  ssh_clone_url: string | null;
  already_linked?: boolean;
}
export interface RepositoryLabel {
  id: string;
  code: string;
  name: string;
  color: string;
}
export interface RepositoryLabelDefinition extends RepositoryLabel {
  repository_count: number;
}
export interface ProjectRepository extends RemoteRepository {
  labels: RepositoryLabel[];
  id: string;
  connection_id: string;
  connection_name: string;
  service_type: string;
  connection_enabled: boolean;
  last_synced_at: string;
  etag: string;
}
export interface RepositoryGroup {
  id: string;
  name: string;
  full_path: string;
  parent_id: string | null;
  kind?: string;
}
export interface CursorPage<T> {
  items: T[];
  next_cursor: string | null;
}
