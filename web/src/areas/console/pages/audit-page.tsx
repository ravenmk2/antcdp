import { OverlayPresence } from "@/components/overlay-presence";
import { TableToolbar } from "@/components/table-toolbar";
import { DateRangePicker } from "@/components/date-time-picker";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import { ChevronRight } from "lucide-react";
import { useAuth } from "@/app/auth";
import { Button, IconButton } from "@/components/button";
import { AsyncBoundary } from "@/components/feedback";
import { StandaloneInput, StandaloneSelect } from "@/components/fields";
import { DescriptionList, PageHeader, Panel } from "@/components/layout";
import { Drawer } from "@/components/overlays";
import { Pagination } from "@/components/pagination";
import { SimpleTable } from "@/components/table";
import { useApiQuery } from "@/hooks/use-api";
import { usePageSize } from "@/hooks/use-page-size";
import { useDebouncedSearch } from "@/hooks/use-search";
import { formatDate, jsonText } from "@/lib/utils";
import { CodeBlock } from "@/components/code-block";
import { auditActionLabels, type AuditEvent } from "@/types/audit";

export function AuditPage() {
  const [params, setParams] = useSearchParams();
  const [preferredSize, setPreferredSize] = usePageSize("audit", 10);
  const requestedPage = Number(params.get("page") ?? 1);
  const page =
    Number.isInteger(requestedPage) &&
    requestedPage >= 1 &&
    requestedPage <= 1000000
      ? requestedPage
      : 1;
  const requestedSize = Number(params.get("page_size") ?? params.get("limit"));
  const [selected, setSelected] = useState("");
  const size = [10, 20, 50, 100].includes(requestedSize)
    ? requestedSize
    : preferredSize;
  const filters = new URLSearchParams();
  for (const key of ["q", "action_prefix", "from", "to"])
    if (params.get(key)) filters.set(key, params.get(key) ?? "");
  filters.set("page_size", String(size));
  filters.set("page", String(page));
  const query = useApiQuery<AuditEvent[]>(
    ["audit", filters.toString()],
    `/admin/audit-events?${filters}`,
  );
  const auth = useAuth();
  function filter(values: Record<string, string>) {
    setParams((current) => {
      const next = new URLSearchParams(current);
      next.set("page", "1");
      next.set("page_size", String(size));
      for (const [key, value] of Object.entries(values)) {
        if (value) next.set(key, value);
        else next.delete(key);
      }
      return next;
    });
  }
  const search = useDebouncedSearch(params.get("q") ?? "", (q) =>
    filter({ q }),
  );
  const total = query.data?.pagination?.total;
  useEffect(() => {
    if (total === undefined) return;
    const lastPage = Math.max(1, Math.ceil(total / size));
    if (page > lastPage)
      setParams(
        (current) => {
          const next = new URLSearchParams(current);
          next.set("page", String(lastPage));
          return next;
        },
        { replace: true },
      );
  }, [total, size, page, setParams]);
  return (
    <div className="page">
      <PageHeader
        title="审计日志"
        description="查询系统与业务操作的白名单记录；审计只读。"
      />
      <Panel bodyClassName="p-0">
        <TableToolbar
          onReset={() => {
            search.setValue("");
            setParams({ page_size: String(size), page: "1" });
          }}
          onRefresh={() => void query.refetch()}
          refreshing={query.isFetching}
        >
          <form
            className="flex shrink-0 items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (!search.composing.current) search.submit();
            }}
          >
            <StandaloneInput
              name="q"
              aria-label="搜索审计"
              value={search.value}
              onChange={(event) => search.setValue(event.target.value)}
              onCompositionStart={() => {
                search.composing.current = true;
              }}
              onCompositionEnd={search.compositionEnd}
              maxLength={64}
              placeholder="搜索事件、操作者或对象"
            />
          </form>
          <StandaloneSelect
            className="w-50"
            name="action_prefix"
            aria-label="事件类型"
            value={params.get("action_prefix") ?? ""}
            onValueChange={(action_prefix) => filter({ action_prefix })}
          >
            {[
              ["", "全部事件"],
              ["user.", "用户操作"],
              ["settings.", "系统设置"],
              ["auth.", "登录与退出"],
              ["installation.", "系统安装"],
              ["project.", "项目"],
              ["project_", "仓库与标签"],
              ["team.", "团队"],
              ["service_", "服务集成"],
              ["remote_host.", "远程主机"],
              ["ssh_credential.", "SSH 凭证"],
              ["model_", "模型与提供商"],
              ["mcp_server.", "MCP 服务"],
              ["skill.", "技能"],
              ["email.", "邮件"],
              ["sms.", "短信"],
              ["dingtalk.", "钉钉"],
            ].map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </StandaloneSelect>
          <DateRangePicker
            timezone={auth.settings.timezone}
            value={{
              from: params.get("from") ?? "",
              to: params.get("to") ?? "",
            }}
            onApply={(range) => filter({ from: range.from, to: range.to })}
          />
        </TableToolbar>
        <AsyncBoundary
          loading={query.isPending}
          error={query.error}
          onRetry={() => void query.refetch()}
          empty={!query.data?.data.length}
          emptyTitle="当前筛选下没有审计记录"
        >
          {query.data && (
            <SimpleTable
              actions
              label="审计日志"
              className="min-w-[760px] table-fixed [&_th:nth-child(1)]:w-44 [&_th:nth-child(2)]:w-[30%] [&_th:nth-child(3)]:w-[24%] [&_th:last-child]:w-16"
              headers={["时间", "事件", "操作者", "操作对象", "详情"]}
            >
              {query.data.data.map((event) => (
                <tr
                  key={event.id}
                  tabIndex={0}
                  aria-label={`查看 ${auditActionLabels[event.action] ?? event.action}，${event.actor.display_name}`}
                  className="cursor-pointer focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
                  onClick={() => setSelected(event.id)}
                  onKeyDown={(keyEvent) => {
                    if (
                      keyEvent.target === keyEvent.currentTarget &&
                      (keyEvent.key === "Enter" || keyEvent.key === " ")
                    ) {
                      keyEvent.preventDefault();
                      setSelected(event.id);
                    }
                  }}
                >
                  <td className="text-xs whitespace-nowrap text-muted">
                    {formatDate(event.occurred_at, auth.settings.timezone)}
                  </td>
                  <td>
                    <strong
                      className="line-clamp-2 wrap-anywhere text-foreground"
                      title={auditActionLabels[event.action] ?? event.action}
                    >
                      {auditActionLabels[event.action] ?? event.action}
                    </strong>
                    {auditActionLabels[event.action] && (
                      <span
                        className="mono mt-1 block truncate text-xs text-muted"
                        title={event.action}
                      >
                        {event.action}
                      </span>
                    )}
                  </td>
                  <td>
                    <div
                      className="flex min-w-0 items-baseline gap-2 whitespace-nowrap"
                      title={`${event.actor.display_name}${event.actor.username ? ` @${event.actor.username}` : "（系统）"}`}
                    >
                      <span className="min-w-0 truncate text-foreground">
                        {event.actor.display_name}
                      </span>
                      <span className="min-w-0 max-w-[55%] shrink-0 truncate text-xs text-muted">
                        {event.actor.username
                          ? `@${event.actor.username}`
                          : "系统"}
                      </span>
                    </div>
                  </td>
                  <td>
                    <span
                      className="block truncate"
                      title={event.target.label || undefined}
                    >
                      {event.target.label || "—"}
                    </span>
                  </td>
                  <td>
                    <IconButton
                      size="iconSm"
                      label={`查看 ${auditActionLabels[event.action] ?? event.action}`}
                      onClick={(clickEvent) => {
                        clickEvent.stopPropagation();
                        setSelected(event.id);
                      }}
                    >
                      <ChevronRight />
                    </IconButton>
                  </td>
                </tr>
              ))}
            </SimpleTable>
          )}
        </AsyncBoundary>
        {query.data && (
          <Pagination
            page={page}
            size={size}
            total={total}
            pending={query.isFetching}
            onChange={(nextPage, nextSize) => {
              if (nextSize !== size) setPreferredSize(nextSize);
              setParams((current) => {
                const updated = new URLSearchParams(current);
                updated.set("page_size", String(nextSize));
                updated.set("page", String(nextPage));
                updated.delete("limit");
                return updated;
              });
            }}
          />
        )}
      </Panel>
      <OverlayPresence>
        {selected && (
          <AuditDetail id={selected} onClose={() => setSelected("")} />
        )}
      </OverlayPresence>
    </div>
  );
}

