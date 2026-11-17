import { useState } from "react";
import { ChartNoAxesColumn } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { request } from "@/api/client";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { ModelCallMetadata, RunDetail } from "@/types/agents";
import { agentRoot } from "../data/agent-api";
import { tokenPercent } from "./context-usage";

const tokenFields = [
  "input_tokens",
  "output_tokens",
  "cache_read_tokens",
  "cache_write_tokens",
] as const;
type TokenField = (typeof tokenFields)[number];
export function summarizeTurnUsage(calls: ModelCallMetadata[]) {
  const totals = Object.fromEntries(
    tokenFields.map((field) => {
      const values = calls.flatMap((call) =>
        call.usage[field] == null ? [] : [BigInt(call.usage[field]!)],
      );
      return [
        field,
        values.length
          ? values.reduce((sum, value) => sum + value, 0n).toString()
          : null,
      ];
    }),
  ) as Record<TokenField, string | null>;
  const covered = calls.filter(
    (call) =>
      tokenPercent(call.usage.cache_read_tokens, call.usage.input_tokens) !==
      null,
  );
  const cacheInput = covered.reduce(
    (sum, call) => sum + BigInt(call.usage.input_tokens!),
    0n,
  );
  const cacheRead = covered.reduce(
    (sum, call) => sum + BigInt(call.usage.cache_read_tokens!),
    0n,
  );
  return {
    ...totals,
    count: calls.length,
    covered: covered.length,
    cacheHit: tokenPercent(cacheRead.toString(), cacheInput.toString()),
    partial: calls.some((call) => call.usage_completeness !== "complete"),
  };
}
const format = (value: string | null | undefined) =>
  value == null ? "—" : BigInt(value).toLocaleString();

export function TurnUsage({
  sessionId,
  runId,
}: {
  sessionId: string;
  runId: string;
}) {
  const [open, setOpen] = useState(false);
  const query = useQuery({
    queryKey: ["agent-session", sessionId, "workspace", "turn-usage", runId],
    enabled: open,
    staleTime: 30_000,
    queryFn: async ({ signal }) => {
      const calls = new Map<string, ModelCallMetadata>();
      for (let page = 1; ; page++) {
        const result = await request<ModelCallMetadata[]>(
          `${agentRoot}/runs/${runId}/model-calls?page=${page}&page_size=100`,
          { signal },
        );
        for (const call of result.data) calls.set(call.id, call);
        if (
          !result.data.length ||
          page * 100 >= (result.pagination?.total ?? result.data.length)
        )
          break;
      }
      const run = await request<RunDetail>(`${agentRoot}/runs/${runId}`, {
        signal,
      });
      return {
        ...summarizeTurnUsage([...calls.values()]),
        steps: run.data.step_count,
      };
    },
  });
  const usage = query.data;
  return (
    <span className="agent-turn-usage">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          className="agent-chat-icon-button"
          aria-label="本轮用量"
          openOnHover
          delay={200}
          closeDelay={150}
        >
          <ChartNoAxesColumn aria-hidden />
        </PopoverTrigger>
        <PopoverContent side="top" className="w-72 space-y-3">
          <h3 className="text-sm font-medium">本轮用量</h3>
          {query.isError ? (
            <button type="button" onClick={() => void query.refetch()}>
              读取失败，点击重试
            </button>
          ) : query.isPending ? (
            <p className="text-xs text-muted">正在读取…</p>
          ) : (
            usage && (
              <>
                <dl className="agent-turn-usage-details">
                  {[
                    ["已结束步骤", String(usage.steps)],
                    ["模型调用", `${usage.count} 次`],
                    ["输入（含缓存）", format(usage.input_tokens)],
                    ["输出", format(usage.output_tokens)],
                    ["缓存读取", format(usage.cache_read_tokens)],
                    ["缓存写入", format(usage.cache_write_tokens)],
                    [
                      "缓存命中",
                      usage.cacheHit == null ? "—" : `${usage.cacheHit}%`,
                    ],
                    ["缓存统计覆盖", `${usage.covered} / ${usage.count} 次`],
                  ].map(([label, value]) => (
                    <div key={label}>
                      <dt>{label}</dt>
                      <dd>{value}</dd>
                    </div>
                  ))}
                </dl>
              </>
            )
          )}
        </PopoverContent>
      </Popover>
    </span>
  );
}
