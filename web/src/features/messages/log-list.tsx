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
export function MessageLogList({ module }: { module: "email" | "sms" }) {
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "";
  const status = params.get("status") ?? "";
  const days = ["1", "7", "30"].includes(params.get("days") ?? "")
    ? (params.get("days") ?? "30")
    : "30";
  const profile = params.get("profile_id") ?? "";
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
    from: new Date(now - Number(days) * 86400000).toISOString(),
  });
  if (profile) filters.set("profile_id", profile);
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
      <div className="toolbar">
        <form
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
          onChange={(event) => filter({ status: event.target.value })}
        >
          <option value="">全部状态</option>
          {Object.entries(messageStatusLabels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </StandaloneSelect>
        <StandaloneSelect
          aria-label="日志时间"
          value={days}
          onChange={(event) => filter({ days: event.target.value })}
        >
          {[30, 7, 1].map((value) => (
            <option key={value} value={value}>
              近 {value} 天
            </option>
          ))}
        </StandaloneSelect>
        <StandaloneInput
          aria-label="配置 ID"
          placeholder="配置 ID（可选）"
          value={profile}
          onChange={(event) => filter({ profile_id: event.target.value })}
        />
        <Button
          variant="ghost"
          onClick={() =>
            filter({ q: "", status: "", days: "30", profile_id: "" })
          }
        >
          清除筛选
        </Button>
        <Button
          variant="ghost"
          onClick={() => {
            setNow(Date.now());
            void query.refetch();
          }}
        >
          刷新
        </Button>
      </div>
      <AsyncBoundary
        loading={query.isPending}
        error={query.error}
        onRetry={() => void query.refetch()}
        empty={!query.data?.data.items.length}
        emptyTitle="保留期内暂无发送记录"
      >
        {query.data && (
          <SimpleTable
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
                  {formatDate(log.started_at)}
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
                    : "info"
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
                    value: formatDate(query.data.data.started_at),
                  },
                  {
                    label: "完成时间",
                    value: formatDate(query.data.data.finished_at),
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
