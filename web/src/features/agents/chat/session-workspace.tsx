import { useState } from "react";
import { Tabs } from "@base-ui/react/tabs";
import {
  Activity,
  Check,
  Circle,
  FileText,
  FolderOpen,
  History,
  LockKeyhole,
  PanelRightClose,
  SlidersHorizontal,
} from "lucide-react";
import { Button, IconButton } from "@/components/button";
import { AsyncBoundary, Notice, StatusBadge } from "@/components/feedback";
import { useApiQuery } from "@/hooks/use-api";
import type { ConversationSummary, DurableRecord } from "@/types/agent-events";
import type {
  Artifact,
  RunDetail,
  RunStatus,
  SessionDetail,
  UsageTotals,
} from "@/types/agents";
import type { Resource } from "@/types/collaboration";
import { agentRoot } from "../data/agent-api";
import { runtimeReason } from "../data/runtime-reasons";
import { runStatusNames } from "@/features/agents/resources/admin-shared";
import { WorkspaceFilesDrawer } from "../sandbox/workspace-files";
import { FileReference } from "./content";
import { readPlan } from "./timeline";

type WorkspaceTab = "progress" | "files" | "context";

export function SessionWorkspace({
  session,
  records,
  conversation,
  activeRunId,
  activeStatus,
  readonly,
  onClose,
  onRuns,
  onFiles,
}: {
  session: SessionDetail;
  records: DurableRecord[];
  conversation?: ConversationSummary;
  activeRunId: string | null | undefined;
  activeStatus: RunStatus | null | undefined;
  readonly: boolean;
  onClose: () => void;
  onRuns: () => void;
  onFiles: () => void;
}) {
  const [tab, setTab] = useState<WorkspaceTab>("progress");
  const service = session.configuration.agent_type === "service";
  return (
    <aside
      className="agent-session-workspace"
      aria-label="会话工作区"
      id="session-workspace"
    >
      <div className="agent-workspace-heading">
        <h2>会话工作区</h2>
        <IconButton label="收起会话工作区" size="iconSm" onClick={onClose}>
          <PanelRightClose />
        </IconButton>
      </div>
      <Tabs.Root
        value={tab}
        onValueChange={(value) => setTab(value as WorkspaceTab)}
        className="agent-workspace-tabs"
      >
        <Tabs.List
          activateOnFocus
          className="agent-workspace-tablist"
          aria-label="会话工作区内容"
        >
          <Tabs.Tab value="progress">
            <Activity />
            进度
          </Tabs.Tab>
          <Tabs.Tab value="files">
            <FolderOpen />
            文件
          </Tabs.Tab>
          <Tabs.Tab value="context">
            <SlidersHorizontal />
            上下文
          </Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="progress" className="agent-workspace-content">
          <SessionProgress
            session={session}
            records={records}
            conversation={conversation}
            activeRunId={activeRunId}
            activeStatus={activeStatus}
            onRuns={onRuns}
          />
        </Tabs.Panel>
        <Tabs.Panel value="files" className="agent-workspace-content">
          <SessionFileSummary
            sessionId={session.configuration.id}
            onFiles={onFiles}
          />
        </Tabs.Panel>
        <Tabs.Panel value="context" className="agent-workspace-content">
          <SessionContext session={session} readonly={readonly} />
        </Tabs.Panel>
      </Tabs.Root>
      <div className="agent-workspace-privacy">
        <LockKeyhole />
        {service ? "机器人执行 · 管理员调试" : "个人会话 · 仅本人可见"}
      </div>
    </aside>
  );
}

