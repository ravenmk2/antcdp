export interface EventType {
  code: string;
  name: string;
  description: string;
}
export interface Group {
  code: string;
  name: string;
  types: EventType[];
}
export interface EventReference {
  id: string;
  event_id: string;
  created_at: string;
  routing_basis: unknown;
  event: {
    id: string;
    group: string;
    type: string;
    source_event_type: string;
    source_repository_id: string;
    subject_kind: string;
    subject_id: string;
    received_at: string;
    occurred_at: string | null;
    data: unknown;
    raw: unknown;
    source_metadata: unknown;
    routing_result: string;
  };
}
export interface Revision {
  id: string;
  revision_no: number;
  event_types: string[];
  executor_user_id: string;
  timeout_ms: number;
  max_retries: number;
  retry_interval_ms: number;
  created_at: string;
  script_api_version: number;
}
export interface Subscription {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  revision_id: string;
  version: string;
  can_manage: boolean;
  deleted_at: string | null;
  config: Revision;
}
export interface Source {
  revision: Revision;
  script: string;
}
export interface Consumption {
  id: string;
  subscription_id: string;
  revision_id: string;
  scope_ref_id: string;
  queue_seq: number;
  status: string;
  attempt_count: number;
  next_retry_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  error_code: string;
  error_summary: string;
  retry_of_id: string | null;
  result: unknown;
  has_result: boolean;
  last_log_seq: number;
}
export interface Log {
  seq: number;
  attempt_no: number;
  occurred_at: string;
  kind: string;
  level: string;
  message: string;
  fields: unknown;
}
export const statusLabel: Record<string, string> = {
  queued: "排队中",
  running: "执行中",
  stopping: "正在停止",
  retry_wait: "等待自动重试",
  succeeded: "成功",
  failed: "最终失败",
  cancelled: "已取消",
};
export const exampleScript = `async function main(ctx) {
  ctx.log.info("收到事件", { type: ctx.event.type, id: ctx.event.id });
  // const result = await ctx.jobs.get("build").start({
  //   inputs: {}, requestKey: "build:" + ctx.event.id
  // });
  // await ctx.agents.get("project/my-project/reviewer").chat({
  //   message: "请审查这个 MR：" + JSON.stringify(ctx.event.data),
  //   requestKey: "review:" + ctx.event.id
  // });
}
`;
