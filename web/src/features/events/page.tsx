import { useState } from "react";
import { useSearchParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Activity, Plus, Radio, Rss } from "lucide-react";
import { request } from "@/api/client";
import { Button } from "@/components/button";
import {
  AsyncBoundary,
  ErrorNotice,
  Notice,
  StatusBadge,
} from "@/components/feedback";
import { StandaloneSelect } from "@/components/fields";
import { PageHeader, PanelRoot, TabPanel, Tabs } from "@/components/layout";
import { ConfirmDialog } from "@/components/overlays";
import { CursorPagination } from "@/components/pagination";
import { SimpleTable } from "@/components/table";
import { TableToolbar } from "@/components/table-toolbar";
import { useApiQuery } from "@/hooks/use-api";
import { formatDate } from "@/lib/utils";
import type { Resource } from "@/types/collaboration";
import { SubscriptionEditor } from "./subscription-editor";
import { ConsumptionDetail, EventDetail, ConsumptionStatus } from "./details";
import {
  statusLabel,
  type Consumption,
  type EventReference,
  type Group,
  type Subscription,
} from "./types";

export function EventsPage({ project }: { project: Resource }) {
  const [params, setParams] = useSearchParams();
  const selectedTab = params.get("tab");
  const tab =
    selectedTab === "events" || selectedTab === "consumptions"
      ? selectedTab
      : !selectedTab && params.has("selected")
        ? "events"
        : "subscriptions";
  const selected = params.get("selected") ?? "";
  const before = params.get("before") ?? "";
  const filter = params.get("filter") ?? "";
  const subscriptionId = params.get("subscription_id") ?? "";
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
    ["event-consumptions", project.id, before, filter, subscriptionId],
    `${base}/event-consumptions?${new URLSearchParams({ before, status: filter, subscription_id: subscriptionId })}`,
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
  const events = history.data?.data.items ?? [];
  const consumptions = runs.data?.data.items ?? [];
  function navigate(next: Record<string, string>) {
    setParams(next);
  }
  function refresh() {
    void qc.invalidateQueries({
      queryKey: ["event-subscriptions", project.id],
    });
    void qc.invalidateQueries({ queryKey: ["event-consumptions", project.id] });
    void qc.invalidateQueries({ queryKey: ["project-events", project.id] });
  }
  async function change(sub: Subscription, remove = false) {
    if (pending) return;
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
  const newSubscription = manage && (
    <Button
      onClick={() => {
        setError(undefined);
        setEditor("new");
      }}
    >
      <Plus /> 新建订阅
    </Button>
  );
  return (
    <div className="space-y-5">
      <PageHeader
        title="事件订阅"
        variant="divided"
        description="管理仓库事件订阅，查看事件来源与脚本消费结果。"
        actions={newSubscription}
      />
      {!deleting && <ErrorNotice error={error} />}
      {project.status !== "active" && (
        <Notice>项目已归档，可以查看历史事件与日志。</Notice>
      )}
      <Tabs
        label="事件视图"
        value={tab}
        onChange={(value) => navigate({ tab: value })}
        items={[
          { value: "subscriptions", label: "订阅列表" },
          { value: "events", label: "事件记录" },
          { value: "consumptions", label: "消费记录" },
        ]}
      >
        {tab === "events" && (
          <TabPanel value="events" className="pt-5">
            <PanelRoot>
              <TableToolbar
                onReset={() => navigate({ tab })}
                onRefresh={() => void history.refetch()}
                refreshing={history.isFetching}
              >
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
              </TableToolbar>
              <AsyncBoundary
                loading={history.isPending}
                error={history.error}
                onRetry={() => history.refetch()}
                empty={!events.length}
                emptyTitle={filter ? "没有匹配此类型的事件" : "暂无项目事件"}
                emptyDescription={
                  filter
                    ? "可以重置筛选查看其他事件。"
                    : "关联 GitLab 仓库后，新收到的 Webhook 事件会出现在这里。"
                }
                emptyIcon={Radio}
              >
                <SimpleTable
                  actions
                  label="项目事件"
                  headers={["事件类型", "关联对象", "接收时间", "操作"]}
                >
                  {events.map((ref) => (
                    <tr key={ref.id}>
                      <td>
                        <strong className="font-medium">
                          {names.get(ref.event.type) ??
                            ref.event.source_event_type}
                        </strong>
                        <p className="mt-0.5 font-mono text-xs text-muted">
                          {ref.event.type || "暂不支持此类型"}
                        </p>
                      </td>
                      <td>
                        {ref.event.subject_kind || "—"} {ref.event.subject_id}
                      </td>
                      <td className="tabular-nums whitespace-nowrap">
                        {formatDate(ref.event.received_at || ref.created_at)}
                      </td>
                      <td>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            navigate({ tab, filter, before, selected: ref.id })
                          }
                        >
                          查看事件
                        </Button>
                      </td>
                    </tr>
                  ))}
                </SimpleTable>
              </AsyncBoundary>
              <CursorPagination
                before={before}
                next={events.length >= 100 ? events.at(-1)?.id : undefined}
                onChange={(value) => navigate({ tab, filter, before: value })}
              />
            </PanelRoot>
          </TabPanel>
        )}
        {tab === "subscriptions" && (
          <TabPanel value="subscriptions" className="pt-5">
            <PanelRoot>
              <TableToolbar
                onRefresh={() => void subscriptions.refetch()}
                refreshing={subscriptions.isFetching}
              >
                <span className="text-sm text-muted">
                  订阅按选定的事件类型运行消费脚本。
                </span>
              </TableToolbar>
              <AsyncBoundary
                loading={subscriptions.isPending}
                error={subscriptions.error}
                onRetry={() => subscriptions.refetch()}
                empty={subscriptions.data?.data.items.length === 0}
                emptyTitle="暂无订阅"
                emptyDescription={
                  manage
                    ? "点击右上角的新建订阅，选择事件和执行机器人。"
                    : "项目管理员可为仓库事件创建订阅。"
                }
                emptyIcon={Rss}
              >
                <SimpleTable
                  actions
                  label="事件订阅"
                  headers={["订阅", "事件类型", "执行配置", "状态", "操作"]}
                >
                  {subscriptions.data?.data.items.map((sub) => (
                    <tr key={sub.id}>
                      <td>
                        <strong className="font-medium">{sub.name}</strong>
                        {sub.description && (
                          <p className="mt-0.5 max-w-64 wrap-anywhere text-xs text-muted">
                            {sub.description}
                          </p>
                        )}
                      </td>
                      <td>
                        <div className="flex max-w-80 flex-wrap gap-1">
                          {sub.config.event_types.map((t) => (
                            <StatusBadge key={t}>
                              {names.get(t) ?? t}
                            </StatusBadge>
                          ))}
                        </div>
                      </td>
                      <td>
                        机器人 #{sub.config.executor_user_id}
                        <p className="text-xs text-muted">
                          超时 {sub.config.timeout_ms / 1000} 秒 · 最多重试{" "}
                          {sub.config.max_retries} 次
                        </p>
                      </td>
                      <td>
                        <StatusBadge
                          tone={
                            !sub.deleted_at && sub.enabled
                              ? "success"
                              : "neutral"
                          }
                        >
                          {sub.deleted_at
                            ? "已删除"
                            : sub.enabled
                              ? "已启用"
                              : "已停用"}
                        </StatusBadge>
                      </td>
                      <td>
                        <div className="flex flex-wrap justify-end gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
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
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setEditor(sub)}
                            >
                              {manage && !sub.deleted_at ? "编辑" : "查看配置"}
                            </Button>
                          )}
                          {manage && !sub.deleted_at && (
                            <>
                              <Button
                                size="sm"
                                variant="ghost"
                                pending={pending}
                                onClick={() => void change(sub)}
                              >
                                {sub.enabled ? "停用" : "启用"}
                              </Button>
                              <Button
                                size="sm"
                                variant="dangerSoft"
                                disabled={pending}
                                onClick={() => {
                                  setError(undefined);
                                  setDeleting(sub);
                                }}
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
              </AsyncBoundary>
            </PanelRoot>
          </TabPanel>
        )}
        {tab === "consumptions" && (
          <TabPanel value="consumptions" className="pt-5">
            <PanelRoot>
              <TableToolbar
                onReset={() => navigate({ tab })}
                onRefresh={() => void runs.refetch()}
                refreshing={runs.isFetching}
              >
                <StandaloneSelect
                  aria-label="消费状态筛选"
                  value={filter}
                  onValueChange={(value) =>
                    navigate({
                      tab,
                      filter: value,
                      subscription_id: subscriptionId,
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
                  value={subscriptionId}
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
              </TableToolbar>
              <AsyncBoundary
                loading={runs.isPending}
                error={runs.error}
                onRetry={() => runs.refetch()}
                empty={!consumptions.length}
                emptyTitle={
                  filter || subscriptionId
                    ? "没有匹配的消费记录"
                    : "暂无消费记录"
                }
                emptyDescription={
                  filter || subscriptionId
                    ? "可以重置筛选查看其他记录。"
                    : "订阅收到匹配的事件后，会生成消费记录。"
                }
                emptyIcon={Activity}
              >
                <SimpleTable
                  actions
                  label="事件消费记录"
                  headers={["记录", "订阅", "状态", "尝试", "创建时间", "操作"]}
                >
                  {consumptions.map((run) => (
                    <tr key={run.id}>
                      <td>
                        <span className="font-mono">#{run.id}</span>
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
                        <ConsumptionStatus status={run.status} />
                      </td>
                      <td>{run.attempt_count}</td>
                      <td className="tabular-nums whitespace-nowrap">
                        {formatDate(run.created_at)}
                      </td>
                      <td>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            navigate({
                              tab,
                              selected: run.id,
                              filter,
                              before,
                              subscription_id: subscriptionId,
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
              <CursorPagination
                before={before}
                next={
                  consumptions.length >= 100
                    ? consumptions.at(-1)?.id
                    : undefined
                }
                onChange={(value) =>
                  navigate({
                    tab,
                    filter,
                    before: value,
                    subscription_id: subscriptionId,
                  })
                }
              />
            </PanelRoot>
          </TabPanel>
        )}
      </Tabs>
      {selected && tab === "events" && (
        <EventDetail
          base={base}
          id={selected}
          names={names}
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
          subscriptions={
            new Map(
              subscriptions.data?.data.items.map((sub) => [sub.id, sub.name]),
            )
          }
          onSelect={(id) => {
            const next = new URLSearchParams(params);
            next.set("selected", id);
            setParams(next);
            void qc.invalidateQueries({
              queryKey: ["event-consumptions", project.id],
            });
          }}
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
        description={
          deleting
            ? `「${deleting.name}」删除后将停止接收新事件。等待中的消费会取消，已开始的消费继续完成，历史配置和日志保留。`
            : undefined
        }
        confirmLabel="删除订阅"
        danger
        pending={pending}
        onClose={() => {
          setError(undefined);
          setDeleting(undefined);
        }}
        onConfirm={() => deleting && void change(deleting, true)}
      >
        <ErrorNotice error={error} />
      </ConfirmDialog>
    </div>
  );
}