function SessionProgress({
  session,
  records,
  conversation,
  activeRunId,
  activeStatus,
  onRuns,
}: {
  session: SessionDetail;
  records: DurableRecord[];
  conversation?: ConversationSummary;
  activeRunId: string | null | undefined;
  activeStatus: RunStatus | null | undefined;
  onRuns: () => void;
}) {
  const id = activeRunId ?? session.view_state?.latest_result?.run_id;
  const query = useApiQuery<RunDetail>(
    ["agent-session", session.configuration.id, "workspace", "run", id],
    `${agentRoot}/runs/${id}`,
    { enabled: Boolean(id) },
  );
  const run = query.data?.data;
  const status = activeRunId
    ? activeStatus
    : (run?.status ?? session.view_state?.latest_result?.status);
  const calls = new Set(
    records
      .filter(
        (record) =>
          record.run_id === id &&
          record.event_type === "tool/call" &&
          record.data.tool_key === "update_plan",
      )
      .map((record) =>
        record.event_type === "tool/call" ? record.data.tool_call_id : "",
      ),
  );
  const lastPlan = [...records]
    .reverse()
    .find(
      (record) =>
        record.run_id === id &&
        record.event_type === "tool/result" &&
        record.data.status === "succeeded" &&
        !record.data.truncated &&
        calls.has(record.data.tool_call_id),
    );
  const projected =
    conversation && conversation.latest_run?.id === id
      ? conversation.latest_run
      : null;
  const plan = projected?.plan
    ? readPlan(projected.plan)
    : lastPlan?.event_type === "tool/result"
      ? readPlan(lastPlan.data.content)
      : null;
  return (
    <div className="agent-workspace-sections">
      <section>
        <div className="agent-workspace-section-heading">
          <h3>{activeRunId ? "当前任务" : "最近任务"}</h3>
          <Button variant="ghost" size="sm" onClick={onRuns}>
            <History />
            运行记录
          </Button>
        </div>
        {!id ? (
          <p className="agent-workspace-empty">
            发送消息后，这里显示任务的实际进度。
          </p>
        ) : (
          <>
            {status && (
              <div className="agent-run-summary">
                <span
                  className={`agent-run-mark ${status === "succeeded" ? "is-complete" : ""}`}
                >
                  <Activity />
                </span>
                <div>
                  <strong>{runStatusNames[status]}</strong>
                  <p>运行 {id}</p>
                </div>
              </div>
            )}
            <AsyncBoundary
              loading={query.isPending}
              error={query.error}
              onRetry={() => query.refetch()}
            >
              {run?.id && (
                <>
                  <dl className="agent-workspace-facts">
                    <div>
                      <dt>执行步骤</dt>
                      <dd>{Math.max(projected?.step ?? 0, run.step_count)}</dd>
                    </div>
                    <div>
                      <dt>工具调用</dt>
                      <dd>
                        {Math.max(
                          projected?.tool_call_count ?? 0,
                          run.tool_call_count,
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt>模型调用</dt>
                      <dd>
                        {Math.max(
                          projected?.model_call_count ?? 0,
                          run.model_call_count,
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt>{run.finished_at ? "结束时间" : "开始时间"}</dt>
                      <dd>
                        {run.finished_at || run.started_at
                          ? new Date(
                              run.finished_at ?? run.started_at!,
                            ).toLocaleTimeString([], {
                              hour: "2-digit",
                              minute: "2-digit",
                            })
                          : "尚未开始"}
                      </dd>
                    </div>
                  </dl>
                  {run.reason_code && (
                    <p className="mt-3 text-sm leading-6 text-muted">
                      {runtimeReason(run.reason_code)}
                    </p>
                  )}
                  {run.physical_activity.state === "reconciling" && (
                    <Notice tone="warning">
                      实际执行仍待核实。未知执行{" "}
                      {run.physical_activity.unknown_execution_count} 项，传输{" "}
                      {run.physical_activity.pending_transfer_count} 项。
                    </Notice>
                  )}
                  {run.physical_activity.state === "active" && !activeRunId && (
                    <Notice>逻辑任务已结束，工作环境中仍有活动。</Notice>
                  )}
                </>
              )}
            </AsyncBoundary>
          </>
        )}
      </section>
      {plan && (
        <section>
          <h3 className="agent-workspace-section-title">任务计划</h3>
          <p className="mb-4 text-xs leading-5 text-muted">
            智能体最近提交的计划，不代表所有步骤均已执行。
          </p>
          <ol className="agent-workspace-plan">
            {plan.plan.map((step, index) => (
              <li key={index} data-state={step.status}>
                {step.status === "completed" ? <Check /> : <Circle />}
                <span>{step.step}</span>
                <span className="sr-only">
                  {step.status === "completed"
                    ? "已完成"
                    : step.status === "in_progress"
                      ? "进行中"
                      : "待开始"}
                </span>
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}

function SessionFileSummary({
  sessionId,
  onFiles,
}: {
  sessionId: string;
  onFiles: () => void;
}) {
  const query = useApiQuery<Artifact[]>(
    ["agent-session", sessionId, "workspace", "artifacts"],
    `${agentRoot}/sessions/${sessionId}/artifacts?page=1&page_size=5`,
  );
  return (
    <div className="agent-workspace-sections">
      <section>
        <div className="agent-workspace-section-heading">
          <h3>已保存成果</h3>
          {query.data?.pagination && (
            <span className="text-xs text-muted">
              {query.data.pagination.total} 项
            </span>
          )}
        </div>
        <p className="mb-4 text-xs leading-6 text-muted">
          已保存在平台，清理工作文件不影响这些成果。
        </p>
        <AsyncBoundary
          loading={query.isPending}
          error={query.error}
          onRetry={() => query.refetch()}
        >
          {query.data?.data.length === 0 && (
            <div className="agent-workspace-empty">
              <FileText />
              <p>暂无已保存成果</p>
              <small>工作目录中的文件需明确保存后才会出现在这里。</small>
            </div>
          )}
          <div className="agent-workspace-files">
            {query.data?.data.map((file) => (
              <div key={file.id}>
                <FileReference
                  reference={{ kind: "artifact", id: file.id }}
                  sessionId={sessionId}
                />
                <p>
                  {Number(file.size_bytes).toLocaleString()} 字节 ·{" "}
                  {new Date(file.created_at).toLocaleDateString()}
                </p>
                {file.description && (
                  <p className="line-clamp-2" title={file.description}>
                    {file.description}
                  </p>
                )}
              </div>
            ))}
          </div>
        </AsyncBoundary>
        <Button className="mt-5 w-full" variant="outline" onClick={onFiles}>
          <FolderOpen />
          全部附件与成果
        </Button>
      </section>
    </div>
  );
}

function SessionContext({
  session,
  readonly,
}: {
  session: SessionDetail;
  readonly: boolean;
}) {
  const [files, setFiles] = useState(false);
  const id = session.configuration.id,
    selection = session.selection,
    workspace = session.state.workspace;
  const projectId = session.configuration.project_context_id;
  const project = useApiQuery<Resource>(
    ["agent-session", id, "workspace", "project", projectId],
    `/projects/${projectId}`,
    { enabled: Boolean(projectId) },
  );
  const usage = useApiQuery<UsageTotals>(
    ["agent-session", id, "workspace", "usage"],
    `${agentRoot}/sessions/${id}/usage`,
  );
  const tokens = (value: string | null) =>
    value === null ? "未提供" : BigInt(value).toLocaleString();
  return (
    <div className="agent-workspace-sections">
      <section>
        <h3 className="agent-workspace-section-title">模型与思考</h3>
        <dl className="agent-workspace-facts">
          <div>
            <dt>模型</dt>
            <dd>{selection.model_name}</dd>
          </div>
          <div>
            <dt>提供商</dt>
            <dd>{selection.provider_label}</dd>
          </div>
          <div>
            <dt>思考配置</dt>
            <dd>{selection.thinking_label}</dd>
          </div>
        </dl>
        <p className="mt-4 flex items-start gap-2 text-xs leading-6 text-muted">
          <LockKeyhole className="mt-1 size-3.5 shrink-0" />
          {selection.locked
            ? "模型与思考已锁定，在这段会话中保持一致。"
            : "首次发送前可在会话设置中调整。"}
        </p>
      </section>
      <section>
        <h3 className="agent-workspace-section-title">项目上下文</h3>
        <p className="text-sm leading-6 break-words">
          {!projectId
            ? "未指定项目"
            : (project.data?.data.name ??
              (project.isError ? "项目当前不可读取" : "正在读取项目…"))}
        </p>
        <p className="mt-2 text-xs leading-6 text-muted">
          {session.state.project_context_available
            ? "项目资源按执行账号的权限校验；当前轮次使用启动时确定的授权范围。"
            : "项目当前不可用。请查看会话设置。"}
        </p>
      </section>
      <section>
        <h3 className="agent-workspace-section-title">工作环境</h3>
        <p className="text-sm leading-6">
          {
            {
              not_allocated: "尚未分配工作环境",
              available: "工作环境可用",
              recreated: "工作环境已重建",
              unavailable: "工作环境暂不可用",
              uninitialized: "云电脑已分配，首次使用时准备运行环境",
              provisioning: "正在准备工作环境",
              paused: "工作环境已暂停，使用时恢复",
              deleting: "云电脑正在删除",
              deleted: "云电脑已删除，此会话无法继续执行",
            }[workspace.availability]
          }
        </p>
        {workspace.cwd && (
          <code className="agent-workspace-path">{workspace.cwd}</code>
        )}
        {workspace.cloud_computer_id && (
          <Button
            className="mt-3"
            variant="outline"
            size="sm"
            onClick={() => setFiles(true)}
          >
            <FolderOpen />
            查看工作文件
          </Button>
        )}
      </section>
      <section>
        <h3 className="agent-workspace-section-title">本会话用量</h3>
        <AsyncBoundary
          loading={usage.isPending}
          error={usage.error}
          onRetry={() => usage.refetch()}
        >
          {usage.data && (
            <>
              <StatusBadge>
                {
                  {
                    complete: "数据完整",
                    partial: "部分数据",
                    unknown: "尚未提供",
                  }[usage.data.data.usage_completeness]
                }
              </StatusBadge>
              <dl className="agent-workspace-facts mt-4">
                {[
                  ["输入 Token", usage.data.data.input_tokens],
                  ["输出 Token", usage.data.data.output_tokens],
                  ["缓存读取", usage.data.data.cache_read_tokens],
                  ["缓存写入", usage.data.data.cache_write_tokens],
                ].map(([label, value]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>{tokens(value)}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-3 text-xs leading-6 text-muted">
                仅展示供应商实际返回的计数，缓存不重复计入输入。
              </p>
            </>
          )}
        </AsyncBoundary>
      </section>
      {files && workspace.cloud_computer_id && (
        <WorkspaceFilesDrawer
          computerId={workspace.cloud_computer_id}
          readonly={readonly}
          onClose={() => setFiles(false)}
        />
      )}
    </div>
  );
}
