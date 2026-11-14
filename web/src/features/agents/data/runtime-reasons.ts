import type { DurableRecord } from "@/types/agent-events";

export const reasonNames: Record<string, string> = {
  human_input_required: "本轮已结束，等待补充信息",
  physical_execution_ended: "已确认相关命令结束",
  deadline_exceeded: "达到运行期限",
  user_stopped: "操作者已停止",
  agent_disabled: "智能体已停用",
  principal_disabled: "执行身份已停用",
  executor_restarted: "执行服务重启",
  model_unavailable: "模型当前不可用",
  workspace_unavailable: "工作空间当前不可用",
  session_archived: "会话已归档",
  queue_expired: "超过排队期限",
  runtime_interrupted: "执行已中断",
  cancelled: "执行已取消",
  service_restarted: "执行服务重启",
  model_attempt_expired: "模型响应超过期限",
  parent_run_ended: "主任务已结束",
  AGENT_ACCESS_REVOKED: "当前已无此智能体的使用权限",
  PROJECT_CONTEXT_UNAVAILABLE: "所选项目当前不可用",
  EXECUTION_FAILED: "执行失败，可查看运行记录中的诊断信息",
  EXECUTION_INVALID: "执行配置无效",
  MODEL_RESULT_UNCONFIRMED: "模型响应尚未确认",
  MODEL_RATE_LIMITED: "模型提供商限流，请稍后再试或由管理员核对调用配额",
  MODEL_AUTHENTICATION_FAILED:
    "模型提供商拒绝认证或访问，请管理员检查连接凭据及模型授权",
  MODEL_REQUEST_REJECTED:
    "模型提供商拒绝请求，请管理员核对模型、协议、参数及配额配置",
  MODEL_REMOTE_SERVICE_ERROR: "模型提供商服务异常，请稍后再试",
  MODEL_CONNECTION_FAILED:
    "连接模型服务失败。可稍后重试；若持续失败，请管理员检查网络和服务地址。",
  MODEL_REQUEST_FAILED: "模型请求失败，请查看运行记录中的诊断信息",
  MODEL_REQUEST_TIMEOUT: "模型提供商连接或响应超时",
  MODEL_ATTEMPT_TIMEOUT: "本次模型调用超过期限",
  MODEL_RESPONSE_INVALID: "模型返回内容不符合当前协议，未执行其中的工具调用",
  MODEL_RESPONSE_EMPTY: "模型返回了空响应",
  MODEL_GENERATION_LIMIT: "模型生成达到上限，未执行其中的工具调用",
  MODEL_STREAM_DELIVERY_FAILED: "模型输出同步失败，本次尝试已停止",
  MODEL_STREAM_INCOMPLETE: "模型响应流未完整结束，未执行其中的工具调用",
  OUTPUT_LIMIT_EXCEEDED: "达到输出上限",
  TOOL_GROUP_INCOMPLETE: "工具结果尚未完整结算",
  COMPACTION_INTERRUPTED: "上下文压缩已中断",
};

export function runtimeReason(reason: string | null | undefined) {
  return reason ? (reasonNames[reason] ?? `诊断标识：${reason}`) : "";
}

/** Failed attempts only explain the same run, until a later model response succeeds. */
export function runDiagnosticReasons(records: DurableRecord[]) {
  const attempts = new Map<string, string[]>();
  const reasons = new Map<string, string[]>();
  for (const record of records) {
    const runId = record.run_id;
    if (!runId) continue;
    if (record.event_type === "assistant/attempt") {
      const previous = attempts.get(runId) ?? [];
      if (
        record.data.reason_code &&
        !previous.includes(record.data.reason_code)
      )
        attempts.set(runId, [...previous, record.data.reason_code]);
    }
    if (record.event_type === "assistant/message") attempts.delete(runId);
    if (record.event_type === "run/ended") {
      const reason = record.data.reason_code;
      const specific = attempts.get(runId) ?? [];
      reasons.set(
        runId,
        record.data.status === "succeeded"
          ? []
          : (!reason ||
                ["EXECUTION_FAILED", "MODEL_REQUEST_FAILED"].includes(
                  reason,
                )) &&
              specific.length
            ? specific.map(runtimeReason)
            : [runtimeReason(reason) || "本次任务已结束"],
      );
    }
  }
  return reasons;
}
