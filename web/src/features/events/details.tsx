import { useEffect, useState } from "react";
import { ArrowUpRight, RotateCw, Search } from "lucide-react";
import { request } from "@/api/client";
import { Button } from "@/components/button";
import { CopyButton } from "@/components/copy-button";
import {
  AsyncBoundary,
  ErrorNotice,
  LoadingState,
  Notice,
  StatusBadge,
} from "@/components/feedback";
import { StandaloneInput, StandaloneSelect } from "@/components/fields";
import { DescriptionList } from "@/components/layout";
import { ConfirmDialog, Drawer } from "@/components/overlays";
import { useApiQuery } from "@/hooks/use-api";
import { formatDate } from "@/lib/utils";
import {
  statusLabel,
  type Consumption,
  type EventReference,
  type Log,
} from "./types";

const terminal = new Set(["succeeded", "failed", "cancelled"]);
const levels: Record<string, string> = {
  info: "信息",
  warn: "警告",
  error: "错误",
};

export function ConsumptionStatus({ status }: { status: string }) {
  return (
    <StatusBadge
      tone={
        status === "succeeded"
          ? "success"
          : status === "failed"
            ? "danger"
            : status === "running"
              ? "info"
              : status === "retry_wait" || status === "stopping"
                ? "warning"
                : "neutral"
      }
    >
      {statusLabel[status] ?? status}
    </StatusBadge>
  );
}

function JsonData({ value }: { value: unknown }) {
  const json = JSON.stringify(value, null, 2);
  if (value == null || json === undefined)
    return <p className="text-sm text-muted">暂无数据</p>;
  return (
    <pre className="max-h-80 overflow-auto rounded-lg bg-surface-subtle p-3 font-mono text-xs leading-6 whitespace-pre-wrap wrap-anywhere">
      {json}
    </pre>
  );
}

function EventPayload({
  title,
  value,
  open,
}: {
  title: string;
  value: unknown;
  open?: boolean;
}) {
  return (
    <details open={open} className="rounded-lg border border-border">
      <summary className="cursor-pointer px-4 py-3 text-sm font-medium hover:bg-surface-hover">
        {title}
      </summary>
      <div className="space-y-2 px-4 pb-4">
        {value != null && (
          <div className="flex justify-end">
            <CopyButton
              value={JSON.stringify(value, null, 2)}
              label={`复制${title}`}
            />
          </div>
        )}
        <JsonData value={value} />
      </div>
    </details>
  );
}

export function EventDetail({
  base,
  id,
  names,
  onClose,
}: {
  base: string;
  id: string;
  names: ReadonlyMap<string, string>;
  onClose: () => void;
}) {
  const query = useApiQuery<EventReference>(
    ["project-event", base, id],
    `${base}/events/${id}`,
  );
  const event = query.data?.data.event;
  const name = event
    ? (names.get(event.type) ??
      (event.source_event_type || event.type || "未识别事件"))
    : undefined;
  return (
    <Drawer
      open
      wide
      title={`事件 #${id}`}
      description={name}
      onClose={onClose}
    >
      <AsyncBoundary
        loading={query.isPending}
        error={query.error}
        onRetry={() => void query.refetch()}
      >
        {event && (
          <div className="space-y-5">
            <DescriptionList
              className="rounded-xl border border-border bg-surface-subtle p-4 tabular-nums"
              items={[
                {
                  label: "事件类型",
                  value: (
                    <code className="wrap-anywhere">
                      {event.type || event.source_event_type || "—"}
                    </code>
                  ),
                },
                {
                  label: "关联对象",
                  value:
                    [event.subject_kind, event.subject_id]
                      .filter(Boolean)
                      .join(" ") || "—",
                },
                {
                  label: "事件发生",
                  value: event.occurred_at
                    ? formatDate(event.occurred_at)
                    : "来源未提供",
                },
                { label: "系统接收", value: formatDate(event.received_at) },
              ]}
            />
            <div className="space-y-3">
              <EventPayload title="标准事件数据" value={event.data} open />
              <EventPayload title="GitLab 原始事件" value={event.raw} />
            </div>
          </div>
        )}
      </AsyncBoundary>
    </Drawer>
  );
}

