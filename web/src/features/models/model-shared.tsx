import { useRef, useState, type ReactNode } from "react";
import { ApiError, isVersionConflict, type ApiResponse } from "@/api/client";
import { Button } from "@/components/button";
import { ErrorNotice, Notice, StatusBadge } from "@/components/feedback";
import { modelRequest } from "./model-api";
import type { Diagnostic, ProviderKind } from "@/types/models";

export const providerNames: Record<ProviderKind, string> = {
  deepseek: "DeepSeek",
  minimax: "MiniMax",
  glm: "GLM",
  ollama: "Ollama",
  custom: "自定义",
};
export const protocolNames = {
  chat_completions: "Chat Completions",
  anthropic_messages: "Anthropic Messages",
};
export const capabilityNames = {
  text_input: "文本输入",
  image_input: "图像输入",
  tool_calling: "工具调用",
  streaming: "流式输出",
  thinking: "思考",
};
export const stateNames = {
  supported: "声明支持",
  unsupported: "声明不支持",
  unknown: "未知",
};
const diagnosticCheckNames: Record<string, string> = {
  connectivity: "连接验证",
  generation: "文本生成",
  tools: "工具调用",
  stream: "流式输出",
  thinking: "思考输出",
  request: "测试请求",
  search: "网络搜索",
  fetch: "网页读取",
};
const diagnosticReasons: Record<string, string> = {
  discovery_not_registered: "此提供商尚未支持通过模型发现验证连接。",
  authentication_rejected: "远端拒绝认证，请检查凭据及其访问权限。",
  rate_limited: "远端请求频率受限，请稍后重试。",
  remote_rejected: "远端拒绝了测试请求。",
  cancelled_or_timed_out: "测试已取消或超时，未确认完整结果。",
  output_limit_exceeded: "输出超过本次测试的大小限制。",
  stream_incomplete: "流式响应未完整结束，不能确认本次测试通过。",
  protocol_unsupported: "当前适配器不支持所选协议或请求能力。",
  model_call_failed: "模型调用失败，请核对连接与模型配置。",
  stream_output_not_observed: "本次测试未观察到流式输出。",
  tool_call_not_observed: "本次测试未观察到工具调用。",
  thinking_not_observed: "本次测试未观察到可见的思考输出。",
  unexpected_tool: "模型返回的工具名称或参数不符合测试要求。",
  ACTOR_UNAVAILABLE: "发起操作的管理员账号已不可用或不再具备权限。",
  OPERATION_EXPIRED: "操作等待执行期间已到期。",
  OPERATION_TIMEOUT: "操作已超过服务端截止时间。",
  OPERATION_RESULT_UNCONFIRMED: "操作已中断，服务端无法确认最终结果。",
  MODEL_UNAVAILABLE: "模型或提供商不可用，请检查启用状态和凭据。",
  CONFIGURATION_CHANGED: "配置已在操作执行前变更，请核对最新配置。",
  CREDENTIAL_UNAVAILABLE: "服务端无法读取凭据，请重新配置认证信息。",
  MODEL_PROBE_FAILED: "模型测试未通过，请查看各项检查结果。",
  MODEL_CAPABILITY_UNSUPPORTED: "本次测试未验证所选能力全部可用。",
  INVALID_PROBE_RESULT: "测试返回了无法识别的结果，未将其标记为通过。",
};
export function modelDiagnosticReason(code: string) {
  return diagnosticReasons[code] ?? `诊断标识：${code}`;
}
const measuredCapabilityNames = {
  supported: "已验证支持",
  unsupported: "实测不支持",
  unknown: "未验证",
};
const usageNames = {
  input_tokens: "输入 Token",
  output_tokens: "输出 Token",
  cache_read_tokens: "缓存读取 Token",
  cache_write_tokens: "缓存写入 Token",
};
export function restoreModelFocus(target: HTMLElement | null) {
  // A nested discard confirmation also restores focus during unmount.
  // Return to the page trigger after both overlay focus scopes have closed.
  requestAnimationFrame(() => {
    if (target?.isConnected) target.focus();
  });
}
export function EnabledBadge({ enabled }: { enabled: boolean }) {
  return (
    <StatusBadge tone={enabled ? "success" : "neutral"}>
      {enabled ? "已启用" : "已停用"}
    </StatusBadge>
  );
}
export function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="model-form-section space-y-4">
      <div>
        <h2 className="text-sm font-semibold">{title}</h2>
        {description && (
          <p className="mt-1 text-xs leading-5 text-muted">{description}</p>
        )}
      </div>
      {children}
    </section>
  );
}
export function DiagnosticView({
  diagnostic,
  modelDetails = true,
}: {
  diagnostic: Diagnostic | null;
  modelDetails?: boolean;
}) {
  if (!diagnostic)
    return (
      <p className="py-3 text-sm text-muted">
        尚无诊断记录。保存配置后运行测试，结果仅代表实际测试的项目。
      </p>
    );
  const labels = {
    succeeded: "通过",
    failed: "失败",
    unsupported: "不支持",
    skipped: "未测试",
  };
  return (
    <div className="model-diagnostic space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge
          tone={
            diagnostic.status === "succeeded"
              ? "success"
              : diagnostic.status === "failed"
                ? "danger"
                : "warning"
          }
        >
          {labels[diagnostic.status]}
        </StatusBadge>
        <span className="text-xs text-muted">
          {new Date(diagnostic.finished_at).toLocaleString()}
        </span>
      </div>
      {diagnostic.checks.map((check, index) => (
        <div key={`${check.name}-${index}`} className="model-diagnostic-check">
          <span className="min-w-24 font-medium">
            {diagnosticCheckNames[check.name] ?? "其他检查"}
            {!diagnosticCheckNames[check.name] && (
              <span className="mt-1 block max-w-48 break-all text-xs font-normal text-muted">
                {check.name}
              </span>
            )}
          </span>
          <StatusBadge
            tone={
              check.status === "succeeded"
                ? "success"
                : check.status === "failed"
                  ? "danger"
                  : "neutral"
            }
          >
            {labels[check.status]}
          </StatusBadge>
          {check.reason && (
            <span className="min-w-0 break-words text-muted">
              {modelDiagnosticReason(check.reason)}
            </span>
          )}
        </div>
      ))}
      {modelDetails && (
        <details className="text-xs">
          <summary className="cursor-pointer text-muted">
            能力与用量详情
          </summary>
          <div className="mt-3 grid grid-cols-2 gap-4 rounded-lg bg-surface-subtle p-4">
            <section>
              <h3 className="mb-3 font-medium">能力实测</h3>
              <dl className="space-y-2">
                {Object.entries(capabilityNames).map(([key, label]) => (
                  <div key={key} className="flex justify-between gap-3">
                    <dt>{label}</dt>
                    <dd className="text-muted">
                      {
                        measuredCapabilityNames[
                          diagnostic.capabilities?.[
                            key as keyof typeof capabilityNames
                          ] ?? "unknown"
                        ]
                      }
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
            <section>
              <h3 className="mb-3 font-medium">本次测试用量</h3>
              <dl className="space-y-2">
                {Object.entries(usageNames).map(([key, label]) => {
                  const value =
                    diagnostic.usage?.[key as keyof typeof usageNames];
                  return (
                    <div key={key} className="flex justify-between gap-3">
                      <dt>{label}</dt>
                      <dd className="text-muted tabular-nums">
                        {value == null ? "未提供" : value.toLocaleString()}
                      </dd>
                    </div>
                  );
                })}
              </dl>
              <p className="mt-3 leading-5 text-muted">
                仅展示本次测试返回的计数；未提供不等于零。
              </p>
            </section>
          </div>
        </details>
      )}
    </div>
  );
}

export function useVersionedModelSave<T>(
  path: string,
  initialEtag: string,
  adopt: (data: T) => void,
  complete: (data: T) => void,
  onError?: (error: unknown) => void,
) {
  const [etag, setEtag] = useState(initialEtag);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>();
  const [blocked, setBlocked] = useState(!initialEtag);
  const [latest, setLatest] = useState<ApiResponse<T>>();
  const busy = useRef(false);
  async function save(body: unknown) {
    if (busy.current || blocked) return;
    busy.current = true;
    setPending(true);
    setError(undefined);
    try {
      const result = await modelRequest<T>(path, {
        method: "PATCH",
        body,
        etag,
      });
      complete(result.data);
    } catch (e) {
      setError(e);
      onError?.(e);
      if (isVersionConflict(e) || (e instanceof ApiError && e.uncertain))
        setBlocked(true);
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  async function reload() {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    try {
      setLatest(await modelRequest<T>(path));
    } catch (e) {
      setError(e);
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  return {
    save,
    pending,
    blocked,
    recovery: (
      <>
        <ErrorNotice error={error} />
        {blocked && (
          <Notice tone="warning" title="需要核对服务器上的最新配置">
            当前草稿仍保留。配置可能已被修改，或上次保存结果未确认，请先读取最新配置再决定。
            <div className="mt-3">
              <Button
                variant="outline"
                disabled={pending}
                onClick={() => void reload()}
              >
                读取最新配置
              </Button>
            </div>
            {latest && (
              <div className="mt-3 space-y-3">
                <pre className="max-h-60 overflow-auto whitespace-pre-wrap break-all rounded border bg-surface p-3 text-xs">
                  {JSON.stringify(latest.data, null, 2)}
                </pre>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    disabled={!latest.etag}
                    onClick={() => {
                      setEtag(latest.etag);
                      adopt(latest.data);
                      setBlocked(false);
                      setError(undefined);
                      setLatest(undefined);
                    }}
                  >
                    采用最新配置
                  </Button>
                  <Button
                    variant="outline"
                    disabled={!latest.etag}
                    onClick={() => {
                      setEtag(latest.etag);
                      setBlocked(false);
                      setError(undefined);
                      setLatest(undefined);
                    }}
                  >
                    保留草稿，以最新版本继续编辑
                  </Button>
                </div>
              </div>
            )}
          </Notice>
        )}
      </>
    ),
  };
}
