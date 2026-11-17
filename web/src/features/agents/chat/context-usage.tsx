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
  const occupancy = tokenPercent(
    context?.projected_tokens,
    context?.window_tokens,
    true,
  );
  const threshold = tokenPercent(
    context?.compaction_threshold_tokens,
    context?.window_tokens,
  );
  const hit = tokenPercent(context?.cache_read_tokens, context?.input_tokens);
  const totalHit = tokenPercent(cache?.cache_read_tokens, cache?.input_tokens);
  const pressureColor =
    occupancy !== null && threshold !== null && occupancy >= threshold
      ? "text-danger"
      : occupancy !== null && threshold !== null && occupancy >= threshold * 0.9
        ? "text-warning"
        : "text-primary";
  return (
    <Popover>
      <PopoverTrigger
        openOnHover
        delay={200}
        closeDelay={150}
        className="agent-context-trigger"
        aria-label={`上下文已用 ${percent(occupancy)}，缓存命中 ${percent(totalHit)}，查看会话统计`}
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
            className={pressureColor}
          />
        </svg>
        <span className="agent-context-value">{percent(occupancy)}</span>
        <span className="agent-context-cache">
          缓存命中 {percent(totalHit)}
        </span>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        className="w-80 max-w-[calc(100vw-2rem)] rounded-2xl space-y-3"
      >
        <h3 className="text-sm font-medium">会话统计</h3>
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
            <div className="space-y-2 text-xs tabular-nums">
              <div className="flex items-center justify-between gap-4">
                <span>上下文已用</span>
                <span>{percent(occupancy)}</span>
              </div>
              <div className="text-right text-muted">
                {context?.projected_tokens == null
                  ? "—"
                  : `~${count(context.projected_tokens)}`}{" "}
                / {count(context?.window_tokens)} tok
              </div>
              <div
                role="progressbar"
                aria-label="上下文已用"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={
                  occupancy === null ? undefined : Math.min(occupancy, 100)
                }
                aria-valuetext={
                  occupancy === null ? "尚无计量数据" : percent(occupancy)
                }
                className={`h-2 overflow-hidden rounded-full bg-current/15 ${pressureColor}`}
              >
                <div
                  className="h-full rounded-full bg-current transition-[width]"
                  style={{ width: `${Math.min(occupancy ?? 0, 100)}%` }}
                />
              </div>
            </div>
            <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-2 text-xs tabular-nums">
              <dt>会话轮数</dt>
              <dd className="text-right">{data?.run_count ?? "—"}</dd>
              <dt>已结束步骤</dt>
              <dd className="text-right">{data?.step_count ?? "—"}</dd>
              <dt>估算依据</dt>
              <dd className="text-right">
                {context?.measurement_source === "usage_adjusted"
                  ? "实际用量 + 内容增减估算"
                  : context?.measurement_source === "estimated"
                    ? "内容估算"
                    : "未提供"}
              </dd>
              <dt>自动压缩阈值</dt>
              <dd className="text-right">
                {percent(threshold)} /{" "}
                {count(context?.compaction_threshold_tokens)}
              </dd>
              <dt>最近请求输入</dt>
              <dd className="text-right">{count(context?.input_tokens)}</dd>
              <dt>输出预留</dt>
              <dd className="text-right">
                {context?.reserved_output_tokens === "0"
                  ? "未提供"
                  : count(context?.reserved_output_tokens)}
              </dd>
            </dl>
            <h4 className="text-xs font-medium">Token 用量</h4>
            <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-2 text-xs tabular-nums">
              <dt>缓存命中</dt>
              <dd className="text-right">{percent(totalHit)}</dd>
              <dt>最近请求缓存命中</dt>
              <dd className="text-right">{percent(hit)}</dd>
              <dt>缓存统计覆盖</dt>
              <dd className="text-right">
                {cache?.covered_call_count ?? 0} / {cache?.call_count ?? 0} 次
              </dd>
              <dt>缓存读取</dt>
              <dd className="text-right">{count(cache?.cache_read_tokens)}</dd>
              <dt>缓存写入</dt>
              <dd className="text-right">{count(cache?.cache_write_tokens)}</dd>
              <dt>会话累计输入（含缓存）</dt>
              <dd className="text-right">{count(data?.input_tokens)}</dd>
              <dt>会话累计输出</dt>
              <dd className="text-right">{count(data?.output_tokens)}</dd>
            </dl>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
