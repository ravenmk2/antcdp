import { useEffect, useRef, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router";
import {
  ApiError,
  isVersionConflict,
  request,
  type ApiResponse,
} from "@/api/client";
import { Button } from "@/components/button";
import { DescriptionPreview } from "@/components/description-preview";
import { ErrorNotice, Notice, StatusBadge } from "@/components/feedback";
import { useNavigationGuard } from "@/components/navigation-guard";
import type {
  AgentScope,
  AgentType,
  RunStatus,
  Versioned,
} from "@/types/agents";

export const identityNames: Record<AgentType, string> = {
  interactive: "交互型",
  service: "服务型",
};
export function scopeLabel(scope: AgentScope) {
  return { platform: "平台", team: "团队", project: "项目" }[scope];
}
export const runStatusNames: Record<RunStatus, string> = {
  preparing: "正在准备",
  running: "执行中",
  waiting_input: "等待补充",
  stopping: "正在停止",
  succeeded: "已完成",
  failed: "失败",
  cancelled: "已取消",
  interrupted: "已中断",
};
export function IdentityBadge({ mode }: { mode: AgentType }) {
  return (
    <StatusBadge tone={mode === "service" ? "info" : "neutral"}>
      {identityNames[mode]}
    </StatusBadge>
  );
}
export function EnabledState({ enabled }: { enabled: boolean }) {
  return (
    <StatusBadge tone={enabled ? "success" : "neutral"}>
      {enabled ? "已启用" : "已停用"}
    </StatusBadge>
  );
}
export function ResourceDescription({
  name,
  description,
}: {
  name: string;
  description?: string;
}) {
  if (!description) return null;
  return (
    <div className="flex max-w-5xl items-start gap-2">
      <p className="min-w-0 line-clamp-2 whitespace-pre-wrap break-words">
        {description}
      </p>
      <DescriptionPreview name={name} description={description} />
    </div>
  );
}
export function useListParams() {
  const [params, setParams] = useSearchParams();
  const rawPage = Number(params.get("page") ?? "1"),
    rawSize = Number(params.get("page_size") ?? "20");
  const page =
    Number.isInteger(rawPage) && rawPage >= 1 && rawPage <= 1_000_000
      ? rawPage
      : 1;
  const size = [10, 20, 50, 100].includes(rawSize) ? rawSize : 20;
  const change = (values: Record<string, string>) =>
    setParams(
      (old) => {
        const next = new URLSearchParams(old);
        for (const [key, value] of Object.entries(values))
          if (value && value !== "all") next.set(key, value);
          else next.delete(key);
        return next;
      },
      { replace: true },
    );
  return { params, page, size, change };
}
export function ResourceSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-base font-semibold">{title}</h2>
        {description && (
          <p className="mt-1 text-sm leading-6 text-muted">{description}</p>
        )}
      </div>
      {children}
    </section>
  );
}
export function ConfigActions({
  dirty,
  pending,
  blocked,
  children,
}: {
  dirty: boolean;
  pending: boolean;
  blocked: boolean;
  children: ReactNode;
}) {
  return (
    <div className="agent-config-actions">
      <span className="text-xs text-muted" role="status">
        {blocked
          ? "请先核实保存结果"
          : pending
            ? "正在保存…"
            : dirty
              ? "有未保存的修改"
              : "当前配置已保存"}
      </span>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}
export function useResourceSave<T extends Versioned>({
  path,
  initial,
  method = "PATCH",
  adopt,
  complete,
  dirty,
  showError,
  rebase,
  enabled = true,
}: {
  path: string;
  initial: ApiResponse<T>;
  method?: "PATCH" | "PUT";
  adopt: (data: T) => void;
  complete: (data: T) => void;
  dirty: boolean;
  showError?: (error: unknown) => void;
  rebase?: (latest: T) => void;
  enabled?: boolean;
}) {
  const [etag, setEtag] = useState(initial.etag);
  const [pending, setPending] = useState(false);
  const [blocked, setBlocked] = useState(enabled && !initial.etag);
  const [error, setError] = useState<unknown>();
  const [latest, setLatest] = useState<ApiResponse<T>>();
  const [observedTag, setObservedTag] = useState(initial.etag);
  const busy = useRef(false);
  const release = useNavigationGuard(dirty || blocked || pending);
  // Independent sections can advance the same definition version. Adopt a
  // refreshed snapshot only while pristine; never rebase an active draft.
  if (initial.etag !== observedTag) {
    setObservedTag(initial.etag);
    if (!dirty && !blocked && !pending) {
      setEtag(initial.etag);
      adopt(initial.data);
    }
  }
  useEffect(() => {
    if (!dirty && !blocked && !pending) return;
    const beforeUnload = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [dirty, blocked, pending]);
  async function save(body: unknown) {
    if (!enabled || busy.current || blocked) return;
    busy.current = true;
    setPending(true);
    setError(undefined);
    try {
      const result = await request<T>(path, { method, etag, body });
      setEtag(result.etag);
      adopt(result.data);
      release();
      complete(result.data);
    } catch (failure) {
      setError(failure);
      showError?.(failure);
      if (
        isVersionConflict(failure) ||
        (failure instanceof ApiError && failure.uncertain)
      )
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
      setLatest(await request<T>(path));
    } catch (failure) {
      setError(failure);
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  return {
    save,
    release,
    pending,
    blocked,
    recovery: (
      <>
        <ErrorNotice error={error} />
        {blocked && (
          <Notice tone="warning" title="需要核对最新配置">
            原草稿仍保留。配置可能已被其他管理员修改，或上次保存结果未确认。
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
                <p>
                  已取得最新版本。采用最新配置会替换当前草稿；保留草稿后，请核对再保存。
                </p>
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
                      rebase?.(latest.data);
                      setBlocked(false);
                      setError(undefined);
                      setLatest(undefined);
                    }}
                  >
                    保留草稿，使用最新版本
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
export function objectJSON(value: string) {
  const parsed: unknown = JSON.parse(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new Error("请输入 JSON 对象。");
  return parsed as Record<string, unknown>;
}