export function AuditDetail({
  id,
  onClose,
}: {
  id: string;
  onClose: () => void;
}) {
  const auth = useAuth();
  const query = useApiQuery<AuditEvent>(
    ["audit-event", id],
    `/admin/audit-events/${id}`,
  );
  return (
    <Drawer
      open
      wide
      title="审计事件详情"
      onClose={onClose}
      footer={<Button onClick={onClose}>关闭</Button>}
    >
      <AsyncBoundary
        loading={query.isPending}
        error={query.error}
        onRetry={() => void query.refetch()}
      >
        {query.data && (
          <div className="grid gap-5">
            <DescriptionList
              items={[
                {
                  label: "ID",
                  value: <span className="mono">{query.data.data.id}</span>,
                },
                {
                  label: "对象",
                  value: `${query.data.data.target.type} · ${query.data.data.target.label}`,
                },
                {
                  label: "事件",
                  value:
                    auditActionLabels[query.data.data.action] ??
                    query.data.data.action,
                },
                {
                  label: "事件代码",
                  value: <span className="mono">{query.data.data.action}</span>,
                },
                {
                  label: "操作者",
                  value: `${query.data.data.actor.display_name}${query.data.data.actor.username ? ` @${query.data.data.actor.username}` : ""}`,
                },
                {
                  label: "发生时间",
                  value: formatDate(
                    query.data.data.occurred_at,
                    auth.settings.timezone,
                  ),
                },
                {
                  label: "请求编号",
                  value: (
                    <span className="mono">
                      {query.data.data.request_id ?? "—"}
                    </span>
                  ),
                },
                {
                  label: "来源地址",
                  value: (
                    <span className="mono">
                      {query.data.data.ip_address ?? "—"}
                    </span>
                  ),
                },
              ]}
            />
            <section>
              <h3
                id="audit-operation-data"
                className="mb-2 text-sm font-medium"
              >
                操作数据
              </h3>
              <AuditData source={jsonText(query.data.data.detail)} />
            </section>
          </div>
        )}
      </AsyncBoundary>
    </Drawer>
  );
}

function AuditData({ source }: { source: string }) {
  return (
    <CodeBlock
      source={source}
      language="json"
      title="JSON"
      lineNumbers={false}
      defaultWrap
      copyLabel="复制操作数据"
      contentLabel="操作数据"
      className="my-0"
      contentClassName="max-h-96"
    />
  );
}
