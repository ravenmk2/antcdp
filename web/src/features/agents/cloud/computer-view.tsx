import { Link } from "react-router";
import { StatusBadge, ErrorNotice } from "@/components/feedback";
import { DescriptionList } from "@/components/layout";
import type { CloudComputer, CloudState } from "@/types/cloud-computer";
import { OccupancyView, sandboxReason } from "../sandbox/shared";

export const cloudStateNames: Record<CloudState, string> = {
  uninitialized: "等待首次使用",
  provisioning: "正在准备",
  ready: "可使用",
  paused: "已暂停",
  unavailable: "不可用",
  deleting: "正在删除",
  deleted: "已永久删除",
};
export function CloudStatus({ state }: { state: CloudState }) {
  return (
    <StatusBadge
      tone={
        state === "ready"
          ? "success"
          : state === "unavailable"
            ? "warning"
            : "neutral"
      }
    >
      {cloudStateNames[state]}
    </StatusBadge>
  );
}
export function ComputerFacts({
  computer,
  admin = false,
}: {
  computer: CloudComputer;
  admin?: boolean;
}) {
  const env = computer.effective_environment;
  return (
    <div className="space-y-5">
      <div className="flex items-center gap-4">
        <CloudStatus state={computer.state} />
        <span className="font-mono text-xs text-muted">
          云电脑 {computer.id}
        </span>
      </div>
      <OccupancyView value={computer} />
      <DescriptionList
        items={[
          ...(admin
            ? [
                {
                  label: "归属",
                  value: computer.pool_agent_id ? (
                    <Link
                      className="text-primary"
                      to={`/admin/agents/${computer.pool_agent_id}?tab=computer`}
                    >
                      服务型智能体 {computer.pool_agent_id}
                    </Link>
                  ) : (
                    `真人用户 ${computer.owner_user_id}`
                  ),
                },
              ]
            : []),
          { label: "实际镜像", value: env?.image || "尚未创建运行环境" },
          {
            label: "实际资源",
            value: env
              ? `${env.cpu_millicores / 1000} CPU · ${env.memory_mib} MiB`
              : "—",
          },
          { label: "专属数据卷", value: computer.volume_name || "按需创建" },
          ...(admin
            ? [
                {
                  label: "运行实例标识",
                  value: computer.runtime_id || "尚未创建",
                },
                {
                  label: "数据卷标识",
                  value: computer.volume_id || "尚未创建",
                },
              ]
            : []),
          {
            label: "数据卷状态",
            value:
              (
                {
                  uninitialized: "尚未创建",
                  ready: "可用",
                  absent: computer.volume_id ? "已缺失" : "尚未创建",
                  creating: "正在创建",
                  deleted: "已删除",
                  unknown: "待核实",
                  pending: "等待创建",
                } as Record<string, string>
              )[computer.volume_state] ?? computer.volume_state,
          },
          {
            label: "最后活动",
            value: new Date(computer.last_activity_at).toLocaleString(),
          },
        ]}
      />
      <ErrorNotice
        error={
          computer.error_code ? sandboxReason(computer.error_code) : undefined
        }
      />
    </div>
  );
}
