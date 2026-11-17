import type { DiagnosticDetail } from "@/types/agent-events";
import { runtimeReason } from "./runtime-reasons";

const stages: Record<string, string> = {
  admission: "准备运行环境",
  create: "创建沙箱",
  rebuild: "重建沙箱",
  resume: "恢复沙箱",
  pause: "暂停沙箱",
  delete: "删除沙箱",
  prepare: "访问并准备工作环境",
  workspace_prepare: "初始化工作目录",
  workspace_verify: "验证工作环境",
  request: "请求模型服务",
  response: "处理模型响应",
  response_decode: "解析模型响应",
  response_validation: "校验模型响应与工具参数",
  execute: "执行工具",
};
const networks: Record<string, string> = {
  dns: "域名解析失败",
  timeout: "网络连接或响应超时",
  connection_refused: "目标服务拒绝连接",
  connection_reset: "连接被重置",
  tls: "TLS 连接或证书验证失败",
};

export function diagnosticReason(
  detail: DiagnosticDetail | null | undefined,
  fallback?: string | null,
) {
  return runtimeReason(detail?.code || fallback);
}

export function diagnosticLines(
  detail: DiagnosticDetail | null | undefined,
): string[] {
  if (!detail) return [];
  return [
    detail.stage && `失败阶段：${stages[detail.stage] ?? detail.stage}`,
    detail.http_status && `服务返回 HTTP ${detail.http_status}`,
    detail.network && (networks[detail.network] ?? "网络连接异常"),
    detail.code && `错误码：${detail.code}`,
    detail.tool_name &&
      `工具：${detail.tool_name}${detail.tool_index ? `（第 ${detail.tool_index} 个）` : ""}`,
    detail.field_path && `参数字段：${detail.field_path}`,
    detail.constraint && `校验约束：${detail.constraint}`,
    detail.expected && `期望：${detail.expected}`,
    detail.operation_id && `环境操作：${detail.operation_id}`,
    detail.instance_id && `沙箱实例：${detail.instance_id}`,
  ].filter((line): line is string => typeof line === "string" && Boolean(line));
}
