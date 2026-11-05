import type { Page } from "./collaboration";
export type { Page };
export interface Rule {
  mode: "exact" | "glob" | "regex";
  pattern: string;
}
export interface BranchRule {
  branch_type: string;
  enabled: boolean;
  rule: Rule | null;
}
export interface BranchType {
  branch_type: string;
  label: string;
  description: string;
  allow_environment: boolean;
}
export interface BranchModel {
  project_id: string;
  repository_connections: { id: string; name: string }[];
  rules: BranchRule[];
  types: BranchType[];
  etag: string;
  can_manage: boolean;
}
export interface ScopeRule extends Rule {
  connection_id: string | null;
}
export interface Scope {
  mode: "all" | "inherit" | "custom";
  repository_ids: string[];
  rules: ScopeRule[];
}
export interface Variant {
  id: string;
  project_id: string;
  code: string;
  name: string;
  summary: string;
  kind: "standard" | "custom";
  main_branch: string;
  main_branch_type: string;
  repository_scope: Scope;
  release_tag_prefix: string;
  archived_at: string | null;
  etag: string;
  environments_version: string;
  can_manage: boolean;
  binding_validity: string;
  binding_reason: string;
  repository_count: number;
  environment_count: number;
  created_at: string;
  updated_at: string;
}
export interface Environment {
  id: string;
  project_id: string;
  variant_id: string;
  code: string;
  name: string;
  summary: string;
  branch_type: string;
  branch_name: string;
  repository_scope: Scope;
  etag: string;
  can_manage: boolean;
  binding_validity: string;
  binding_reason: string;
  repository_count: number;
  created_at: string;
  updated_at: string;
}
export interface BranchCheck {
  repository_id: string;
  branch_name: string;
  check_id: string;
  status: string;
  reason: string;
  commit_id: string;
  protected: boolean | null;
  default: boolean | null;
  started_at: string;
  finished_at: string;
  outdated: boolean;
}
export interface ScopedRepository {
  id: string;
  connection_id: string;
  connection_name: string;
  full_path: string;
  match_sources: string[];
  check?: BranchCheck;
}
export interface Creation {
  id: string;
  project_id: string;
  variant_id: string;
  retry_of_id?: string;
  variant_name: string;
  target_branch: string;
  default_source_branch: string;
  status: string;
  expired: boolean;
  etag: string;
  can_execute: boolean;
  can_reconcile: boolean;
  can_manage: boolean;
  created_at: string;
  updated_at: string;
  expires_at: string;
  started_at: string | null;
  finished_at: string | null;
  counts: Record<string, number>;
}
export interface CreationItem {
  id: string;
  creation_id: string;
  repository_id: string;
  connection_id: string;
  repo_id: string;
  repository_path: string;
  source_branch: string;
  source_commit_id: string;
  preview_target_commit_id: string;
  preview_state: string;
  preview_reason: string;
  action: string;
  status: string;
  reason: string;
  result_commit_id: string;
  reconciliation: {
    status: string;
    reason: string;
    commit_id: string;
    checked_at: string;
  } | null;
  started_at: string | null;
  finished_at: string | null;
}
export interface Release {
  id: string;
  current_manifest_id?: string;
  end_reason?: string;
  name: string;
  version_label: string;
  tag_name: string;
  description_md: string;
  status: string;
  needs_attention: boolean;
  updated_at: string;
  etag: string;
}
export interface ProjectRelease extends Release {
  variant_id: string;
  variant_name: string;
  variant_code: string;
}
export interface Workspace {
  repository_count: number;
  variants: Page<Variant>;
  releases: Page<ProjectRelease>;
  attention: Page<ProjectRelease>;
}
export type MaterialKind = "sql" | "object" | "config" | "attachment";
export interface Material {
  id: string;
  kind: MaterialKind;
  filename: string;
  description_md: string;
  repository_id: string;
  database_name: string;
  bucket_name: string;
  target_path: string;
  config_format: string;
  config_mode: string;
  revision_id: string;
  revision_no: number;
  size_bytes: number;
  sha256: string;
  sql_position: number;
}
export interface ReleaseRepository {
  id: string;
  connection_id: string;
  remote_id: string;
  project_repository_id: string;
  full_path: string;
  main_branch: string;
  baseline_sha: string;
  baseline_kind: string;
}
export interface MaterialSet {
  items: Material[];
  repositories: ReleaseRepository[];
  can_edit: boolean;
}
export interface ReleaseChange {
  id: string;
  repo_id: string;
  kind: string;
  ref: string;
  status: string;
  evidence: Record<string, unknown>;
  note: string;
  reverted_by?: string;
}
export interface Manifest {
  id: string;
  sequence_no: number;
  header: Record<string, unknown>;
  digest: string;
  decision: string;
  review_note: string;
  created_at: string;
  reviewer_id?: string;
  reviewed_at?: string;
}
export interface ReleaseOperation {
  id: string;
  actor_id: string;
  kind: string;
  status: string;
  created_at: string;
}
export interface ReleaseStep {
  id: string;
  operation_id: string;
  repo_id: string;
  kind: string;
  status: string;
  intent: Record<string, unknown>;
  observed: { reason?: string; [key: string]: unknown } | null;
  updated_at: string;
}
export interface ReleaseFlow {
  changes: ReleaseChange[];
  manifests: Manifest[];
  operations: ReleaseOperation[];
  steps: ReleaseStep[];
  can_manage: boolean;
}
export interface MergeRequest {
  iid: number;
  title: string;
  state: string;
  sha: string;
  merge_commit_sha?: string;
  squash_commit_sha?: string;
  source_branch?: string;
  target_branch?: string;
}
