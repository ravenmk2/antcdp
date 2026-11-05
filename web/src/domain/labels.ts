import type { Tone } from "@/components/feedback";

export const releaseStatuses: Record<string, string> = {
  draft: "草稿",
  integrating: "合并与备料",
  reviewing: "验收中",
  accepted: "待归档",
  tagging: "归档中",
  archived: "已归档",
  terminated: "已终止",
};
export function releaseStatus(value: string) {
  return releaseStatuses[value] ?? value;
}

export const deliveryLabels: Record<string, string> = {
  valid: "有效",
  invalid: "规则不匹配",
  exists: "存在",
  missing: "不存在",
  unknown: "结果未知",
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
  running: "执行中",
  succeeded: "已成功",
  selected: "已纳入",
  included: "已补录",
  removed: "已移出",
  revert_pending: "待回退",
  reverted: "已回退",
};
export function deliveryLabel(value: string) {
  return deliveryLabels[value] ?? value;
}
export function resultTone(value: string): Tone {
  if (
    [
      "created",
      "created",
      "used_existing",
      "completed",
      "succeeded",
      "exists",
      "valid",
      "ready",
      "accepted",
      "archived",
    ].includes(value)
  )
    return "success";
  if (
    [
      "unknown",
      "partial",
      "interrupted",
      "outdated",
      "missing",
      "prepared",
      "pending",
      "not_started",
      "existing",
    ].includes(value)
  )
    return "warning";
  if (["failed", "error", "rejected", "invalid"].includes(value))
    return "danger";
  if (
    [
      "executing",
      "creating",
      "running",
      "integrating",
      "reviewing",
      "tagging",
    ].includes(value)
  )
    return "info";
  return "neutral";
}
export const reasonLabels: Record<string, string> = {
  branch_name_invalid: "分支名不符合 Git 规则",
  branch_unclassified: "没有匹配的启用类型",
  branch_ambiguous: "匹配多个 Git 分支类型",
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
export function reasonLabel(value: string) {
  return reasonLabels[value] ?? value;
}
