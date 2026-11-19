import { sandboxReasons } from "./sandbox-reasons";
import type { DurableRecord } from "@/types/agent-events";

export const reasonNames: Record<string, string> = {
  ...sandboxReasons,
  CLOUD_UNAVAILABLE: "云电脑当前不可用，需要处理环境异常",
  CLOUD_NOT_READY: "云电脑尚未就绪，无法访问工作环境",
  CLOUD_LEASE_FENCED: "云电脑执行占用已失效",
  CLOUD_COMPUTER_DELETED: "原云电脑已删除或正在删除",
  MODEL_IMAGE_FILE_REJECTED: "模型服务拒绝访问引用的图像文件",
  CANCELLED: "调用已取消",
  DEADLINE_EXCEEDED: "达到运行期限",
  human_input_required: "本轮已结束，等待补充信息",
  physical_execution_ended: "已确认相关命令结束",
  deadline_exceeded: "达到运行期限",
  user_stopped: "操作者已停止",
  agent_disabled: "助手已停用",
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
  AGENT_ACCESS_REVOKED: "当前已无此助手的使用权限",
  EXECUTION_FAILED: "执行未完成；该记录未提供更具体的原因",
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
  MODEL_REQUEST_FAILED: "模型请求失败；该记录未提供更具体的原因",
  MODEL_REQUEST_TIMEOUT: "模型提供商连接或响应超时",
  MODEL_ATTEMPT_TIMEOUT: "本次模型调用超过期限",
  MODEL_RESPONSE_INVALID: "模型返回内容不符合当前协议，未执行其中的工具调用",
  MODEL_STREAM_FRAME_INVALID: "模型响应分片不是有效的协议数据",
  MODEL_STREAM_ERROR_FRAME: "模型服务在输出过程中返回了错误",
  MODEL_RESPONSE_STRING_INVALID: "模型返回的文本字段类型不正确",
  MODEL_RESPONSE_MODEL_INVALID: "模型响应中的模型标识不一致或无效",
  MODEL_STREAM_AFTER_FINISH: "模型在结束标记后继续返回了内容",
  MODEL_RESPONSE_ENVELOPE_INVALID: "模型响应包含不允许的协议字段",
  MODEL_FINISH_REASON_INVALID: "模型返回了不支持的结束原因",
  MODEL_RESPONSE_ROLE_INVALID: "模型返回的消息角色不正确",
  MODEL_TOOL_CALLS_INVALID: "模型返回的工具调用列表格式不正确",
  MODEL_TOOL_CALL_INDEX_INVALID: "模型返回的工具分片序号不正确",
  MODEL_TOOL_FUNCTION_INVALID: "模型返回的工具函数字段格式不正确",
  MODEL_TOOL_TYPE_INVALID: "模型返回了不支持的工具调用类型",
  MODEL_TOOL_CALL_ID_INVALID: "模型返回的工具调用标识缺失或过长",
  MODEL_TOOL_CALL_ID_DUPLICATE: "模型返回了重复的工具调用标识",
  MODEL_TOOL_NAME_INVALID: "模型返回的工具名称缺失或过长",
  MODEL_TOOL_NAME_UNKNOWN: "模型调用了本轮未提供的工具",
  MODEL_TOOL_CALL_INVALID: "模型返回的工具调用基本字段不正确",
  MODEL_TOOL_ARGUMENTS_TOO_LARGE: "模型返回的工具参数超过长度限制",
  MODEL_TOOL_ARGUMENTS_NOT_OBJECT: "模型返回的工具参数不是有效的 JSON 对象",
  MODEL_TOOL_ARGUMENTS_SCHEMA_MISMATCH: "模型返回的工具参数不符合工具定义，未执行该调用",
  MODEL_TOOL_SCHEMA_INVALID: "本轮工具定义无法校验，请检查工具配置",
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