export function ConsumptionDetail({
  base,
  id,
  manage,
  subscriptions,
  onClose,
  onSelect,
  onEvent,
}: {
  base: string;
  id: string;
  manage: boolean;
  subscriptions: ReadonlyMap<string, string>;
  onClose: () => void;
  onSelect: (id: string) => void;
  onEvent: (id: string) => void;
}) {
  const [run, setRun] = useState<Consumption>();
  const [logs, setLogs] = useState<Log[]>([]);
  const [loadError, setLoadError] = useState<unknown>();
  const [retryError, setRetryError] = useState<unknown>();
  const [confirmRetry, setConfirmRetry] = useState(false);
  const [pending, setPending] = useState(false);
  const [reload, setReload] = useState(0);
  const [search, setSearch] = useState("");
  const [level, setLevel] = useState("");
  const path = `${base}/event-consumptions/${id}`;
  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    let timer: ReturnType<typeof setTimeout>;
    let after = 0;
    async function poll() {
      try {
        const [detail, lines] = await Promise.all([
          request<Consumption>(path, { signal }),
          request<{ items: Log[] }>(`${path}/logs?after_seq=${after}`, {
            signal,
          }),
        ]);
        if (signal.aborted) return;
        setRun(detail.data);
        const newer = lines.data.items.filter((item) => item.seq > after);
        if (newer.length) {
          after = newer.at(-1)!.seq;
          setLogs((old) => [
            ...old.filter((item) => item.seq < newer[0]!.seq),
            ...newer,
          ]);
        }
        setLoadError(undefined);
        if (
          !terminal.has(detail.data.status) ||
          after < detail.data.last_log_seq
        ) {
          timer = setTimeout(
            () => void poll(),
            newer.length && after < detail.data.last_log_seq ? 50 : 1000,
          );
        }
      } catch (error) {
        if (!signal.aborted) setLoadError(error);
      }
    }
    void poll();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [path, reload]);

  async function retry() {
    if (pending) return;
    setPending(true);
    setRetryError(undefined);
    try {
      const result = await request<Consumption>(`${path}/retry`, {
        method: "POST",
        body: {},
      });
      setConfirmRetry(false);
      onSelect(result.data.id);
    } catch (error) {
      setRetryError(error);
    } finally {
      setPending(false);
    }
  }

  const term = search.trim().toLocaleLowerCase();
  const visible = logs.filter(
    (line) =>
      (!level || line.level === level) &&
      (!term || line.message.toLocaleLowerCase().includes(term)),
  );
  const name = run
    ? (subscriptions.get(run.subscription_id) ?? `订阅 #${run.subscription_id}`)
    : undefined;
  return (
    <>
      <Drawer
        open
        wide
        title={`消费记录 #${id}`}
        description={name}
        onClose={onClose}
        pending={pending}
      >
        <div className="space-y-5">
          {Boolean(loadError) && (
            <div className="space-y-2">
              <ErrorNotice error={loadError} />
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setLoadError(undefined);
                  setReload((n) => n + 1);
                }}
              >
                <RotateCw /> 重新加载
              </Button>
            </div>
          )}
          {!run && !loadError && <LoadingState label="正在加载消费记录…" />}
          {run && (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <ConsumptionStatus status={run.status} />
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => onEvent(run.scope_ref_id)}
                  >
                    查看事件 <ArrowUpRight />
                  </Button>
                  {run.retry_of_id && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => onSelect(run.retry_of_id!)}
                    >
                      原消费 #{run.retry_of_id}
                    </Button>
                  )}
                  {manage && run.status === "failed" && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setRetryError(undefined);
                        setConfirmRetry(true);
                      }}
                    >
                      <RotateCw /> 人工重试
                    </Button>
                  )}
                </div>
              </div>
              <DescriptionList
                className="rounded-xl border border-border bg-surface-subtle p-4 tabular-nums"
                items={[
                  { label: "尝试次数", value: run.attempt_count },
                  { label: "配置修订", value: `#${run.revision_id}` },
                  { label: "创建时间", value: formatDate(run.created_at) },
                  ...(run.next_retry_at
                    ? [
                        {
                          label: "下次自动重试",
                          value: formatDate(run.next_retry_at),
                        },
                      ]
                    : []),
                ]}
              />
              {run.error_summary && (
                <Notice tone="danger" title={run.error_summary}>
                  <code className="text-xs">{run.error_code}</code>
                </Notice>
              )}
              <section
                className="overflow-hidden rounded-lg border border-border"
                aria-label="消费脚本日志"
              >
                <header className="space-y-2 border-b border-border bg-surface-subtle px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="text-sm font-semibold">消费脚本日志</h3>
                    <span className="text-xs text-muted">
                      {level || term
                        ? `${visible.length} / ${logs.length}`
                        : logs.length}{" "}
                      条
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <div className="relative min-w-40 flex-1">
                      <Search
                        aria-hidden
                        className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted"
                      />
                      <StandaloneInput
                        className="pl-9"
                        aria-label="搜索日志"
                        placeholder="搜索日志内容"
                        value={search}
                        onChange={(event) => setSearch(event.target.value)}
                      />
                    </div>
                    <StandaloneSelect
                      aria-label="日志级别"
                      value={level}
                      onValueChange={setLevel}
                    >
                      <option value="">全部级别</option>
                      {Object.entries(levels).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </StandaloneSelect>
                  </div>
                </header>
                <div className="max-h-[48vh] divide-y divide-border overflow-auto px-4">
                  {!visible.length && (
                    <p className="py-6 text-center text-sm text-muted">
                      {logs.length
                        ? "没有符合筛选条件的日志"
                        : terminal.has(run.status)
                          ? "本次消费没有日志"
                          : "等待日志…"}
                    </p>
                  )}
                  {visible.map((line) => (
                    <article key={line.seq} className="space-y-1 py-3">
                      <div className="flex flex-wrap items-center gap-2 text-xs text-muted tabular-nums">
                        <span>{formatDate(line.occurred_at)}</span>
                        <StatusBadge
                          tone={
                            line.level === "error"
                              ? "danger"
                              : line.level === "warn"
                                ? "warning"
                                : "neutral"
                          }
                        >
                          {levels[line.level] ?? line.level}
                        </StatusBadge>
                        <span>
                          尝试 {line.attempt_no} · #{line.seq} · {line.kind}
                        </span>
                      </div>
                      <p className="text-sm whitespace-pre-wrap wrap-anywhere">
                        {line.message}
                      </p>
                      {line.fields &&
                      typeof line.fields === "object" &&
                      Object.keys(line.fields).length > 0 ? (
                        <details className="text-xs text-muted">
                          <summary className="mb-2 cursor-pointer">
                            详细字段
                          </summary>
                          <JsonData value={line.fields} />
                        </details>
                      ) : null}
                    </article>
                  ))}
                </div>
              </section>
              {run.has_result && (
                <EventPayload title="脚本返回结果" value={run.result} open />
              )}
            </>
          )}
        </div>
      </Drawer>
      {confirmRetry && (
        <ConfirmDialog
          open
          title="重新消费该事件？"
          description="将使用原事件和当前订阅配置，启动一条新的消费记录。"
          confirmLabel="确认重试"
          pending={pending}
          onClose={() => setConfirmRetry(false)}
          onConfirm={() => void retry()}
        >
          <ErrorNotice error={retryError} />
        </ConfirmDialog>
      )}
    </>
  );
}
