import { useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { request } from "@/api/client";
import { Button } from "@/components/button";
import { AsyncBoundary, Notice } from "@/components/feedback";
import { StandaloneSelect, StandaloneInput } from "@/components/fields";
import { PageHeader, Panel } from "@/components/layout";
import { ConfirmDialog } from "@/components/overlays";
import { Pagination } from "@/components/pagination";
import { SimpleTable } from "@/components/table";
import { TableToolbar } from "@/components/table-toolbar";
import { useApiQuery } from "@/hooks/use-api";
import type { Operation } from "@/types/agents";
import type {
  CloudComputer,
  CloudAction,
  CloudOperationResult,
} from "@/types/cloud-computer";
import { agentAdminRoot, agentQuery } from "@/features/agents/data/agent-api";
import {
  useAgentCommand,
  useCommandResult,
} from "@/features/agents/data/agent-runtime";
import { useListParams } from "@/features/agents/resources/admin-shared";
import {
  CloudStatus,
  ComputerFacts,
  cloudStateNames,
} from "@/features/agents/cloud/computer-view";
import { CloudTemplateEditor } from "@/features/agents/cloud/template-editor";
import { ConnectionEditor } from "@/features/agents/cloud/connection-editor";
import { WorkspaceFiles } from "@/features/agents/sandbox/workspace-files";
import {
  CapabilitiesView,
  SandboxOperationView,
  sandboxKeys,
} from "@/features/agents/sandbox/shared";

export function CloudComputersPage() {
  const { params, page, size, change } = useListParams();
  const state = params.get("state") ?? "all",
    pool = params.get("pool_agent_id") ?? "",
    owner = params.get("owner_user_id") ?? "";
  const queryString = agentQuery({
    page,
    page_size: size,
    state,
    pool_agent_id: pool,
    owner_user_id: owner,
  });
  const query = useApiQuery<CloudComputer[]>(
    [...sandboxKeys, queryString],
    `${agentAdminRoot}/cloud-computers?${queryString}`,
  );
  return (
    <div className="page">
      <PageHeader
        title="云电脑"
        description="管理账号所属的长期运行环境和专属数据卷。首次使用时创建，空闲不会自动删除。"
        actions={
          <Button
            render={
              <Link to="/admin/cloud-computers/settings">
                连接与个人电脑配置
              </Link>
            }
            nativeButton={false}
            role="link"
            variant="outline"
          />
        }
      />
      <Panel>
        <TableToolbar
          onRefresh={() => query.refetch()}
          refreshing={query.isFetching}
          onReset={() =>
            change({
              state: "",
              pool_agent_id: "",
              owner_user_id: "",
              page: "1",
            })
          }
        >
          <StandaloneSelect
            aria-label="云电脑状态"
            value={state}
            onValueChange={(v) => change({ state: v, page: "1" })}
          >
            <option value="all">全部状态</option>
            {Object.entries(cloudStateNames).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </StandaloneSelect>
          <StandaloneInput
            aria-label="归属账号 ID"
            placeholder="归属账号 ID"
            value={owner}
            onChange={(e) =>
              change({
                owner_user_id: e.target.value.replace(/\D/g, ""),
                page: "1",
              })
            }
          />
          <StandaloneInput
            aria-label="服务型智能体 ID"
            placeholder="服务型智能体 ID"
            value={pool}
            onChange={(e) =>
              change({
                pool_agent_id: e.target.value.replace(/\D/g, ""),
                page: "1",
              })
            }
          />
        </TableToolbar>
        <AsyncBoundary
          loading={query.isPending}
          error={query.error}
          onRetry={() => query.refetch()}
          empty={query.data?.data.length === 0}
          emptyTitle="暂无匹配的云电脑"
          emptyDescription="个人电脑和服务型云电脑池成员均在需要时创建。"
        >
          <SimpleTable
            label="云电脑列表"
            headers={[
              "云电脑",
              "归属账号",
              "资源池",
              "状态",
              "活动轮次 / 待核实",
              "最近活动",
            ]}
          >
            {query.data?.data.map((v) => (
              <tr key={v.id}>
                <td>
                  <Link
                    className="font-medium text-primary"
                    to={`/admin/cloud-computers/${v.id}`}
                  >
                    {v.id}
                  </Link>
                </td>
                <td>{v.owner_user_id}</td>
                <td>
                  {v.pool_agent_id ? (
                    <Link
                      className="text-primary"
                      to={`/admin/agents/${v.pool_agent_id}?tab=computer`}
                    >
                      智能体 {v.pool_agent_id}
                    </Link>
                  ) : (
                    "个人电脑"
                  )}
                </td>
                <td>
                  <CloudStatus state={v.state} />
                </td>
                <td>
                  {v.active_leases} / {v.unknown_executions}
                </td>
                <td>{new Date(v.last_activity_at).toLocaleString()}</td>
              </tr>
            ))}
          </SimpleTable>
          <Pagination
            page={page}
            size={size}
            total={query.data?.pagination?.total}
            pending={query.isFetching}
            onChange={(next, count) =>
              change({ page: String(next), page_size: String(count) })
            }
          />
        </AsyncBoundary>
      </Panel>
    </div>
  );
}
export function CloudSettingsPage() {
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") === "personal" ? "personal" : "connection";
  return (
    <div className="page space-y-5">
      <PageHeader
        title="云电脑配置"
        description="平台维护一份服务连接，个人电脑与各服务型智能体分别配置运行环境。"
        actions={
          <Button
            render={<Link to="/admin/cloud-computers">返回云电脑</Link>}
            nativeButton={false}
            role="link"
            variant="outline"
          />
        }
      />
      <div className="flex gap-2">
        <Button
          variant={tab === "connection" ? "default" : "outline"}
          onClick={() => setParams({ tab: "connection" })}
        >
          服务连接
        </Button>
        <Button
          variant={tab === "personal" ? "default" : "outline"}
          onClick={() => setParams({ tab: "personal" })}
        >
          个人电脑配置
        </Button>
      </div>
      {tab === "connection" ? (
        <ConnectionEditor />
      ) : (
        <CloudTemplateEditor onSaved={() => {}} />
      )}
    </div>
  );
}
const actionNames: Record<CloudAction, string> = {
  create: "准备电脑",
  rebuild: "重建运行环境",
  pause: "暂停",
  resume: "恢复",
  delete: "永久删除",
};
export function CloudComputerDetailPage() {
  const { computerId = "" } = useParams();
  const [maintenance, setMaintenance] = useState<CloudAction | null>(null),
    [operation, setOperation] = useState<string | null>(null),
    [files, setFiles] = useState(false);
  const query = useQuery({
    queryKey: [...sandboxKeys, "admin", computerId],
    queryFn: ({ signal }) =>
      request<CloudComputer>(
        `${agentAdminRoot}/cloud-computers/${computerId}`,
        { signal },
      ),
    retry: false,
    refetchInterval: (q) =>
      ["provisioning", "deleting"].includes(q.state.data?.data.state ?? "") ||
      (q.state.data?.data.unknown_executions ?? 0) > 0
        ? 3000
        : false,
  });
  const action = useAgentCommand<Operation<CloudOperationResult>>(
    `cloud-computer:${computerId}:maintenance`,
  );
  useCommandResult(action.state, (v) => {
    setOperation(v.id);
    setMaintenance(null);
    action.command.reset();
    void query.refetch();
  });
  const v = query.data?.data;
  const busy = Boolean(
    v &&
    (v.active_leases ||
      v.pending_transfers ||
      v.unknown_executions ||
      v.state === "provisioning" ||
      v.state === "deleting"),
  );
  const actions: CloudAction[] =
    !v || v.state === "deleted"
      ? []
      : [
          ...(v.state === "ready" ? ["pause" as const] : []),
          ...(v.state === "paused" ? ["resume" as const] : []),
          ...(v.state === "uninitialized"
            ? ["create" as const]
            : ["rebuild" as const]),
          "delete",
        ];
  return (
    <div className="page space-y-5">
      <PageHeader
        title="云电脑详情"
        description={computerId}
        actions={
          <Button
            render={<Link to="/admin/cloud-computers">返回列表</Link>}
            nativeButton={false}
            role="link"
            variant="outline"
          />
        }
      />
      <AsyncBoundary
        loading={query.isPending}
        error={query.error}
        onRetry={() => query.refetch()}
      >
        {v && (
          <>
            <Panel bodyClassName="p-6">
              <ComputerFacts computer={v} admin />
              <div className="mt-5 flex flex-wrap gap-3">
                <Button
                  variant="outline"
                  pending={query.isFetching}
                  onClick={() => void query.refetch()}
                >
                  刷新状态
                </Button>
                {actions.map((kind) => (
                  <Button
                    key={kind}
                    variant={kind === "delete" ? "danger" : "outline"}
                    disabled={
                      busy ||
                      action.pending ||
                      action.uncertain ||
                      (kind === "delete" &&
                        Boolean(v.volume_id) &&
                        v.capabilities.volume_deletion === "unsupported")
                    }
                    onClick={() => setMaintenance(kind)}
                  >
                    {actionNames[kind]}
                  </Button>
                ))}
                {v.pool_agent_id && v.state === "ready" && (
                  <Button variant="outline" onClick={() => setFiles(!files)}>
                    {files ? "收起文件" : "打开机器人文件"}
                  </Button>
                )}
              </div>
              {busy && (
                <p className="mt-4 text-sm text-muted">
                  在途活动或结果核实完成后才可维护。结束一轮对话不一定代表后台活动已经停止。
                </p>
              )}
              {v.capabilities.volume_deletion === "unsupported" &&
                v.volume_name && (
                  <Notice tone="warning">
                    当前后端不支持独立删除数据卷，无法永久删除这台云电脑。运行环境和数据卷会继续保留。
                  </Notice>
                )}
              {!v.pool_agent_id && (
                <p className="mt-4 text-sm text-muted">
                  个人电脑的文件仅归属用户可访问；此页面只提供维护。
                </p>
              )}
            </Panel>
            <details className="panel p-5">
              <summary className="cursor-pointer font-medium">
                实际能力与配置
              </summary>
              <div className="mt-5 space-y-4">
                <CapabilitiesView value={v.capabilities} />
                <pre className="overflow-auto whitespace-pre-wrap rounded-lg border p-4 text-xs">
                  {JSON.stringify(v.effective_environment, null, 2)}
                </pre>
                <p className="text-xs text-muted">
                  后端代次 {v.backend_generation} · 运行环境代次{" "}
                  {v.runtime_generation} · 数据卷代次 {v.storage_generation}
                </p>
              </div>
            </details>
            {files && v.pool_agent_id && (
              <Panel bodyClassName="p-5">
                <WorkspaceFiles computerId={v.id} />
              </Panel>
            )}
            {(operation || v.latest_operation_id) && (
              <SandboxOperationView
                id={(operation || v.latest_operation_id)!}
                domain={agentAdminRoot}
                onSettled={() => void query.refetch()}
              />
            )}
            {action.recovery}
            {maintenance && (
              <ConfirmDialog
                open
                danger={maintenance === "delete"}
                title={`${actionNames[maintenance]}？`}
                description={
                  maintenance === "delete"
                    ? "删除当前运行环境及专属数据卷，绑定到此电脑的会话将无法继续。只有核实实际资源均已删除后才标记完成。"
                    : maintenance === "rebuild"
                      ? "采用当前创建配置重建运行环境，保留原数据卷、电脑身份和会话绑定。原数据卷缺失时会失败，不创建空卷替代。"
                      : maintenance === "pause"
                        ? "暂停运行环境，保留数据卷。后续使用时可恢复。"
                        : "按保存的配置准备运行环境。"
                }
                pending={action.pending || action.uncertain}
                confirmLabel={actionNames[maintenance]}
                onClose={() => setMaintenance(null)}
                onConfirm={() =>
                  void action.command.run({
                    domain: agentAdminRoot,
                    path: `/cloud-computers/${computerId}/operations`,
                    command: `cloud_computer.${maintenance}`,
                    scope: `cloud_computer:${computerId}`,
                    options: {
                      method: "POST",
                      etag: query.data!.etag,
                      body: {
                        action: maintenance,
                        confirm_delete: maintenance === "delete",
                      },
                    },
                  })
                }
              >
                {action.recovery}
              </ConfirmDialog>
            )}
          </>
        )}
      </AsyncBoundary>
    </div>
  );
}
