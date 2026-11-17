import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { request } from "@/api/client";
import { Button } from "@/components/button";
import {
  AsyncBoundary,
  ErrorNotice,
  Notice,
  StatusBadge,
} from "@/components/feedback";
import { StandaloneSelect } from "@/components/fields";
import { PageHeader, Panel, Tabs } from "@/components/layout";
import { Drawer, ConfirmDialog } from "@/components/overlays";
import { SimpleTable } from "@/components/table";
import { useApiQuery } from "@/hooks/use-api";
import { formatDate } from "@/lib/utils";
import type { Resource } from "@/types/collaboration";
import { SubscriptionEditor } from "./subscription-editor";
import {
  statusLabel,
  type Consumption,
  type EventReference,
  type Group,
  type Log,
  type Subscription,
} from "./types";

export function EventsPage({ project }: { project: Resource }) {
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") ?? "events";
  const selected = params.get("selected") ?? "";
  const before = params.get("before") ?? "";
  const filter = params.get("filter") ?? "";
  const base = `/projects/${project.id}`;
  const manage = project.can_manage && project.status === "active";
  const catalog = useApiQuery<{ groups: Group[] }>(
    ["event-types"],
    "/event-types",
  );
  const subscriptions = useApiQuery<{ items: Subscription[] }>(
    ["event-subscriptions", project.id],
    `${base}/event-subscriptions`,
  );
  const history = useApiQuery<{ items: EventReference[] }>(
    ["project-events", project.id, before, filter],
    `${base}/events?${new URLSearchParams({ before, type: filter })}`,
    { enabled: tab === "events" },
  );
  const runs = useApiQuery<{ items: Consumption[] }>(
    [
      "event-consumptions",
      project.id,
      before,
      filter,
      params.get("subscription_id"),
    ],
    `${base}/event-consumptions?${new URLSearchParams({ before, status: filter, subscription_id: params.get("subscription_id") ?? "" })}`,
    { enabled: tab === "consumptions" },
  );
  const [editor, setEditor] = useState<Subscription | "new">();
  const [deleting, setDeleting] = useState<Subscription>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>();
  const qc = useQueryClient();
  const names = new Map(
    catalog.data?.data.groups.flatMap((g) =>
      g.types.map((t) => [t.code, t.name] as const),
    ),
  );
  function navigate(next: Record<string, string>) {
    setParams(next);
  }
  function refresh() {
    void qc.invalidateQueries({
      queryKey: ["event-subscriptions", project.id],
    });
    void runs.refetch();
    void history.refetch();
  }
  async function change(sub: Subscription, remove = false) {
    setPending(true);
    setError(undefined);
    try {
      await request(
        `${base}/event-subscriptions/${sub.id}${remove ? "" : "/enabled"}`,
        {
          method: remove ? "DELETE" : "PUT",
          body: {
            version: sub.version,
            ...(!remove ? { enabled: !sub.enabled } : {}),
          },
        },
      );
      setDeleting(undefined);
      refresh();
    } catch (e) {
      setError(e);
    } finally {
      setPending(false);
    }
  }
  return (
    <div className="space-y-5">
      <PageHeader
        title="项目事件"
        description="查看关联仓库事件，通过订阅脚本触发任务和服务型智能体。"
        actions={
          <>
            <Button variant="outline" onClick={refresh}>
              刷新
            </Button>
            {manage && (
              <Button onClick={() => setEditor("new")}>新建订阅</Button>
            )}
          </>
        }
      />
      <Tabs
        label="事件视图"
        value={tab}
        onChange={(value) => navigate({ tab: value })}
        items={[
          { value: "events", label: "事件" },
          { value: "subscriptions", label: "订阅" },
          { value: "consumptions", label: "消费记录" },
        ]}
      />
      <ErrorNotice error={error} />
      {project.status !== "active" && (
        <Notice>项目已归档，可以查看历史事件与日志。</Notice>
      )}
      {tab === "events" && (
        <Panel bodyClassName="space-y-4 p-5">
          <StandaloneSelect
            aria-label="事件类型筛选"
            value={filter}
            onValueChange={(value) => navigate({ tab, filter: value })}
          >
            <option value="">全部类型</option>
            {catalog.data?.data.groups.flatMap((g) =>
              g.types.map((t) => (
                <option key={t.code} value={t.code}>
                  {g.name} · {t.name}
                </option>
              )),
            )}
          </StandaloneSelect>
          <AsyncBoundary
            loading={history.isPending}
            error={history.error}
            onRetry={() => history.refetch()}
            empty={history.data?.data.items.length === 0}
            emptyTitle="暂无项目事件"
            emptyDescription="关联 GitLab 仓库后，新收到的 Webhook 事件会出现在这里。"
          >
            <SimpleTable
              label="项目事件"
              headers={["事件", "对象", "接收时间", "操作"]}
            >
              {history.data?.data.items.map((ref) => (
                <tr key={ref.id}>
                  <td>
                    <strong>
                      {names.get(ref.event.type) ?? ref.event.source_event_type}
                    </strong>
                    <p className="text-xs text-muted">
                      {ref.event.type || "暂不支持此类型"}
                    </p>
                  </td>
                  <td>
                    {ref.event.subject_kind} {ref.event.subject_id}
                  </td>
                  <td>{formatDate(ref.created_at)}</td>
                  <td>
                    <Button
                      variant="outline"
                      onClick={() =>
                        navigate({ tab, filter, before, selected: ref.id })
                      }
                    >
                      查看
                    </Button>
                  </td>
                </tr>
              ))}
            </SimpleTable>
          </AsyncBoundary>
          <Cursor
            before={before}
            last={history.data?.data.items.at(-1)?.id}
            count={history.data?.data.items.length ?? 0}
            change={(value) => navigate({ tab, filter, before: value })}
          />
        </Panel>
      )}
      {tab === "subscriptions" && (
        <AsyncBoundary
          loading={subscriptions.isPending}
          error={subscriptions.error}
          onRetry={() => subscriptions.refetch()}
          empty={subscriptions.data?.data.items.length === 0}
          emptyTitle="暂无订阅"
        >
          <SimpleTable
            label="事件订阅"
            headers={["订阅", "事件类型", "执行配置", "状态", "操作"]}
          >
            {subscriptions.data?.data.items.map((sub) => (
              <tr key={sub.id}>
                <td>
                  <strong>{sub.name}</strong>
                  <p className="text-xs text-muted">{sub.description}</p>
                </td>
                <td>
                  {sub.config.event_types.map((t) => (
                    <div key={t}>{names.get(t) ?? t}</div>
                  ))}
                </td>
                <td>
                  机器人 #{sub.config.executor_user_id}
                  <p className="text-xs text-muted">
                    超时 {sub.config.timeout_ms / 1000} 秒 · 最多重试{" "}
                    {sub.config.max_retries} 次
                  </p>
                </td>
                <td>
                  {sub.deleted_at
                    ? "已删除"
                    : sub.enabled
                      ? "已启用"
                      : "已停用"}
                </td>
                <td>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      onClick={() =>
                        navigate({
                          tab: "consumptions",
                          subscription_id: sub.id,
                        })
                      }
                    >
                      消费记录
                    </Button>
                    {sub.can_manage && (
                      <Button variant="outline" onClick={() => setEditor(sub)}>
                        {manage && !sub.deleted_at ? "编辑" : "查看配置"}
                      </Button>
                    )}
                    {manage && !sub.deleted_at && (
                      <>
                        <Button
                          variant="outline"
                          pending={pending}
                          onClick={() => void change(sub)}
                        >
                          {sub.enabled ? "停用" : "启用"}
                        </Button>
                        <Button
                          variant="outline"
                          onClick={() => setDeleting(sub)}
                        >
                          删除
                        </Button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </SimpleTable>
          <Notice>
            普通成员可以查看配置与消费日志；脚本源码和修订历史仅项目管理员可见。
          </Notice>
        </AsyncBoundary>
      )}
      {tab === "consumptions" && (
        <Panel bodyClassName="space-y-4 p-5">
          <div className="flex gap-3">
            <StandaloneSelect
              aria-label="消费状态筛选"
              value={filter}
              onValueChange={(value) =>
                navigate({
                  tab,
                  filter: value,
                  subscription_id: params.get("subscription_id") ?? "",
                })
              }
            >
              <option value="">全部状态</option>
              {Object.entries(statusLabel).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </StandaloneSelect>
            <StandaloneSelect
              aria-label="订阅筛选"
              value={params.get("subscription_id") ?? ""}
              onValueChange={(value) =>
                navigate({ tab, filter, subscription_id: value })
              }
            >
              <option value="">全部订阅</option>
              {subscriptions.data?.data.items.map((sub) => (
                <option key={sub.id} value={sub.id}>
                  {sub.name}
                </option>
              ))}
            </StandaloneSelect>
          </div>
          <AsyncBoundary
            loading={runs.isPending}
            error={runs.error}
            onRetry={() => runs.refetch()}
            empty={runs.data?.data.items.length === 0}
            emptyTitle="暂无消费记录"
          >
            <SimpleTable
              label="事件消费记录"
              headers={["记录", "订阅", "状态", "尝试", "创建时间", "操作"]}
            >
              {runs.data?.data.items.map((run) => (
                <tr key={run.id}>
                  <td>
                    #{run.id}
                    {run.retry_of_id && (
                      <p className="text-xs text-muted">
                        重试自 #{run.retry_of_id}
                      </p>
                    )}
                  </td>
                  <td>
                    {subscriptions.data?.data.items.find(
                      (s) => s.id === run.subscription_id,
                    )?.name ?? `#${run.subscription_id}`}
                  </td>
                  <td>
                    <StatusBadge
                      tone={
                        run.status === "failed"
                          ? "danger"
                          : run.status === "succeeded"
                            ? "success"
                            : "neutral"
                      }
                    >
                      {statusLabel[run.status] ?? run.status}
                    </StatusBadge>
                  </td>
                  <td>{run.attempt_count}</td>
                  <td>{formatDate(run.created_at)}</td>
                  <td>
                    <Button
                      variant="outline"
                      onClick={() =>
                        navigate({
                          tab,
                          selected: run.id,
                          filter,
                          before,
                          subscription_id: params.get("subscription_id") ?? "",
                        })
                      }
                    >
                      查看日志
                    </Button>
                  </td>
                </tr>
              ))}
            </SimpleTable>
          </AsyncBoundary>
          <Cursor
            before={before}
            last={runs.data?.data.items.at(-1)?.id}
            count={runs.data?.data.items.length ?? 0}
            change={(value) =>
              navigate({
                tab,
                filter,
                before: value,
                subscription_id: params.get("subscription_id") ?? "",
              })
            }
          />
        </Panel>
      )}
      {selected && tab === "events" && (
        <EventDetail
          base={base}
          id={selected}
          onClose={() => {
            const next = new URLSearchParams(params);
            next.delete("selected");
            setParams(next);
          }}
        />
      )}
      {selected && tab === "consumptions" && (
        <ConsumptionDetail
          key={selected}
          base={base}
          id={selected}
          manage={manage}
          onSelect={(id) => navigate({ tab, selected: id })}
          onEvent={(id) => navigate({ tab: "events", selected: id })}
          onClose={() => {
            const next = new URLSearchParams(params);
            next.delete("selected");
            setParams(next);
          }}
        />
      )}
      {editor && (
        <SubscriptionEditor
          key={editor === "new" ? "new" : editor.id}
          base={base}
          projectCode={project.code}
          subscription={editor === "new" ? undefined : editor}
          readOnly={!manage || Boolean(editor !== "new" && editor.deleted_at)}
          groups={catalog.data?.data.groups ?? []}
          onClose={() => setEditor(undefined)}
          onSaved={() => {
            setEditor(undefined);
            refresh();
            navigate({ tab: "subscriptions" });
          }}
        />
      )}
      <ConfirmDialog
        open={Boolean(deleting)}
        title="删除订阅"
        description="删除后不再接收新事件，等待中的消费会取消，已开始的消费继续完成。历史配置和日志保留。"
        confirmLabel="删除订阅"
        pending={pending}
        onClose={() => setDeleting(undefined)}
        onConfirm={() => deleting && void change(deleting, true)}
      />
    </div>
  );
}

function Cursor({
  before,
  last,
  count,
  change,
}: {
  before: string;
  last?: string;
  count: number;
  change: (value: string) => void;
}) {
  return (
    <div className="flex gap-2">
      <Button variant="outline" disabled={!before} onClick={() => change("")}>
        最新记录
      </Button>
      <Button
        variant="outline"
        disabled={count < 100 || !last}
        onClick={() => last && change(last)}
      >
        更早记录
      </Button>
    </div>
  );
}

function EventDetail({
  base,
  id,
  onClose,
}: {
  base: string;
  id: string;
  onClose: () => void;
}) {
  const query = useApiQuery<EventReference>(
    ["project-event", base, id],
    `${base}/events/${id}`,
  );
  return (
    <Drawer open title={`事件 #${id}`} onClose={onClose}>
      <AsyncBoundary
        loading={query.isPending}
        error={query.error}
        onRetry={() => query.refetch()}
      >
        {query.data && (
          <div className="space-y-4">
            <p>{query.data.data.event.type || "不支持的事件类型"}</p>
            <p className="text-sm text-muted">
              发生时间：
              {query.data.data.event.occurred_at
                ? formatDate(query.data.data.event.occurred_at)
                : "来源未提供"}
            </p>
            <Panel title="标准事件数据">
              <JSONView value={query.data.data.event.data} />
            </Panel>
            <Panel title="GitLab 原始事件">
              <JSONView value={query.data.data.event.raw} />
            </Panel>
          </div>
        )}
      </AsyncBoundary>
    </Drawer>
  );
}
export function JSONView({ value }: { value: unknown }) {
  return (
    <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-surface p-3 text-xs">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

function ConsumptionDetail({
  base,
  id,
  manage,
  onClose,
  onSelect,
  onEvent,
}: {
  base: string;
  id: string;
  manage: boolean;
  onClose: () => void;
  onSelect: (id: string) => void;
  onEvent: (id: string) => void;
}) {
  const [run, setRun] = useState<Consumption>();
  const [logs, setLogs] = useState<Log[]>([]);
  const [error, setError] = useState<unknown>();
  const [pending, setPending] = useState(false);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let after = 0;
    async function poll() {
      try {
        const [detail, lines] = await Promise.all([
          request<Consumption>(`${base}/event-consumptions/${id}`, {
            signal: abort.signal,
          }),
          request<{ items: Log[] }>(
            `${base}/event-consumptions/${id}/logs?after_seq=${after}`,
            { signal: abort.signal },
          ),
        ]);
        if (abort.signal.aborted) return;
        setRun(detail.data);
        setLogs((old) => [
          ...old.filter(
            (line) => !lines.data.items.some((next) => next.seq === line.seq),
          ),
          ...lines.data.items,
        ]);
        after = lines.data.items.at(-1)?.seq ?? after;
        setError(undefined);
        if (
          !["succeeded", "failed", "cancelled"].includes(detail.data.status) ||
          after < detail.data.last_log_seq
        )
          timer = setTimeout(() => void poll(), 1000);
      } catch (e) {
        if (!abort.signal.aborted) setError(e);
      }
    }
    void poll();
    return () => {
      abort.abort();
      clearTimeout(timer);
    };
  }, [base, id, reload]);
  async function retry() {
    setPending(true);
    setError(undefined);
    try {
      const next = await request<Consumption>(
        `${base}/event-consumptions/${id}/retry`,
        { method: "POST", body: {} },
      );
      onSelect(next.data.id);
    } catch (e) {
      setError(e);
    } finally {
      setPending(false);
    }
  }
  return (
    <Drawer open title={`消费记录 #${id}`} onClose={onClose}>
      <div className="space-y-4">
        <ErrorNotice error={error} />
        {Boolean(error) && (
          <Button onClick={() => setReload((v) => v + 1)}>重新加载</Button>
        )}
        {run && (
          <>
            <p>
              {statusLabel[run.status]} · 第 {run.attempt_count} 次尝试 ·
              配置修订 #{run.revision_id}
            </p>
            {run.next_retry_at && (
              <p>下次自动重试：{formatDate(run.next_retry_at)}</p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                onClick={() => onEvent(run.scope_ref_id)}
              >
                查看事件
              </Button>
              {run.retry_of_id && (
                <Button
                  variant="outline"
                  onClick={() => onSelect(run.retry_of_id!)}
                >
                  原消费 #{run.retry_of_id}
                </Button>
              )}
              {manage && run.status === "failed" && (
                <Button pending={pending} onClick={() => void retry()}>
                  使用当前配置人工重试
                </Button>
              )}
            </div>
            {run.error_summary && (
              <Notice tone="danger">
                {run.error_summary} ({run.error_code})
              </Notice>
            )}
            {run.has_result && (
              <Panel title="脚本返回结果">
                <JSONView value={run.result} />
              </Panel>
            )}
          </>
        )}
        <Panel title="消费脚本日志">
          <div className="max-h-[65vh] space-y-3 overflow-auto">
            {logs.length === 0 && <p className="text-muted">暂无日志</p>}
            {logs.map((line) => (
              <div key={line.seq} className="border-b border-border pb-2">
                <p className="text-xs text-muted">
                  #{line.seq} · 尝试 {line.attempt_no} ·{" "}
                  {formatDate(line.occurred_at)} · {line.kind} / {line.level}
                </p>
                <p className="whitespace-pre-wrap break-all text-sm">
                  {line.message}
                </p>
                {line.fields &&
                Object.keys(line.fields as object).length > 0 ? (
                  <JSONView value={line.fields} />
                ) : null}
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </Drawer>
  );
}
