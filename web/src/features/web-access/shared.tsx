import { StatusBadge } from "@/components/feedback";
import { Globe } from "lucide-react";
import type { WebAccessProvider } from "@/types/agent-resources";

const providerIcons: Record<WebAccessProvider["provider_type"], string> = {
  deepseek: "/model-icons/deepseek.svg",
  glm: "/model-icons/glm.svg",
};
export function ProviderIcon({
  type,
}: {
  type?: WebAccessProvider["provider_type"];
}) {
  const icon = type && providerIcons[type];
  return icon ? (
    <span
      aria-hidden
      className="web-access-provider-icon"
      style={{ maskImage: `url(${icon})` }}
    />
  ) : (
    <Globe aria-hidden className="size-8 shrink-0 text-muted" />
  );
}
export const capabilityLabel = { search: "联网搜索", fetch: "网页读取" };
export const stateReason: Record<string, string> = {
  not_configured: "尚未配置路由",
  provider_disabled: "提供商已停用",
  secret_unavailable: "认证不可用",
  operation_unsupported: "不支持该能力",
  adapter_unavailable: "适配器不可用",
};
export type WebDiagnostic = {
  kind: string;
  status: "succeeded" | "failed" | "interrupted";
  started_at: string;
  finished_at: string;
  outdated: boolean;
  checks: { name: string; status: string; reason: string | null }[];
};
const reasons: Record<string, string> = {
  WEB_ACCESS_AUTHENTICATION_REJECTED: "认证失败，请检查 API Key。",
  WEB_ACCESS_BILLING_UNAVAILABLE: "服务额度或计费不可用。",
  WEB_ACCESS_RATE_LIMITED: "请求受到限流，请稍后重新测试。",
  WEB_ACCESS_TARGET_NOT_ALLOWED: "目标不符合访问策略。",
  WEB_ACCESS_CONTENT_UNAVAILABLE: "测试目标当前不可读取。",
  WEB_ACCESS_REMOTE_UNAVAILABLE: "远端服务暂不可用。",
  WEB_ACCESS_REMOTE_OUTCOME_UNKNOWN:
    "未能确认远端结果，请检查连接后决定是否重新测试。",
  WEB_ACCESS_TIMEOUT: "测试超时，远端是否完成尚未确认。",
  CANCELLED: "测试已停止，远端是否完成尚未确认。",
  WEB_ACCESS_PROBE_FAILED: "测试未通过，请检查提供商配置。",
};
export function WebDiagnosticView({ value }: { value: WebDiagnostic | null }) {
  if (!value) return <p className="py-3 text-sm text-muted">尚无测试结果</p>;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge
          tone={
            value.status === "succeeded"
              ? "success"
              : value.status === "failed"
                ? "danger"
                : "warning"
          }
        >
          {value.status === "succeeded"
            ? "通过"
            : value.status === "failed"
              ? "失败"
              : "结果未确认"}
        </StatusBadge>
        {value.outdated && <StatusBadge tone="warning">配置已变化</StatusBadge>}
        <time className="text-xs text-muted" dateTime={value.finished_at}>
          {new Date(value.finished_at).toLocaleString()}
        </time>
      </div>
      {value.outdated && (
        <p className="text-sm text-muted">此结果来自旧配置，请重新测试。</p>
      )}
      {value.checks.map(
        (check, index) =>
          check.reason && (
            <p key={index} className="text-sm text-muted">
              {reasons[check.reason] ?? "测试未通过，请检查提供商配置。"}
              <details className="mt-2 text-xs">
                <summary>技术详情</summary>
                <code>{check.reason}</code>
              </details>
            </p>
          ),
      )}
    </div>
  );
}
