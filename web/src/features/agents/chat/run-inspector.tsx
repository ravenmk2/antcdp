import { Button } from "@/components/button";
import {
  AsyncBoundary,
  EmptyState,
  Notice,
  StatusBadge,
} from "@/components/feedback";
import { Drawer, OverlayCancelButton } from "@/components/overlays";
import { Pagination } from "@/components/pagination";
import { runStatusNames } from "@/features/agents/resources/admin-shared";
import { ModelCalls, SessionUsage } from "@/features/agents/resources/usage";
import { useApiQuery } from "@/hooks/use-api";
import type {
  ChildRunSummary,
  RunDetail,
  RunSummary,
  ToolCall,
} from "@/types/agents";
import { useEffect, useState } from "react";
import { agentRoot } from "../data/agent-api";
import { WorkspaceFilesDrawer } from "../sandbox/workspace-files";
import { runtimeReason } from "./timeline";

const toolStatuses: Record<ToolCall["status"], string> = {
  prepared: "已准备",
  waiting_approval: "等待批准",
  dispatching: "派发中",
  running: "运行中",
  succeeded: "成功",
  failed: "失败",
  blocked: "被阻止",
  cancelled: "已取消",
  outcome_unknown: "结果待核实",
};

export function RunInspector({
  sessionId,
  onChild,
  onClose,
  readonly = false,
}: {
  sessionId: string;
  onChild: (sessionId: string) => void;
  onClose: () => void;
  readonly?: boolean;
}) {
  const [page, setPage] = useState(1),
    [selected, setSelected] = useState<string | null>(null);
  const query = useApiQuery<RunSummary[]>(
    ["agent-session", sessionId, "runs", page],
    `${agentRoot}/sessions/${sessionId}/runs?page=${page}&page_size=20`,
  );
  return (
    <Drawer
      open
      wide
      title="运行记录"
      description="逻辑任务结果与实际环境活动分开记录。停止或中断后不会自动重放未知副作用。"
      onClose={onClose}
      footer={<OverlayCancelButton>关闭</OverlayCancelButton>}
    >
      <details className="mb-6 rounded-lg border p-4">
        <summary className="cursor-pointer text-sm font-medium">
          会话用量
        </summary>
        <div className="mt-5">
          <SessionUsage sessionId={sessionId} />
        </div>
      </details>
      <AsyncBoundary
        loading={query.isPending}
        error={query.error}
        onRetry={() => query.refetch()}
      >
        <div className="space-y-3">
          {query.data?.data.map((run) => (
            <div
              key={run.id}
              className="flex items-center justify-between gap-4 rounded-lg border p-4"
            >
              <div className="min-w-0 space-y-2">
                <div className="flex items-center gap-3">
                  <StatusBadge
                    tone={run.status === "succeeded" ? "success" : "neutral"}
                  >
                    {runStatusNames[run.status]}
                  </StatusBadge>
                  <span className="text-xs text-muted">运行 {run.id}</span>
                </div>
                <p className="text-xs text-muted">
                  {run.started_at
                    ? new Date(run.started_at).toLocaleString()
                    : "尚未开始"}{" "}
                  · {run.step_count} 步 · {run.tool_call_count} 次工具调用
                </p>
                {run.reason_code && (
                  <p className="text-xs text-muted">
                    {runtimeReason(run.reason_code)}
                  </p>
                )}
              </div>
              <Button variant="outline" onClick={() => setSelected(run.id)}>
                详情
              </Button>
            </div>
          ))}
          {query.data?.data.length === 0 && <EmptyState title="尚无运行记录" />}
        </div>
        <Pagination
          page={page}
          size={20}
          total={query.data?.pagination?.total}
          pending={query.isFetching}
          onChange={setPage}
        />
      </AsyncBoundary>
      {selected && (
        <RunDetailView
          sessionId={sessionId}
          id={selected}
          onClose={() => setSelected(null)}
          onChild={onChild}
          readonly={readonly}
        />
      )}
    </Drawer>
  );
}
function RunDetailView({
  sessionId,
  id,
  onClose,
  onChild,
  readonly,
}: {
  sessionId: string;
  id: string;
  onClose: () => void;
  onChild: (sessionId: string) => void;
  readonly: boolean;
}) {
  const [toolPage, setToolPage] = useState(1),
    [childPage, setChildPage] = useState(1),
    [files, setFiles] = useState(false);
  const run = useApiQuery<RunDetail>(
    ["agent-session", sessionId, "run", id],
    `${agentRoot}/runs/${id}`,
  );
  const tools = useApiQuery<ToolCall[]>(
    ["agent-session", sessionId, "run", id, "tools", toolPage],
    `${agentRoot}/runs/${id}/tool-calls?page=${toolPage}&page_size=20`,
  );
  const children = useApiQuery<ChildRunSummary[]>(
    ["agent-session", sessionId, "run", id, "children", childPage],
    `${agentRoot}/runs/${id}/children?page=${childPage}&page_size=20`,
  );
  const { refetch: readRun } = run,
    { refetch: readTools } = tools,
    { refetch: readChildren } = children;
  const active =
    run.data &&
    ![
      "succeeded",
      "waiting_input",
      "failed",
      "cancelled",
      "interrupted",
    ].includes(run.data.data.status);
  useEffect(() => {
    if (!active) return;
    let reading = false;
    const timer = setInterval(() => {
      if (reading || document.visibilityState !== "visible") return;
      reading = true;
      void Promise.allSettled([readRun(), readTools(), readChildren()]).finally(
        () => {
          reading = false;
        },
      );
    }, 3000);
    return () => clearInterval(timer);
  }, [active, readRun, readTools, readChildren]);
  return (
    <Drawer
      open
      wide
      title={`运行 ${id}`}
      onClose={onClose}
      footer={
        <>
          <Button
            variant="outline"
            pending={run.isFetching || tools.isFetching || children.isFetching}
            onClick={() => {
              void readRun();
              void readTools();
              void readChildren();
            }}
          >
            刷新记录
          </Button>
          <OverlayCancelButton>关闭</OverlayCancelButton>
        </>
      }
    >
      <AsyncBoundary
        loading={run.isPending}
        error={run.error}
        onRetry={() => run.refetch()}
      >
        {run.data && (
          <div className="space-y-6">
            <div className="flex gap-3">
              <StatusBadge>{runStatusNames[run.data.data.status]}</StatusBadge>
              <span className="text-xs text-muted">
                {runtimeReason(run.data.data.reason_code)}
              </span>
            </div>
            <dl className="grid grid-cols-3 gap-4 text-sm">
              {[
                [
                  "输入 Token 预算用量",
                  run.data.data.budget_usage.input_tokens_used,
                ],
                [
                  "输出 Token 预算用量",
                  run.data.data.budget_usage.output_tokens_used,
                ],
                ["子任务数量", run.data.data.budget_usage.children_started],
                ["模型调用", run.data.data.model_call_count],
                ["工具调用", run.data.data.tool_call_count],
                ["运行耗时（毫秒）", run.data.data.budget_usage.wall_time_ms],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt className="text-xs text-muted">{label}</dt>
                  <dd className="mt-1 font-medium tabular-nums">
                    {typeof value === "string"
                      ? BigInt(value).toLocaleString()
                      : value}
                  </dd>
                </div>
              ))}
            </dl>
            <p className="text-xs text-muted">
              预算用量包含子任务，与供应商账单用量并不相同。用量完整性：
              {
                { complete: "完整", partial: "部分提供", unknown: "未知" }[
                  run.data.data.usage_completeness
                ]
              }
              。
            </p>
            {run.data.data.physical_activity.state === "reconciling" && (
              <Notice tone="warning">
                仍有实际活动待核实。未知执行{" "}
                {run.data.data.physical_activity.unknown_execution_count}{" "}
                项；未结束传输{" "}
                {run.data.data.physical_activity.pending_transfer_count}{" "}
                项。不能用新任务绕过已有占用。
              </Notice>
            )}
            {run.data.data.binding && (
              <section className="rounded-lg border p-4 space-y-3">
                <h3 className="font-semibold text-sm">工作空间</h3>
                <p className="text-xs text-muted break-all">
                  空间 {run.data.data.binding.cloud_computer_id} · 当前目录{" "}
                  {run.data.data.binding.cwd}
                </p>
                <p className="text-xs text-muted">
                  云电脑会保留文件，不同会话或后续轮次可能继续修改。正式成果另存于平台。
                </p>
                <Button variant="outline" onClick={() => setFiles(true)}>
                  查看工作文件
                </Button>
              </section>
            )}
          </div>
        )}
      </AsyncBoundary>
      <section className="mt-8 space-y-4">
        <h3 className="font-semibold">临时子任务</h3>
        <AsyncBoundary
          loading={children.isPending}
          error={children.error}
          onRetry={() => children.refetch()}
        >
          {children.data?.data.map((child) => (
            <div key={child.id} className="rounded-lg border p-4">
              <div className="flex items-center justify-between">
                <StatusBadge>{runStatusNames[child.status]}</StatusBadge>
                <Button
                  variant="ghost"
                  onClick={() => onChild(child.session_id)}
                >
                  查看子任务过程
                </Button>
              </div>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-6">
                {child.result_summary || "暂无结果摘要"}
              </p>
            </div>
          ))}
          {children.data?.data.length === 0 && (
            <p className="text-sm text-muted">当前尚无临时子任务。</p>
          )}
          <Pagination
            page={childPage}
            size={20}
            total={children.data?.pagination?.total}
            pending={children.isFetching}
            onChange={setChildPage}
          />
        </AsyncBoundary>
      </section>
      <section className="mt-8 space-y-4">
        <h3 className="font-semibold">工具调用</h3>
        <AsyncBoundary
          loading={tools.isPending}
          error={tools.error}
          onRetry={() => tools.refetch()}
        >
          {tools.data?.data.map((tool) => (
            <details key={tool.id} className="rounded-lg border p-4">
              <summary className="cursor-pointer text-sm">
                {tool.tool_key}
                <span className="ml-3 text-xs text-muted">
                  步骤 {tool.step} · {toolStatuses[tool.status]}
                </span>
              </summary>
              <pre className="mt-3 max-h-72 overflow-auto rounded-lg bg-surface-subtle p-3 text-xs">
                {JSON.stringify(tool.arguments, null, 2)}
              </pre>
              <p className="mt-2 text-xs text-muted">
                {tool.executed === null
                  ? "是否执行尚未核实"
                  : tool.executed
                    ? "已派发执行"
                    : "尚未执行"}
                {tool.outcome.reason &&
                  ` · ${runtimeReason(tool.outcome.reason)}`}
              </p>
            </details>
          ))}
          {tools.data?.data.length === 0 && (
            <p className="text-sm text-muted">暂无工具调用。</p>
          )}
          <Pagination
            page={toolPage}
            size={20}
            total={tools.data?.pagination?.total}
            pending={tools.isFetching}
            onChange={setToolPage}
          />
        </AsyncBoundary>
      </section>
      <section className="mt-8 space-y-4">
        <h3 className="font-semibold">模型调用</h3>
        <ModelCalls
          sessionId={sessionId}
          path={`${agentRoot}/runs/${id}/model-calls`}
        />
      </section>
      {files && run.data?.data.binding && (
        <WorkspaceFilesDrawer
          computerId={run.data.data.binding.cloud_computer_id}
          readonly={readonly}
          onClose={() => setFiles(false)}
        />
      )}
    </Drawer>
  );
}
