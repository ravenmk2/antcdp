import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, CircleHelp, CircleMinus } from "lucide-react";
import { request } from "@/api/client";
import { Button } from "@/components/button";
import {
  AsyncBoundary,
  ErrorNotice,
  Notice,
  StatusBadge,
} from "@/components/feedback";
import { Panel } from "@/components/layout";
import type { Operation } from "@/types/agents";
import type {
  CloudCapabilities,
  CloudOperationResult,
  CloudComputer,
} from "@/types/cloud-computer";
import type { AgentApiDomain } from "../data/agent-api";
import { operationNames } from "../resources/resource-actions";
import { diagnosticLines } from "../data/diagnostics";
import { sandboxReason } from "../data/sandbox-reasons";
export { sandboxReason, sandboxReasons } from "../data/sandbox-reasons";

export const sandboxKeys = ["cloud-computers"] as const;
const capabilityNames: Record<keyof CloudCapabilities, string> = {
  lifecycle: "运行环境管理",
  execution: "命令执行",
  execution_inspection: "执行状态查询",
  cancellation: "停止执行",
  file_transfer: "文件传输",
  persistent_workspace: "持久数据卷",
  network_enforcement: "网络限制",
  volume_deletion: "物理卷删除",
};
export function OccupancyView({
  value,
}: {
  value: Pick<
    CloudComputer,
    "active_leases" | "pending_transfers" | "unknown_executions"
  >;
}) {
  return (
    <div className="sandbox-occupancy">
      <span>活动轮次 {value.active_leases}</span>
      <span>传输 {value.pending_transfers}</span>
      <span
        className={value.unknown_executions ? "text-warning" : "text-muted"}
      >
        待核实执行 {value.unknown_executions}
      </span>
    </div>
  );
}
export function CapabilitiesView({ value }: { value: CloudCapabilities }) {
  return (
    <dl className="sandbox-capabilities">
      {Object.entries(capabilityNames).map(([key, label]) => (
        <div key={key}>
          <dt>{label}</dt>
          <dd data-support={value[key as keyof CloudCapabilities]}>
            {value[key as keyof CloudCapabilities] === "supported" ? (
              <CheckCircle2 aria-hidden />
            ) : value[key as keyof CloudCapabilities] === "unsupported" ? (
              <CircleMinus aria-hidden />
            ) : (
              <CircleHelp aria-hidden />
            )}
            {value[key as keyof CloudCapabilities] === "supported"
              ? "已验证支持"
              : value[key as keyof CloudCapabilities] === "unsupported"
                ? "不支持"
                : "尚未验证"}
          </dd>
        </div>
      ))}
    </dl>
  );
}
export function SandboxOperationView({
  id,
  domain,
  onSettled,
  onClose,
}: {
  id: string;
  domain: AgentApiDomain;
  onSettled?: (result: CloudOperationResult | null) => void;
  onClose?: () => void;
}) {
  const handled = useRef<string | null>(null);
  const callback = useRef(onSettled);
  useEffect(() => {
    callback.current = onSettled;
  }, [onSettled]);
  const query = useQuery({
    queryKey: ["sandbox", "operation", domain, id],
    queryFn: ({ signal }) =>
      request<Operation<CloudOperationResult>>(
        `${domain}/cloud-computers/operations/${id}`,
        {
          signal,
        },
      ),
    retry: false,
    refetchInterval: (query) =>
      ["queued", "running", "outcome_unknown"].includes(
        query.state.data?.data.status ?? "",
      )
        ? 2000
        : false,
  });
  const operation = query.data?.data;
  useEffect(() => {
    if (
      operation &&
      !["queued", "running"].includes(operation.status) &&
      handled.current !== `${id}:${operation.status}`
    ) {
      handled.current = `${id}:${operation.status}`;
      callback.current?.(
        operation.status === "succeeded" ? operation.result : null,
      );
    }
  }, [id, operation]);
  return (
    <Panel
      title="操作进度"
      action={
        <div className="flex gap-2">
          <Button variant="ghost" onClick={() => void query.refetch()}>
            刷新
          </Button>
          {onClose && (
            <Button variant="ghost" onClick={onClose}>
              收起
            </Button>
          )}
        </div>
      }
    >
      <AsyncBoundary
        loading={query.isPending}
        error={query.error}
        onRetry={() => query.refetch()}
      >
        {operation && (
          <div className="space-y-4">
            <StatusBadge
              tone={operation.status === "succeeded" ? "success" : "info"}
            >
              {operationNames[operation.status]}
            </StatusBadge>
            <p className="text-xs text-muted">
              操作 {operation.id} · 截止{" "}
              {new Date(operation.deadline_at).toLocaleString()}
            </p>
            {["queued", "running"].includes(operation.status) && (
              <Notice>
                操作已由服务端接纳，离开页面不会取消。请通过原操作查询进度。
              </Notice>
            )}
            {operation.outcome.certainty === "unknown" && (
              <Notice tone="warning">
                结果尚未核实，相关占用会继续保留。不会因超时重新派发操作或释放占用。
              </Notice>
            )}
            <ErrorNotice
              error={
                operation.error_code
                  ? sandboxReason(operation.error_code)
                  : undefined
              }
            />
            {diagnosticLines(operation.result?.diagnostic).map((line) => (
              <p key={line} className="text-xs text-muted break-all">
                {line}
              </p>
            ))}
            {Boolean(operation.result?.affected_paths?.length) && (
              <details open>
                <summary className="cursor-pointer text-sm">
                  已确认发生变化的路径
                </summary>
                <ul className="mt-3 max-h-48 space-y-1 overflow-auto rounded-lg border p-3 font-mono text-xs">
                  {operation.result!.affected_paths!.map((path, index) => (
                    <li key={`${index}:${path}`} className="break-all">
                      {path}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}
      </AsyncBoundary>
    </Panel>
  );
}
