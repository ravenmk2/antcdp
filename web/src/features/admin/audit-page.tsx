import { useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { ChevronRight, FunnelX } from "lucide-react";
import { useAuth } from "@/app/auth";
import { Button, IconButton } from "@/components/button";
import { AsyncBoundary, ErrorNotice } from "@/components/feedback";
import { StandaloneInput, StandaloneSelect } from "@/components/fields";
import { DescriptionList, PageHeader, Panel } from "@/components/layout";
import { Drawer } from "@/components/overlays";
import { Pagination } from "@/components/pagination";
import { SimpleTable } from "@/components/table";
import { useApiQuery } from "@/hooks/use-api";
import { usePageSize } from "@/hooks/use-page-size";
import { useDebouncedSearch } from "@/hooks/use-search";
import { formatDate, jsonText } from "@/lib/utils";
import { auditActionLabels, type AuditEvent } from "@/types/audit";

export function AuditPage() {
  const [params, setParams] = useSearchParams();
  const [preferredSize, setPreferredSize] = usePageSize("audit", 10);
  const [cursors, setCursors] = useState<string[]>([""]);
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState("");
  const [dates, setDates] = useState(params.has("from") || params.has("to"));
  const [filterError, setFilterError] = useState("");
  const size = [10, 20, 50, 100].includes(Number(params.get("limit")))
    ? Number(params.get("limit"))
    : preferredSize;
  const filters = new URLSearchParams();
  for (const key of ["q", "action_prefix", "from", "to"])
    if (params.get(key)) filters.set(key, params.get(key) ?? "");
  filters.set("limit", String(size));
  if (cursors[page]) filters.set("cursor", cursors[page]);
  const query = useApiQuery<AuditEvent[]>(
    ["audit", filters.toString()],
    `/admin/audit-events?${filters}`,
  );
  const auth = useAuth();
  const formRef = useRef<HTMLFormElement>(null);
  const search = useDebouncedSearch(params.get("q") ?? "", () => {
    if (formRef.current) apply(formRef.current);
  });
  function apply(form: HTMLFormElement) {
    const data = new FormData(form);
    const from = String(data.get("from") ?? "");
    const to = String(data.get("to") ?? "");
    if (
      (from && !Number.isFinite(Date.parse(from))) ||
      (to && !Number.isFinite(Date.parse(to))) ||
      (from && to && Date.parse(from) >= Date.parse(to))
    ) {
      setFilterError("请输入有效时间，结束时间必须晚于开始时间。");
      return;
    }
    setFilterError("");
    const next = new URLSearchParams({ limit: String(size) });
    for (const key of ["q", "action_prefix"])
      if (data.get(key)) next.set(key, String(data.get(key)).trim());
    if (from) next.set("from", new Date(from).toISOString());
    if (to) next.set("to", new Date(to).toISOString());
    setParams(next);
    setCursors([""]);
    setPage(0);
  }
  const next = query.data?.pagination?.next_cursor;
  return (
    <div className="page">
      <PageHeader
        title="审计日志"
        description="查询系统与业务操作的白名单记录；审计只读。"
      />
      <Panel bodyClassName="p-0">
        <form
          ref={formRef}
          className="toolbar"
          onSubmit={(event) => {
            event.preventDefault();
            if (!search.composing.current) apply(event.currentTarget);
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
          <StandaloneSelect
            name="action_prefix"
            aria-label="事件类型"
            defaultValue={params.get("action_prefix") ?? ""}
          >
            {[
              ["", "全部事件"],
              ["user.", "用户操作"],
              ["settings.", "系统设置"],
              ["auth.", "登录与退出"],
              ["installation.", "系统安装"],
              ["project.", "项目"],
              ["project_", "仓库与产品分支"],
              ["team.", "团队"],
              ["service_", "服务集成"],
              ["remote_host.", "远程主机"],
              ["ssh_credential.", "SSH 凭证"],
              ["email.", "邮件"],
              ["sms.", "短信"],
              ["dingtalk.", "钉钉"],
            ].map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </StandaloneSelect>
          <Button
            variant="outline"
            aria-expanded={dates}
            onClick={() => setDates(!dates)}
          >
            时间范围
          </Button>
          <IconButton
            label="清除筛选"
            onClick={() => {
              search.setValue("");
              setFilterError("");
              setParams({ limit: String(size) });
              setCursors([""]);
              setPage(0);
            }}
          >
            <FunnelX />
          </IconButton>
          {dates && (
            <div className="grid gap-3 border-b p-4 sm:grid-cols-2">
              <label className="grid gap-1 text-xs">
                开始时间（本地）
                <StandaloneInput
                  name="from"
                  type="datetime-local"
                  defaultValue={localDate(params.get("from"))}
                />
              </label>
              <label className="grid gap-1 text-xs">
                结束时间（本地）
                <StandaloneInput
                  name="to"
                  type="datetime-local"
                  defaultValue={localDate(params.get("to"))}
                />
              </label>
            </div>
          )}
        </form>
        {filterError && (
          <div className="p-4">
            <ErrorNotice error={filterError} />
          </div>
        )}
        <AsyncBoundary
          loading={query.isPending}
          error={query.error}
          onRetry={() => void query.refetch()}
          empty={!query.data?.data.length}
          emptyTitle="当前筛选下没有审计记录"
        >
          {query.data && (
            <SimpleTable
              label="审计日志"
              className="min-w-[800px]"
              headers={["时间", "事件", "操作者", "操作对象", "详情"]}
            >
              {query.data.data.map((event) => (
                <tr key={event.id}>
                  <td className="text-xs text-muted">
                    {formatDate(event.occurred_at, auth.settings.timezone)}
                  </td>
                  <td>
                    <strong className="text-foreground">
                      {auditActionLabels[event.action] ?? event.action}
                    </strong>
                    <small className="mono block text-muted">
                      {event.action}
                    </small>
                  </td>
                  <td>
                    {event.actor.display_name}
                    <small className="block text-muted">
                      {event.actor.username
                        ? `@${event.actor.username}`
                        : "系统"}
                    </small>
                  </td>
                  <td className="max-w-sm break-all">
                    {event.target.label || "—"}
                  </td>
                  <td>
                    <IconButton
                      size="iconSm"
                      label={`查看 ${auditActionLabels[event.action] ?? event.action}`}
                      onClick={() => setSelected(event.id)}
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
            page={page + 1}
            size={size}
            pageItems={query.data.data.length}
            hasNext={Boolean(next)}
            pending={query.isFetching}
            onChange={(nextPage, nextSize) => {
              if (nextSize !== size) {
                setPreferredSize(nextSize);
                setParams((current) => {
                  const updated = new URLSearchParams(current);
                  updated.set("limit", String(nextSize));
                  return updated;
                });
                setCursors([""]);
                setPage(0);
              } else if (nextPage <= page + 1) setPage(nextPage - 1);
              else if (next) {
                setCursors((current) => [...current.slice(0, page + 1), next]);
                setPage(nextPage - 1);
              }
            }}
          />
        )}
      </Panel>
      {selected && (
        <AuditDetail id={selected} onClose={() => setSelected("")} />
      )}
    </div>
  );
}

function localDate(value: string | null) {
  if (!value || !Number.isFinite(Date.parse(value))) return "";
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
}

export function AuditDetail({
  id,
  onClose,
}: {
  id: string;
  onClose: () => void;
}) {
  const query = useApiQuery<AuditEvent>(
    ["audit-event", id],
    `/admin/audit-events/${id}`,
  );
  return (
    <Drawer
      open
      wide
      title="审计事件详情"
      description={id}
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
                  value: formatDate(query.data.data.occurred_at),
                },
                {
                  label: "对象",
                  value: `${query.data.data.target.type} · ${query.data.data.target.label}`,
                  full: true,
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
              <h3 className="mb-2 text-sm font-medium">白名单变更详情</h3>
              <pre className="max-h-96 overflow-auto rounded-lg bg-surface-subtle p-4 text-xs break-all whitespace-pre-wrap">
                {jsonText(query.data.data.detail)}
              </pre>
            </section>
          </div>
        )}
      </AsyncBoundary>
    </Drawer>
  );
}
