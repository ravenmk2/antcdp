export interface Parameter {
  name: string;
  label: string;
  type: "text" | "select" | "multiselect";
  required: boolean;
  default?: string | string[];
  options?: string[];
}
export interface Binding {
  name: string;
  grant_id: string;
  connection_id: string;
  connection_code: string;
}
export interface Config {
  script: string;
  parameters: Parameter[];
  bindings: Binding[];
}
export interface Grant {
  kind: string;
  id: string;
}
export interface ResourceGrant {
  id: string;
  connection_id: string;
  credential_id: string;
  status: string;
}
export interface Job {
  id: string;
  revision_id: string | null;
  name: string;
  description: string;
  enabled: boolean;
  max_concurrency: number;
  busy_policy: string;
  timeout_ms: number;
  version: string;
  can_manage: boolean;
  can_run: boolean;
  queued_count: number;
  active_count: number;
  latest_status: string;
  next_fire_at: string | null;
  config?: Config;
  parameters: Parameter[];
  grants?: Grant[];
  resource_grants?: ResourceGrant[];
}
export interface Run {
  id: string;
  status: string;
  trigger_kind: string;
  stop_reason: string;
  actor_user_id: string | null;
  queued_at: string;
  started_at: string | null;
  finished_at: string | null;
  inputs: Record<string, string | string[]>;
  result: unknown;
  has_result: boolean;
  error_code: string;
  error_summary: string;
  state_mode: string;
  last_log_seq: number;
  script_logs_truncated: boolean;
}
export interface Log {
  seq: number;
  occurred_at: string;
  kind: string;
  level: string;
  message: string;
  fields: Record<string, unknown> | null;
  resource_call_id?: string;
}
export interface ResourceCall {
  id: string;
  resource_kind: string;
  target: string;
  operation: string;
  outcome: string;
  error_code: string;
  resource: unknown;
  created_at: string;
}
export interface Observation {
  run: Run;
  logs: Log[];
  calls: ResourceCall[];
  can_cancel: boolean;
}
export interface Receipt {
  id: string;
  outcome: string;
  reason_code: string;
  run_id: string | null;
  created_at: string;
  trigger_kind: string;
  actor_user_id: string;
}
export interface Schedule {
  id: string;
  name: string;
  cron: string;
  timezone: string;
  inputs: Record<string, string | string[]>;
  enabled: boolean;
  next_fire_at: string | null;
  version: string;
}
export const exampleScript = `async function main(ctx) {
  ctx.log.info("任务开始", { inputs: ctx.inputs });
  const previous = ctx.state.get("运行次数");
  const count = (previous?.value ?? 0) + 1;
  ctx.state.put("运行次数", count, previous ? { ifMatch: previous.etag } : { ifAbsent: true });
  await Promise.all([ctx.sleep(300), ctx.sleep(500)]);
  ctx.log.info("并行等待完成", { count });
  return { count };
}`;
export const terminal = (status: string) =>
  ["succeeded", "failed", "cancelled", "timed_out"].includes(status);
export const statusLabel: Record<string, string> = {
  queued: "排队中",
  running: "运行中",
  cancelling: "取消中",
  stopping: "停止中",
  succeeded: "成功",
  failed: "失败",
  cancelled: "已取消",
  timed_out: "超时",
  accepted: "已受理",
  skipped: "已跳过",
  rejected: "已拒绝",
  pending: "调用中",
  unknown: "结果未知",
  denied: "未授权",
};
