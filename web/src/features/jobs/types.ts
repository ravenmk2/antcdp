export interface Parameter {
  name: string;
  label: string;
  type: "text" | "select" | "multiselect";
  required: boolean;
  default?: string | string[];
  options?: string[];
}
export interface Config {
  run_as_user_id: string;
  script: string;
  parameters: Parameter[];
}
export interface Grant {
  kind: string;
  id: string;
}
export interface Job {
  code: string;
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
}
export interface Run {
  run_as_user_id: string;
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
  code: string;
  schedule_kind: "cron" | "once";
  run_at: string | null;
  max_fires: number | null;
  fire_count: number;
  id: string;
  name: string;
  cron: string;
  inputs: Record<string, string | string[]>;
  enabled: boolean;
  next_fire_at: string | null;
  version: string;
}
export const exampleScript = `async function main(ctx) {
  ctx.log.info("作业开始", { inputs: ctx.inputs });
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
  timeout_stopping: "超时收尾中",
  failure_stopping: "失败收尾中",
  succeeded: "成功",
  failed: "失败",
  cancelled: "已取消",
  timed_out: "超时",
  accepted: "已受理",
  missed: "已错过",
  skipped: "已跳过",
  rejected: "已拒绝",
  pending: "调用中",
  unknown: "结果未知",
  denied: "未授权",
};
