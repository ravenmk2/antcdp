export interface Rule {
  mode: string;
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
  repository_connections?: { id: string; name: string }[];
  rules: BranchRule[];
  types: BranchType[];
  etag: string;
  can_manage: boolean;
}
export interface ScopeRule extends Rule {
  connection_id: string | null;
}
export interface Scope {
  mode: string;
  repository_ids: string[];
  rules: ScopeRule[];
}
export interface Variant {
  release_tag_prefix?: string;
  id: string;
  code: string;
  name: string;
  summary: string;
  kind: string;
  main_branch: string;
  repository_scope: Scope;
  archived_at: string | null;
  etag: string;
  can_manage: boolean;
  binding_validity: string;
  binding_reason: string;
  repository_count: number;
  environment_count: number;
}
export interface Environment {
  id: string;
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
}
export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
  mutation_version: string;
  scope_token?: string;
  can_manage: boolean;
}
export interface Check {
  branch_name: string;
  status: string;
  reason: string;
  commit_id: string;
  finished_at?: string;
  outdated: boolean;
}
export interface Repository {
  id: string;
  connection_id: string;
  connection_name: string;
  full_path: string;
  last_synced_at: string;
  match_sources?: string[];
  check?: Check;
}
export interface Creation {
  id: string;
  variant_id: string;
  variant_name: string;
  target_branch: string;
  default_source_branch: string;
  status: string;
  expired: boolean;
  etag: string;
  can_execute: boolean;
  can_reconcile: boolean;
  created_at: string;
  counts: Record<string, number>;
}
export interface CreationItem {
  id: string;
  repository_id: string;
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
}
export const emptyScope = (environment = false): Scope => ({
  mode: environment ? "inherit" : "all",
  repository_ids: [],
  rules: [],
});
export const labels: Record<string, string> = {
  valid: "有效",
  invalid: "规则不匹配",
  exists: "存在",
  missing: "不存在",
  unknown: "未确认",
  unchecked: "未校验",
  prepared: "待执行",
  executing: "执行中",
  completed: "已完成",
  partial: "部分完成",
  failed: "失败",
  interrupted: "已中断",
  pending: "待执行",
  creating: "创建中",
  created: "已创建",
  used_existing: "已采用",
  skipped: "已跳过",
  not_started: "未开始",
  ready: "预检通过",
  existing: "目标已存在",
  error: "准备失败",
};
export const reasonLabels: Record<string, string> = {
  branch_name_invalid: "分支名不符合 Git 规则",
  branch_unclassified: "没有匹配的启用类型",
  branch_ambiguous: "匹配多个分支类型",
  branch_type_mismatch: "与指定类型不一致",
  environment_branch_type_forbidden: "该类型不可绑定环境",
  system_preferred_required: "缺少系统首选凭证",
  credential_unavailable: "凭证不可用",
  connection_disabled: "连接已停用",
  authentication_failed: "远端认证失败",
  access_denied: "远端访问被拒绝",
  repository_unavailable: "仓库不可读或不存在",
  source_missing: "来源分支不存在",
  target_exists: "目标已存在",
  target_exists_or_rejected: "目标已存在或远端拒绝创建",
  remote_archived: "仓库已归档",
  timeout: "请求超时，结果需核实",
  invalid_response: "远端响应无法确认",
  state_changed: "状态已变化，请重新预览",
  budget_exceeded: "本批时间预算已用完",
  interrupted: "请求或执行已中断",
  remote_unavailable: "远端不可用",
  rate_limited: "远端请求频率受限",
  connection_unavailable: "连接不可用",
  invalid_request: "远端请求无效",
};
export function reason(value: string) {
  return reasonLabels[value] || value;
}
export function matchSources(values?: string[]) {
  return (values || [])
    .map((v) => {
      if (v === "all") return "全部项目仓库";
      if (v === "inherit") return "继承变体范围";
      if (v === "manual") return "手动选择";
      return v.startsWith("rule:") ? `匹配规则 ${Number(v.slice(5)) + 1}` : v;
    })
    .join("、");
}
export function date(value?: string) {
  return value && !value.startsWith("0001-")
    ? new Date(value).toLocaleString()
    : "暂无检查记录";
}
