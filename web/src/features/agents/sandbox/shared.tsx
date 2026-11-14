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
export const sandboxReasons: Record<string, string> = {
  not_configured: "尚未配置沙箱服务连接",
  provider_disabled: "连接已停用",
  secret_unavailable: "连接认证不可用",
  capability_unavailable: "尚未通过所需能力验证",
  SANDBOX_UNAVAILABLE: "沙箱暂不可用，请核对连接与诊断结果",
  WORKSPACE_BUSY: "工作空间仍有活动任务或传输，请结束后重试",
  WORKSPACE_RECONCILING: "工作空间有尚未核实的执行，需先核实结果",
  FILE_STATE_CHANGED: "文件状态已变化，请刷新目录后重新选择",
  SANDBOX_ACTION_UNSUPPORTED: "该类型工作空间不支持此维护操作",
  NETWORK_POLICY_TOO_COMPLEX: "网络策略超出执行后端支持的复杂度，请精简范围",
  NETWORK_TARGET_UNSUPPORTED: "该网络目标不受当前后端支持",
  RESOURCE_IN_USE: "资源仍被引用，不能删除",
  SANDBOX_CONFIGURATION_INVALID: "沙箱配置无效",
  SANDBOX_PROVIDER_NOT_CONFIGURED: "尚未配置沙箱服务连接",
  SANDBOX_NOT_CONFIGURED: "尚未配置沙箱服务连接",
  SANDBOX_PROVIDER_UNAVAILABLE: "沙箱连接已停用或当前不可用",
  SANDBOX_CONFIG_INVALID: "沙箱配置无效，请重新检查连接设置",
  SANDBOX_CONFIG_CHANGED: "连接配置已变化，请刷新后重试",
  SANDBOX_PROVIDER_IN_USE: "已有实例或工作空间引用此连接，不能删除",
  SANDBOX_AUTHENTICATION_FAILED: "服务认证失败，请检查认证配置",
  CREDENTIAL_MISSING: "尚未配置所需认证",
  SANDBOX_NOT_READY: "实例尚未就绪",
  SANDBOX_UNHEALTHY: "实例健康检查未通过",
  SANDBOX_TERMINATED: "实例已回收",
  SANDBOX_CREATION_UNCONFIRMED: "实例创建结果尚未核实",
  SANDBOX_TERMINATION_UNCONFIRMED: "尚未核实实例已停止",
  SANDBOX_DUPLICATE_RESOURCES: "发现多个可能对应的远端实例，需要人工核实",
  SANDBOX_SEARCH_INCOMPLETE: "远端实例查询未完成，暂不能确认结果",
  SANDBOX_ENVIRONMENT_UNVERIFIED: "运行环境安全条件尚未验证",
  SANDBOX_CAPABILITY_UNVERIFIED: "所需沙箱能力尚未验证",
  SANDBOX_EXECUTION_UNVERIFIED: "命令执行能力尚未验证",
  SANDBOX_EXECUTION_UNCONFIRMED: "远端命令结果尚未核实",
  SANDBOX_OUTCOME_UNKNOWN: "远端操作结果待核实，请勿重复执行",
  SANDBOX_OPERATION_TIMEOUT: "沙箱服务请求超时，需根据结果核实状态",
  SANDBOX_OPERATION_CANCELLED: "沙箱服务请求已取消",
  SANDBOX_RATE_LIMITED: "沙箱服务暂时限流，请稍后重试",
  SANDBOX_REMOTE_NOT_FOUND: "未找到对应的远端实例",
  SANDBOX_REMOTE_REJECTED: "沙箱服务拒绝了本次请求",
  SANDBOX_PROBE_INTERRUPTED: "诊断已中断，需核实残留资源后重新测试",
  WORKSPACE_UNAVAILABLE: "工作空间当前不可用",
  WORKSPACE_RETIRED: "此工作空间已退出使用",
  WORKSPACE_HELPER_UNAVAILABLE: "可信文件辅助程序尚未配置或验证",
  WORKSPACE_IO_OUTCOME_UNKNOWN:
    "文件操作的实际结果待核实，请勿重复执行；工作空间占用继续保留",
  WORKSPACE_RESULT_UNAVAILABLE:
    "已确认操作停止，但无法恢复完整结果；文件可能已变化，请重新检查目录",
  WORKSPACE_OPERATION_INTERRUPTED:
    "操作已中断，未继续处理剩余文件；请根据已确认的结果重新检查目录",
  WORKSPACE_OPERATION_EXPIRED: "文件维护等待期限已到，未派发操作",
  remote_resource_unconfirmed: "远端资源状态尚未核实",
  termination_unconfirmed: "实例停止结果尚未核实",
  instance_termination_verified: "已核实实例停止；存储清理状态单独显示",
  dedicated_data_plane_verification_unconfigured:
    "尚未配置相应的数据面能力验证",
};
export function sandboxReason(reason: string | null | undefined) {
  return reason ? (sandboxReasons[reason] ?? `诊断标识：${reason}`) : "";
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
      request<Operation<CloudOperationResult>>(`${domain}/operations/${id}`, {
        signal,
      }),
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
