import {
  AsyncBoundary,
  EmptyState,
  Notice,
  StatusBadge,
} from "@/components/feedback";
import { Drawer, OverlayCancelButton } from "@/components/overlays";
import { Pagination } from "@/components/pagination";
import { agentRoot } from "@/features/agents/data/agent-api";
import { runtimeReason } from "@/features/agents/data/runtime-reasons";
import { useApiQuery } from "@/hooks/use-api";
import type { ModelCallMetadata, UsageTotals } from "@/types/agents";
import { useState } from "react";

export const completenessNames = {
  complete: "完整",
  partial: "部分已知",
  unknown: "未提供",
};
export function tokenValue(value: string | null) {
  return value === null ? "未提供" : BigInt(value).toLocaleString();
}
export function UsageSummary({ value }: { value: UsageTotals }) {
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <StatusBadge
          tone={value.usage_completeness === "complete" ? "success" : "warning"}
        >
          用量：{completenessNames[value.usage_completeness]}
        </StatusBadge>
        <p className="text-xs text-muted">
          数字仅表示已知部分。缓存用量不与输入 Token 重复相加。
        </p>
      </div>
      <dl className="grid grid-cols-4 gap-5">
        {[
          ["模型调用", value.model_call_count],
          [
            "已完成 / 失败",
            `${value.completed_call_count} / ${value.failed_call_count}`,
          ],
          ["返回用量的调用", value.known_usage_call_count],
          ["缺少用量的调用", value.unknown_usage_call_count],
          ["输入 Token", tokenValue(value.input_tokens)],
          ["输出 Token", tokenValue(value.output_tokens)],
          ["缓存读取 Token", tokenValue(value.cache_read_tokens)],
          ["缓存写入 Token", tokenValue(value.cache_write_tokens)],
        ].map(([label, number]) => (
          <div key={label}>
            <dt className="text-xs text-muted">{label}</dt>
            <dd className="mt-2 text-lg font-semibold tabular-nums">
              {number}
            </dd>
          </div>
        ))}
      </dl>
      <p className="text-xs text-muted">
        {value.estimated_cost
          ? `估算费用 ${value.estimated_cost.amount} ${value.estimated_cost.currency}（价格版本 ${value.estimated_cost.pricing_version}）；不是供应商账单。`
          : "费用估算未提供。"}
      </p>
    </div>
  );
}
export function SessionUsage({ sessionId }: { sessionId: string }) {
  const query = useApiQuery<UsageTotals>(
    ["agent-session", sessionId, "usage"],
    `${agentRoot}/sessions/${sessionId}/usage`,
  );
  return (
    <AsyncBoundary
      loading={query.isPending}
      error={query.error}
      onRetry={() => query.refetch()}
    >
      {query.data && <UsageSummary value={query.data.data} />}
    </AsyncBoundary>
  );
}
const callStatus = {
  preparing: "准备中",
  streaming: "生成中",
  succeeded: "成功",
  failed: "失败",
  cancelled: "已取消",
  interrupted: "已中断",
};
export function ModelCalls({
  path,
  sessionId,
}: {
  path: string;
  sessionId?: string;
}) {
  return <ModelCallList key={path} path={path} sessionId={sessionId} />;
}
export function ModelCallList({
  path,
  sessionId,
}: {
  path: string;
  sessionId?: string;
}) {
  const [page, setPage] = useState(1),
    [selected, setSelected] = useState<ModelCallMetadata | null>(null);
  const result = useApiQuery<ModelCallMetadata[]>(
    sessionId
      ? ["agent-session", sessionId, "calls", path, page]
      : ["agent-model-calls", path, page],
    `${path}${path.includes("?") ? "&" : "?"}page=${page}&page_size=20`,
  );
  return (
    <>
      <AsyncBoundary
        loading={result.isPending}
        error={result.error}
        onRetry={() => result.refetch()}
      >
        <div className="space-y-3">
          {result.data?.data.map((call) => (
            <button
              key={call.id}
              className="flex w-full items-center justify-between gap-5 rounded-lg border p-4 text-left hover:bg-surface-hover"
              onClick={() => setSelected(call)}
            >
              <span className="min-w-0">
                <span
                  className="block truncate text-sm font-medium"
                  title={call.requested_model}
                >
                  {call.requested_model}
                </span>
                <span className="mt-2 block text-xs text-muted">
                  {call.purpose === "compaction"
                    ? "上下文压缩"
                    : call.purpose === "title"
                      ? "会话自动命名"
                      : `步骤 ${call.step} · 尝试 ${call.attempt}`}{" "}
                  ·{" "}
                  {call.started_at
                    ? new Date(call.started_at).toLocaleString()
                    : "尚未开始"}
                </span>
              </span>
              <span className="shrink-0 text-right">
                <StatusBadge>{callStatus[call.status]}</StatusBadge>
                <span className="mt-2 block text-xs text-muted">
                  {call.latency_ms === null
                    ? "耗时未提供"
                    : `${call.latency_ms.toLocaleString()} ms`}{" "}
                  · 用量{completenessNames[call.usage_completeness]}
                </span>
              </span>
            </button>
          ))}
        </div>
        {result.data?.data.length === 0 && <EmptyState title="尚无模型调用" />}
        <Pagination
          page={page}
          size={20}
          total={result.data?.pagination?.total}
          pending={result.isFetching}
          onChange={setPage}
        />
      </AsyncBoundary>
      {selected && (
        <Drawer
          open
          wide
          title="模型调用事实"
          onClose={() => setSelected(null)}
          footer={<OverlayCancelButton>关闭</OverlayCancelButton>}
        >
          <Notice>
            仅展示返回的调用元数据，不提供原始提示、HTTP 收发包或凭证。
          </Notice>
          <dl className="mt-6 grid grid-cols-2 gap-5 text-sm">
            {[
              ["请求模型", selected.requested_model],
              ["返回模型", selected.returned_model ?? "未提供"],
              ["状态", callStatus[selected.status]],
              ["思考选项", selected.thinking_option_key],
              ["输入 Token", tokenValue(selected.usage.input_tokens)],
              ["输出 Token", tokenValue(selected.usage.output_tokens)],
              ["缓存读取 Token", tokenValue(selected.usage.cache_read_tokens)],
              ["缓存写入 Token", tokenValue(selected.usage.cache_write_tokens)],
              ["用量完整性", completenessNames[selected.usage_completeness]],
              ["归一化版本", selected.usage.normalization_version],
              ["诊断标识", selected.error_code ?? "无"],
              ["诊断说明", runtimeReason(selected.error_code) || "无"],
              ["配置摘要", selected.request_config_hash],
            ].map(([label, value]) => (
              <div key={label}>
                <dt className="text-xs text-muted">{label}</dt>
                <dd className="mt-2 break-all">{value}</dd>
              </div>
            ))}
          </dl>
        </Drawer>
      )}
    </>
  );
}
