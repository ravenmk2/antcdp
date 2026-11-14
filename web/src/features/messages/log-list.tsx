import { useAuth } from "@/app/auth";
import { TableToolbar } from "@/components/table-toolbar";
import { DateRangePicker } from "@/components/date-time-picker";
import { useState } from "react";
import { Link, useSearchParams } from "react-router";
import { ChevronRight } from "lucide-react";
import { Button } from "@/components/button";
import { AsyncBoundary, Notice, StatusBadge } from "@/components/feedback";
import { StandaloneInput, StandaloneSelect } from "@/components/fields";
import { DescriptionList, Panel } from "@/components/layout";
import { Drawer } from "@/components/overlays";
import { Pagination } from "@/components/pagination";
import { SimpleTable } from "@/components/table";
import { useApiQuery } from "@/hooks/use-api";
import { formatBytes, formatDate } from "@/lib/utils";
import {
  messageReasons,
  messageStatusLabels,
  type MessageLog,
} from "@/types/messages";

interface Page {
  items: MessageLog[];
  total: number;
  page: number;
  page_size: number;
}
export function MessageLogList({
  module,
  profileOptions,
  templateOptions,
}: {
  module: "email" | "sms";
  profileOptions?: { id: string; name: string }[];
  templateOptions?: { id: string; name: string }[];
}) {
  const { settings } = useAuth();
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "";
  const status = params.get("status") ?? "";
  const days = ["1", "7", "30"].includes(params.get("days") ?? "")
    ? (params.get("days") ?? "30")
    : "30";
  const profile = params.get("profile_id") ?? "";
  const template = params.get("template_id") ?? "";
  const actor = params.get("actor_user_id") ?? "";
  const page = Math.max(1, Number(params.get("page")) || 1);
  const size = [10, 20, 50, 100].includes(Number(params.get("page_size")))
    ? Number(params.get("page_size"))
    : 20;
  const [now, setNow] = useState(Date.now);
  const filters = new URLSearchParams({
    q,
    status,
    page: String(page),
    page_size: String(size),
    from:
      params.get("from") ||
      new Date(now - Number(days) * 86400000).toISOString(),
  });
  if (params.get("to")) filters.set("to", params.get("to")!);
  if (profile) filters.set("profile_id", profile);
  if (template) filters.set("template_id", template);
  if (actor) filters.set("actor_user_id", actor);
  const query = useApiQuery<Page>(
    ["message-logs", module, filters.toString()],
    `/admin/${module}/send-logs?${filters}`,
  );
  function filter(values: Record<string, string>) {
    setParams((current) => {
      const next = new URLSearchParams(current);
      next.set("page", "1");
      for (const [key, value] of Object.entries(values)) {
        if (value) next.set(key, value);
        else next.delete(key);
      }
      return next;
    });
  }
  return (
    <Panel bodyClassName="p-0">
      <TableToolbar
        onReset={() => {
          setNow(Date.now());
          filter({
            q: "",
            status: "",
            days: "30",
            profile_id: "",
            template_id: "",
            actor_user_id: "",
            from: "",
            to: "",
          });
        }}
        refreshing={query.isFetching}
        onRefresh={() => {
          if (params.get("from") || params.get("to")) void query.refetch();
          else setNow(Date.now());
        }}
        advancedCount={[profile, template, actor].filter(Boolean).length}
        advanced={
          <div className="grid min-w-0 flex-1 grid-cols-1 gap-x-4 gap-y-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(12rem,0.6fr)]">
            <label className="grid min-w-0 gap-1.5 text-xs text-muted">
              {module === "email" ? "SMTP 配置" : "短信配置"}
              {profileOptions ? (
                <StandaloneSelect
                  aria-label={`筛选${module === "email" ? "SMTP" : "短信"}配置`}
                  value={profile}
                  onValueChange={(value) => filter({ profile_id: value })}
                >
                  <option value="">全部配置</option>
                  {profile &&
                    !profileOptions.some((item) => item.id === profile) && (
                      <option value={profile}>历史配置 · {profile}</option>
                    )}
                  {profileOptions.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </StandaloneSelect>
              ) : (
                <StandaloneInput
                  aria-label="配置 ID"
                  placeholder="输入配置 ID"
                  value={profile}
                  onChange={(event) =>
                    filter({ profile_id: event.target.value })
                  }
                />
              )}
            </label>
            <>
              <label className="grid min-w-0 gap-1.5 text-xs text-muted">
                {module === "email" ? "邮件模板" : "短信模板"}
                {templateOptions ? (
                  <StandaloneSelect
                    aria-label={`筛选${module === "email" ? "邮件" : "短信"}模板`}
                    value={template}
                    onValueChange={(value) => filter({ template_id: value })}
                  >
                    <option value="">全部模板</option>
                    {template &&
                      !templateOptions.some((item) => item.id === template) && (
                        <option value={template}>历史模板 · {template}</option>
                      )}
                    {templateOptions.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </StandaloneSelect>
                ) : (
                  <StandaloneInput
                    aria-label="模板 ID"
                    value={template}
                    placeholder="输入模板 ID"
                    onChange={(event) =>
                      filter({ template_id: event.target.value })
                    }
                  />
                )}
              </label>
              <label className="grid min-w-0 gap-1.5 text-xs text-muted">
                操作者 ID
                <StandaloneInput
                  aria-label="操作者 ID"
                  value={actor}
                  placeholder="输入操作者 ID"
                  onChange={(event) =>
                    filter({ actor_user_id: event.target.value })
                  }
                />
              </label>
              <p className="col-span-full text-xs text-muted">
                日志保留 30 天；已删除配置或模板的历史记录仍可查询。
              </p>
            </>
          </div>
        }
      >
        <form
          className="flex shrink-0 items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            filter({
              q: String(new FormData(event.currentTarget).get("q") ?? ""),
            });
          }}
        >
          <StandaloneInput
            name="q"
            aria-label="搜索发送日志"
            defaultValue={q}
            placeholder="搜索配置名称或测试编号"
          />
        </form>
        <StandaloneSelect
          aria-label="发送结果"
          value={status}
          onValueChange={(value) => filter({ status: value })}
        >
          <option value="">全部状态</option>
          {Object.entries(messageStatusLabels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </StandaloneSelect>
        <DateRangePicker
          timezone={settings.timezone}
          retentionDays={30}
          value={{
            from: filters.get("from") ?? "",
            to: filters.get("to") ?? "",
            preset: params.get("from") || params.get("to") ? "custom" : days,
          }}
          onApply={(range) => {
            setNow(Date.now());
            if (["1", "7", "30"].includes(range.preset ?? ""))
              filter({ days: range.preset!, from: "", to: "" });
            else filter({ from: range.from, to: range.to, days: "30" });
          }}
        />
      </TableToolbar>
      <AsyncBoundary
        loading={query.isPending}
        error={query.error}
        onRetry={() => void query.refetch()}
        empty={!query.data?.data.items.length}
        emptyTitle="保留期内暂无发送记录"
      >
        {query.data && (
          <SimpleTable
            actions
            label="发送日志"
            headers={["发送配置", "接收目标", "结果", "开始时间", "操作"]}
          >
            {query.data.data.items.map((log) => (
              <tr key={log.id}>
                <td>
                  <strong className="text-foreground">
                    {log.profile_name}
                  </strong>
                  <small className="block text-muted">
                    {log.template_name || "直接内容"}
                  </small>
                </td>
                <td>{log.recipient_mask}</td>
                <td>
                  <StatusBadge
                    tone={
                      log.status === "accepted"
                        ? "success"
                        : log.status === "unknown"
                          ? "warning"
                          : log.status === "in_progress"
                            ? "info"
                            : "danger"
                    }
                  >
                    {log.outdated ? "历史 · " : ""}
                    {messageStatusLabels[log.status] ?? log.status}
                  </StatusBadge>
                  <small className="mt-1 block text-muted">
                    {messageReasons[log.reason_code] ?? log.reason_code}
                  </small>
                </td>
                <td className="text-xs text-muted">
                  {formatDate(log.started_at, settings.timezone)}
                  <small className="block">{log.actor_name}</small>
                </td>
                <td>
                  <Link
                    className="link"
                    to={`/admin/${module}/send-logs/${log.id}?${params}`}
                    aria-label="查看发送记录"
                  >
                    <ChevronRight className="size-4" />
                  </Link>
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
          total={query.data.data.total}
          pending={query.isFetching}
          onChange={(nextPage, nextSize) =>
            setParams((current) => {
              const next = new URLSearchParams(current);
              next.set("page", String(nextPage));
              next.set("page_size", String(nextSize));
              return next;
            })
          }
        />
      )}
    </Panel>
  );
}

export function MessageLogDetail({
  module,
  id,
  onClose,
}: {
  module: "email" | "sms";
  id: string;
  onClose: () => void;
}) {
  const { settings } = useAuth();
  const query = useApiQuery<MessageLog>(
    ["message-log", module, id],
    `/admin/${module}/send-logs/${id}`,
  );
  return (
    <Drawer
      open
      title="发送记录"
      description={query.data?.data.test_id ?? id}
      onClose={onClose}
      footer={<Button onClick={onClose}>关闭</Button>}
    >
      <AsyncBoundary
        loading={query.isPending}
        error={query.error}
        onRetry={() => void query.refetch()}
      >
        {query.data && (
          <>
            <Notice
              tone={
                query.data.data.status === "accepted"
                  ? "success"
                  : query.data.data.status === "unknown"
                    ? "warning"
                    : query.data.data.status === "in_progress"
                      ? "info"
                      : "danger"
              }
            >
              {messageStatusLabels[query.data.data.status] ??
                query.data.data.status}{" "}
              ·{" "}
              {messageReasons[query.data.data.reason_code] ??
                query.data.data.reason_code}
              。受理不代表送达或已读。
            </Notice>
            <div className="mt-5">
              <DescriptionList
                items={[
                  { label: "配置", value: query.data.data.profile_name },
                  {
                    label: "模板",
                    value: query.data.data.template_name || "直接内容",
                  },
                  { label: "接收目标", value: query.data.data.recipient_mask },
                  { label: "操作者", value: query.data.data.actor_name },
                  {
                    label: "开始时间",
                    value: formatDate(
                      query.data.data.started_at,
                      settings.timezone,
                    ),
                  },
                  {
                    label: "完成时间",
                    value: formatDate(
                      query.data.data.finished_at,
                      settings.timezone,
                    ),
                  },
                  { label: "阶段", value: query.data.data.stage },
                  {
                    label: "供应商请求",
                    value:
                      query.data.data.provider_request_id ??
                      query.data.data.message_id ??
                      "—",
                  },
                  ...(module === "email"
                    ? [
                        {
                          label: "附件",
                          value: `${query.data.data.attachment_count ?? 0} 个 · ${formatBytes(query.data.data.attachment_bytes ?? 0)}`,
                        },
                      ]
                    : []),
                ]}
              />
            </div>
          </>
        )}
      </AsyncBoundary>
    </Drawer>
  );
}
