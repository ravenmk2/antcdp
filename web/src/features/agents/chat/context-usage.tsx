import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/button";
import { useApiQuery } from "@/hooks/use-api";
import type { SessionUsageReport } from "@/types/agents";
import { agentRoot } from "../data/agent-api";

export function tokenPercent(
  numerator: string | null | undefined,
  denominator: string | null | undefined,
  allowOverflow = false,
) {
  if (
    numerator == null ||
    denominator == null ||
    !/^\d+$/.test(numerator) ||
    !/^\d+$/.test(denominator)
  )
    return null;
  const n = BigInt(numerator),
    d = BigInt(denominator);
  if (d === 0n || (!allowOverflow && n > d)) return null;
  // Truncate rather than round a near-total cache hit to 100%.
  return Number((n * 10000n) / d) / 100;
}
const count = (value: string | null | undefined) =>
  value == null ? "未提供" : BigInt(value).toLocaleString();
const percent = (value: number | null) =>
  value === null
    ? "—"
    : `${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}%`;

export function ContextUsage({ sessionId }: { sessionId: string }) {
  const query = useApiQuery<SessionUsageReport>(
    ["agent-session", sessionId, "workspace", "usage"],
    `${agentRoot}/sessions/${sessionId}/usage`,
  );
  const data = query.data?.data,
    context = data?.context,
    cache = data?.cache;
  const occupancy = context?.stale
    ? null
    : tokenPercent(context?.input_tokens, context?.window_tokens, true);
  const hit = tokenPercent(context?.cache_read_tokens, context?.input_tokens);
  const totalHit = tokenPercent(cache?.cache_read_tokens, cache?.input_tokens);
  return (
    <Popover>
      <PopoverTrigger
        className="agent-context-trigger"
        aria-label={`上下文 ${percent(occupancy)}，缓存命中 ${percent(hit)}，查看用量`}
      >
        <svg
          viewBox="0 0 24 24"
          className="size-5 shrink-0 -rotate-90"
          aria-hidden="true"
        >
          <circle
            cx="12"
            cy="12"
            r="9"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            opacity=".16"
          />
          <circle
            cx="12"
            cy="12"
            r="9"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            pathLength="100"
            strokeDasharray={`${Math.min(occupancy ?? 0, 100)} 100`}
            strokeLinecap="round"
            className={
              occupancy !== null && occupancy >= 90
                ? "text-danger"
                : occupancy !== null && occupancy >= 70
                  ? "text-warning"
                  : "text-primary"
            }
          />
        </svg>
        <span className="agent-context-value">{percent(occupancy)}</span>
        <span className="agent-context-cache">缓存 {percent(hit)}</span>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        className="w-80 max-w-[calc(100vw-2rem)] rounded-2xl space-y-3"
      >
        <h3 className="text-sm font-medium">上下文与缓存</h3>
        {query.isError ? (
          <div className="space-y-2 text-sm">
            <p>用量暂时无法读取</p>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void query.refetch()}
            >
              重试
            </Button>
          </div>
        ) : query.isPending ? (
          <p role="status" className="text-sm text-muted">
            正在读取用量…
          </p>
        ) : (
          <>
            <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-2 text-xs tabular-nums">
              <dt>上下文占用</dt>
              <dd className="text-right">{percent(occupancy)}</dd>
              <dt>最近请求输入</dt>
              <dd className="text-right">{count(context?.input_tokens)}</dd>
              <dt>模型上下文窗口</dt>
              <dd className="text-right">
                {context?.window_tokens === "0"
                  ? "未提供"
                  : count(context?.window_tokens)}
              </dd>
              <dt>预留输出上限</dt>
              <dd className="text-right">
                {context?.reserved_output_tokens === "0"
                  ? "未提供"
                  : count(context?.reserved_output_tokens)}
              </dd>
              <dt>最近请求缓存命中</dt>
              <dd className="text-right">{percent(hit)}</dd>
              <dt>累计缓存命中</dt>
              <dd className="text-right">{percent(totalHit)}</dd>
              <dt>缓存统计覆盖</dt>
              <dd className="text-right">
                {cache?.covered_call_count ?? 0} / {cache?.call_count ?? 0} 次
              </dd>
              <dt>已覆盖请求缓存读取</dt>
              <dd className="text-right">{count(cache?.cache_read_tokens)}</dd>
              <dt>生成请求缓存写入</dt>
              <dd className="text-right">{count(cache?.cache_write_tokens)}</dd>
              <dt>会话累计输入 / 输出</dt>
              <dd className="text-right">
                {count(data?.input_tokens)} / {count(data?.output_tokens)}
              </dd>
            </dl>
            <p className="text-xs leading-5 text-muted">
              {context?.stale
                ? "上下文已压缩，等待下一次请求更新占用。"
                : "占用以最近一次已结束的对话请求为准，不包含未发送草稿。"}
            </p>
            {context?.observed_at && (
              <p className="text-xs text-muted">
                更新于 {new Date(context.observed_at).toLocaleString()}
              </p>
            )}
            <p className="text-xs leading-5 text-muted">
              缓存仅统计当前会话的对话生成请求，按输入 Token 加权；
              {cache && cache.covered_call_count < cache.call_count
                ? "部分请求未提供有效缓存计数。"
                : "未提供的值显示 —。"}
              会话累计用量包含标题与压缩调用。
            </p>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
