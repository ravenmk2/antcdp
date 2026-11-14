import { isVersionConflict, request, type ApiResponse } from "@/api/client";
import { Button } from "@/components/button";
import {
  AsyncBoundary,
  EmptyState,
  ErrorNotice,
  Notice,
  StatusBadge,
} from "@/components/feedback";
import {
  ConfirmDialog,
  Drawer,
  OverlayCancelButton,
} from "@/components/overlays";
import { Pagination } from "@/components/pagination";
import {
  RowAction,
  RowActions,
  RowActionSeparator,
} from "@/components/row-actions";
import {
  runStatusNames,
  useResourceSave,
} from "@/features/agents/resources/admin-shared";
import { ResourceOperation } from "@/features/agents/resources/resource-actions";
import { useApiQuery } from "@/hooks/use-api";
import type { DurableRecord, HistoryPage } from "@/types/agent-events";
import type {
  Interaction,
  Operation,
  SessionConfiguration,
  SessionDetail,
  SessionPreference,
  ViewState,
} from "@/types/agents";
import { useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  ArrowDown,
  FolderOpen,
  History,
  ListOrdered,
  LockKeyhole,
  MessageCircleQuestion,
  Minimize2,
  PanelRight,
  Pin,
  RotateCcw,
  Settings,
  Square,
} from "lucide-react";
import type { ComponentType, ReactNode } from "react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link, Navigate } from "react-router";
import { agentRoot, versionEtag } from "../data/agent-api";
import {
  useAgentCommand,
  useCommandResult,
  useConversationDraft,
  useConversationStream,
} from "../data/agent-runtime";
import { visibleAttempt } from "../data/stream-reducer";
import { ChatComposer } from "./composer";
import { ContextUsage } from "./context-usage";
import { InteractionCard } from "./interactions";
import { QueuePanel } from "./queue-panel";
import { RunInspector } from "./run-inspector";
import { SessionFiles } from "./session-files";
import { SessionSettings } from "./session-settings";
import { SessionWorkspace } from "./session-workspace";
import { ConversationTimeline } from "./timeline";
import { useScrollFollow } from "./use-scroll-follow";

export function Conversation({
  Header,
  sessionId,
  service,
  expectedAgentId,
}: {
  Header: ComponentType<{ children: ReactNode }>;
  sessionId: string;
  service: boolean;
  expectedAgentId?: string;
}) {
  const cache = useQueryClient();
  const { state, observation, connection } = useConversationStream(sessionId);
  const revoked = state.reason === "access_revoked";
  const query = useApiQuery<SessionDetail>(
    ["agent-session", sessionId, "detail"],
    `${agentRoot}/sessions/${sessionId}`,
    { enabled: !revoked },
  );
  const { draft } = useConversationDraft(`session:${sessionId}`);
  const [panel, setPanel] = useState<
      "files" | "runs" | "settings" | "interactions" | null
    >(null),
    [child, setChild] = useState<string | null>(null),
    [confirm, setConfirm] = useState<"archive" | "compact" | null>(null),
    [operation, setOperation] = useState<string | null>(null),
    [historyPending, setHistoryPending] = useState(false),
    [historyError, setHistoryError] = useState<unknown>(),
    [viewError, setViewError] = useState<unknown>();
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [queueExpanded, setQueueExpanded] = useState<boolean | null>(null);
  const {
    scroll,
    content,
    following,
    scrollToBottom,
    pauseFollowing,
    prepareHistory,
    synchronize,
  } = useScrollFollow();
  const workspaceToggle = useRef<HTMLButtonElement>(null);
  const action = useAgentCommand<unknown>(`session:${sessionId}:control`);
  const configuration = useApiQuery<SessionConfiguration>(
    ["agent-session", sessionId, "configuration"],
    `${agentRoot}/sessions/${sessionId}/configuration`,
    { enabled: !revoked },
  );
  const viewed = useRef("0"),
    viewedCandidate = useRef("0"),
    viewing = useRef(false),
    pendingHistory = useRef(false);
  const detail = query.data?.data;
  const snapshot = state.snapshot;
  const config = snapshot?.configuration ?? detail?.configuration;
  const permissions = snapshot?.permissions ?? detail?.permissions;
  const activeRunId = snapshot ? snapshot.run_id : detail?.state.active_run_id;
  const activeStatus = snapshot
    ? snapshot.run_status
    : detail?.state.active_run_status;
  const queuePaused =
    snapshot?.queue_paused ?? detail?.state.queue_paused ?? false;
  const pendingInputs =
    snapshot?.input_total ?? detail?.state.pending_input_count ?? 0;
  const queueOpen = queueExpanded ?? pendingInputs > 0;
  const root = detail?.root_session_id === null;
  const archived = Boolean(config?.archived_at);
  const interactions = snapshot?.interactions ?? [];
  const waiting = interactions.filter((item) =>
    item.kind === "question"
      ? ["waiting", "continued"].includes(item.status)
      : item.status === "pending",
  );
  const refresh = () => {
    void cache.invalidateQueries({ queryKey: ["agent-session", sessionId] });
    void cache.invalidateQueries({ queryKey: ["agent-sessions"] });
    void cache.invalidateQueries({ queryKey: ["workspace-attention"] });
  };
  useCommandResult(action.state, (result) => {
    if (
      result &&
      typeof result === "object" &&
      "archived_at" in result &&
      action.state.response?.etag
    )
      cache.setQueryData(
        ["agent-session", sessionId, "configuration"],
        action.state.response,
      );
    if (
      result &&
      typeof result === "object" &&
      "kind" in result &&
      (result as Operation).kind === "session_compaction"
    )
      setOperation((result as Operation).id);
    setConfirm(null);
    action.command.reset();
    refresh();
  });
  const invalidatedThrough = useRef("0");
  const invalidation = useRef<{
    timer?: ReturnType<typeof setTimeout>;
    keys: Set<string>;
  }>({ keys: new Set() });
  useEffect(() => {
    const pending = invalidation.current;
    if (revoked) {
      clearTimeout(pending.timer);
      pending.timer = undefined;
      pending.keys.clear();
      cache.removeQueries({ queryKey: ["agent-session", sessionId] });
      return;
    }
    for (let i = state.records.length - 1; i >= 0; i--) {
      const record = state.records[i];
      if (BigInt(record.seq) <= BigInt(invalidatedThrough.current)) break;
      const type = record.event_type;
      if (
        type.startsWith("session/") ||
        type.startsWith("context/") ||
        type.startsWith("run/") ||
        type.startsWith("compaction/")
      )
        pending.keys.add("detail");
      if (type === "session/configured" || type === "session/title")
        pending.keys.add("configuration");
      if (type.startsWith("input/") || type === "queue/state")
        pending.keys.add("queue");
      if (
        type.startsWith("tool/") ||
        type.startsWith("assistant/") ||
        type.startsWith("compaction/") ||
        type.startsWith("artifact/") ||
        type.startsWith("run/") ||
        type === "session/computer_bound"
      )
        pending.keys.add("workspace");
    }
    invalidatedThrough.current = state.throughSeq;
    if (pending.keys.size && !pending.timer)
      pending.timer = setTimeout(() => {
        for (const key of pending.keys)
          void cache.invalidateQueries({
            queryKey: ["agent-session", sessionId, key],
          });
        pending.keys.clear();
        pending.timer = undefined;
      }, 200);
  }, [state.records, state.throughSeq, revoked, cache, sessionId]);
  useEffect(() => {
    const pending = invalidation.current;
    return () => {
      clearTimeout(pending.timer);
      pending.timer = undefined;
      pending.keys.clear();
    };
  }, [sessionId]);
  useEffect(() => {
    if (state.phase !== "live") return;
    const timer = setTimeout(() => {
      void cache.invalidateQueries({ queryKey: ["agent-sessions"] });
      void cache.invalidateQueries({ queryKey: ["workspace-attention"] });
      // A reconnect may install a snapshot without replaying terminal records.
      void cache.invalidateQueries({
        queryKey: ["agent-session", sessionId, "workspace", "usage"],
      });
    }, 200);
    return () => clearTimeout(timer);
  }, [
    cache,
    sessionId,
    state.phase,
    activeRunId,
    activeStatus,
    queuePaused,
    config?.title,
    waiting.length,
  ]);
  useLayoutEffect(synchronize, [
    state.records,
    state.activeAttempt,
    waiting.length,
    synchronize,
  ]);
  async function loadHistory(before = state.beforeSeq) {
    if (pendingHistory.current || !before || state.phase !== "live") return;
    pendingHistory.current = true;
    setHistoryPending(true);
    setHistoryError(undefined);
    const sub = state.subscriptionId,
      baseline = state.baselineGeneration;
    const params = new URLSearchParams({
      through_seq: state.throughSeq,
      before_seq: before,
      limit: "100",
    });
    try {
      const result = await request<HistoryPage>(
        `${agentRoot}/sessions/${sessionId}/history?${params}`,
      );
      const current = observation.getSnapshot();
      if (
        current.subscriptionId !== sub ||
        current.baselineGeneration !== baseline
      )
        return;
      prepareHistory();
      observation.mergeHistory(result.data, sub, baseline);
    } catch (error) {
      setHistoryError(error);
    } finally {
      pendingHistory.current = false;
      setHistoryPending(false);
    }
  }
  const missing = state.awaitingHistory[0];
  useEffect(() => {
    if (!missing || state.phase !== "live" || pendingHistory.current) return;
    const sub = state.subscriptionId,
      baseline = state.baselineGeneration;
    const controller = new AbortController();
    const params = new URLSearchParams({
      through_seq: state.throughSeq,
      before_seq: String(BigInt(missing.event_seq) + 1n),
      limit: "100",
    });
    void request<HistoryPage>(
      `${agentRoot}/sessions/${sessionId}/history?${params}`,
      { signal: controller.signal },
    )
      .then((result) => observation.mergeHistory(result.data, sub, baseline))
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setHistoryError(error);
      });
    return () => controller.abort();
  }, [
    missing,
    state.phase,
    state.subscriptionId,
    state.baselineGeneration,
    state.throughSeq,
    observation,
    sessionId,
  ]);
  function markViewed(
    record: Extract<DurableRecord, { event_type: "run/ended" }>,
  ) {
    if (
      !root ||
      revoked ||
      document.visibilityState !== "visible" ||
      !document.hasFocus()
    )
      return;
    const existing = detail?.view_state?.viewed_through_seq ?? "0";
    if (
      BigInt(record.seq) <= BigInt(existing) ||
      BigInt(record.seq) <= BigInt(viewed.current)
    )
      return;
    if (BigInt(record.seq) > BigInt(viewedCandidate.current))
      viewedCandidate.current = record.seq;
    void flushViewed();
  }
  async function flushViewed() {
    if (viewing.current || revoked) return;
    viewing.current = true;
    try {
      // Each candidate was actually visible in the foreground. Coalesce those
      // facts while a previous merge is pending; never infer reading from GET.
      while (BigInt(viewedCandidate.current) > BigInt(viewed.current)) {
        const result = await request<ViewState>(
          `${agentRoot}/sessions/${sessionId}/view-state`,
          {
            method: "PUT",
            body: { through_seq: viewedCandidate.current },
          },
        );
        viewed.current = result.data.viewed_through_seq;
        setViewError(undefined);
        cache.setQueryData<ApiResponse<SessionDetail>>(
          ["agent-session", sessionId, "detail"],
          (old) =>
            old
              ? { ...old, data: { ...old.data, view_state: result.data } }
              : old,
        );
        void cache.invalidateQueries({ queryKey: ["workspace-attention"] });
        void cache.invalidateQueries({ queryKey: ["agent-sessions"] });
      }
    } catch (error) {
      setViewError(error);
    } finally {
      viewing.current = false;
    }
  }
  function control(
    kind:
      | "stop"
      | "resume"
      | "archive"
      | "restore"
      | "compact"
      | "retry"
      | "title/refresh",
  ) {
    if (!config || !permissions || action.pending || action.uncertain) return;
    const latest = detail?.view_state?.latest_result;
    if (kind === "stop" && !activeRunId) return;
    if (kind === "retry" && !latest) return;
    const path =
      kind === "stop"
        ? `/runs/${activeRunId}/stop`
        : kind === "retry"
          ? `/runs/${latest!.run_id}/retry`
          : kind === "resume"
            ? `/sessions/${sessionId}/queue/resume`
            : `/sessions/${sessionId}/${kind}`;
    void action.command.run({
      domain: agentRoot,
      path,
      command:
        kind === "stop" || kind === "retry"
          ? `run.${kind}`
          : kind === "resume"
            ? "queue.resume"
            : kind === "title/refresh"
              ? "session.title.refresh"
              : `session.${kind}`,
      scope:
        kind === "stop"
          ? `run:${activeRunId}`
          : kind === "retry"
            ? `run:${latest!.run_id}`
            : `session:${sessionId}`,
      options: {
        method: "POST",
        body: kind === "retry" ? { expected_end_seq: latest!.end_seq } : {},
        ...(kind === "archive" || kind === "restore" || kind === "title/refresh"
          ? {
              etag:
                kind === "title/refresh"
                  ? versionEtag(config.version)
                  : configuration.data?.etag,
            }
          : {}),
      },
    });
  }
  const configurationRecovery = action.state.phase === "failed" &&
    isVersionConflict(action.state.error) && (
      <Notice tone="warning">
        会话配置已有变化。读取最新状态后，请重新确认操作。
        <Button
          className="mt-3"
          variant="outline"
          pending={configuration.isFetching}
          onClick={() => {
            void configuration.refetch().then((result) => {
              if (result.isSuccess) {
                action.command.reset();
                refresh();
              }
            });
          }}
        >
          读取最新会话配置
        </Button>
      </Notice>
    );
  if (revoked)
    return (
      <div className="page">
        <Notice tone="warning">
          当前会话的访问权限已撤销，已停止观察并清除内容。
        </Notice>
        <Button
          render={<Link to={service ? "/admin/agents" : "/home"}>返回</Link>}
          nativeButton={false}
          role="link"
          variant="outline"
          className="mt-4"
        />
      </div>
    );
  if (
    detail &&
    expectedAgentId &&
    detail.configuration.agent_id !== expectedAgentId
  )
    return <Notice tone="warning">此会话不属于当前智能体。</Notice>;
  if (detail && service !== (detail.configuration.agent_type === "service"))
    return (
      <Navigate
        replace
        to={
          detail.configuration.agent_type === "service"
            ? `/admin/agents/${detail.configuration.agent_id}/debug/${sessionId}`
            : `/agents/sessions/${sessionId}`
        }
      />
    );
  return (
    <>
      <AsyncBoundary
        loading={query.isPending}
        error={query.error}
        onRetry={() => query.refetch()}
      >
        {detail && config && permissions && (
          <>
            <Header>
              <div className="agent-chat-heading">
                <div className="agent-chat-title-line">
                  <h1 title={config.title}>{config.title}</h1>
                  {service && <StatusBadge tone="info">机器人执行</StatusBadge>}
                  {archived && <StatusBadge>已归档</StatusBadge>}
                </div>
                <div className="agent-chat-subline">
                  {activeStatus && (
                    <StatusBadge tone="info">
                      {runStatusNames[activeStatus]}
                    </StatusBadge>
                  )}
                </div>
              </div>
              <div className="agent-chat-header-actions">
                {root && <SessionPin sessionId={sessionId} />}
                <RowActions label="会话">
                  {root && (
                    <RowAction
                      icon={<ListOrdered />}
                      onSelect={() => setQueueExpanded(true)}
                    >
                      待处理输入 {pendingInputs}
                    </RowAction>
                  )}
                  <RowAction
                    icon={<FolderOpen />}
                    onSelect={() => setPanel("files")}
                  >
                    附件与成果
                  </RowAction>
                  <RowAction
                    icon={<History />}
                    onSelect={() => setPanel("runs")}
                  >
                    运行记录
                  </RowAction>
                  <RowAction
                    icon={<MessageCircleQuestion />}
                    onSelect={() => setPanel("interactions")}
                  >
                    问题与审批记录
                  </RowAction>
                  {root && permissions.manage && (
                    <>
                      <RowActionSeparator />
                      <RowAction
                        icon={<Settings />}
                        disabled={action.pending || action.uncertain}
                        onSelect={() => setPanel("settings")}
                      >
                        会话设置
                      </RowAction>
                      {!archived && (
                        <>
                          <RowAction
                            icon={<Settings />}
                            disabled={
                              action.pending ||
                              action.uncertain ||
                              state.throughSeq === "0"
                            }
                            onSelect={() => control("title/refresh")}
                          >
                            重新自动命名
                          </RowAction>
                          <RowAction
                            icon={<Minimize2 />}
                            disabled={
                              Boolean(activeRunId) ||
                              pendingInputs > 0 ||
                              action.pending ||
                              action.uncertain
                            }
                            onSelect={() => setConfirm("compact")}
                          >
                            压缩上下文
                          </RowAction>
                          <RowAction
                            icon={<Archive />}
                            disabled={
                              Boolean(activeRunId) ||
                              action.pending ||
                              action.uncertain ||
                              !configuration.data
                            }
                            onSelect={() => setConfirm("archive")}
                          >
                            归档会话
                          </RowAction>
                        </>
                      )}
                    </>
                  )}
                </RowActions>
                <Button
                  ref={workspaceToggle}
                  variant="ghost"
                  size="icon"
                  aria-label={
                    workspaceOpen ? "收起会话工作区" : "打开会话工作区"
                  }
                  title={workspaceOpen ? "收起会话工作区" : "打开会话工作区"}
                  aria-expanded={workspaceOpen}
                  aria-controls="session-workspace"
                  className={
                    workspaceOpen ? "agent-workspace-toggle-active" : ""
                  }
                  onClick={() => setWorkspaceOpen(!workspaceOpen)}
                >
                  <PanelRight />
                </Button>
              </div>
            </Header>
            <div
              className="agent-chat-body"
              data-workspace-open={workspaceOpen}
            >
              <main className="agent-chat-primary">
                <div
                  className="agent-chat-scroll"
                  ref={scroll}
                  onClickCapture={(event) => {
                    if (
                      !(event.target instanceof Element) ||
                      !event.target.closest(
                        "summary, .agent-turn-control, .agent-disclosure-trigger",
                      )
                    )
                      return;
                    pauseFollowing();
                  }}
                >
                  <div className="agent-chat-content space-y-5" ref={content}>
                    {connection !== "open" && (
                      <Notice tone="warning">
                        {connection === "closed"
                          ? "实时连接已关闭。可重新载入页面建立新的观察连接。"
                          : "实时连接正在恢复，已提交的任务继续在服务端执行。"}
                      </Notice>
                    )}
                    {state.phase === "resyncing" && (
                      <Notice>正在取得一致的会话快照…</Notice>
                    )}
                    {state.phase === "closed" && (
                      <Notice tone="warning">
                        暂时无法继续解析会话流，请刷新页面或联系管理员。诊断标识：
                        {state.reason}
                      </Notice>
                    )}
                    {state.hasMore && (
                      <div className="text-center">
                        <Button
                          variant="outline"
                          pending={historyPending}
                          onClick={() => void loadHistory()}
                        >
                          加载更早记录
                        </Button>
                      </div>
                    )}
                    <ErrorNotice error={historyError} />
                    <ErrorNotice error={viewError} />
                    {Boolean(viewError) && (
                      <Button
                        variant="outline"
                        onClick={() => void flushViewed()}
                      >
                        重试保存查看位置
                      </Button>
                    )}
                    {!state.records.length && state.phase === "live" && (
                      <EmptyState
                        title="开始这段对话"
                        description="描述任务，或添加需要一起分析的文件。"
                      />
                    )}
                    <ConversationTimeline
                      records={state.records}
                      sessionId={sessionId}
                      attempt={visibleAttempt(state)}
                      service={service}
                      onVisibleResult={root ? markViewed : undefined}
                    />
                    {operation && (
                      <ResourceOperation
                        domain={agentRoot}
                        id={operation}
                        title="上下文压缩"
                        onClose={() => setOperation(null)}
                      />
                    )}
                    {action.recovery}
                    {configurationRecovery}
                  </div>
                </div>
                <footer className="agent-chat-footer">
                  {!following && (
                    <div className="agent-jump-latest">
                      <Button
                        size="icon"
                        variant="outline"
                        aria-label="回到最新消息"
                        title="回到最新消息"
                        onClick={scrollToBottom}
                      >
                        <ArrowDown />
                      </Button>
                    </div>
                  )}
                  <div className="agent-chat-content agent-chat-dock">
                    {(archived || !root) && (
                      <ContextUsage sessionId={sessionId} />
                    )}
                    {!archived &&
                      (waiting.length > 0 ||
                        detail.state.pending_interaction_count > 0 ||
                        snapshot?.interactions_truncated) && (
                        <div className="agent-pending-interactions">
                          {(waiting.length > 1 ||
                            detail.state.pending_interaction_count > 1 ||
                            snapshot?.interactions_truncated) && (
                            <div className="agent-interaction-switcher">
                              <span>
                                待处理问题与审批 ·{" "}
                                {Math.max(
                                  waiting.length,
                                  detail.state.pending_interaction_count,
                                )}
                              </span>
                              <button
                                type="button"
                                onClick={() => setPanel("interactions")}
                              >
                                查看全部问题与审批
                              </button>
                            </div>
                          )}
                          {waiting.slice(0, 1).map((item) => (
                            <InteractionCard
                              key={item.id}
                              id={item.id}
                              sessionId={sessionId}
                              status={item.status}
                              canAnswer={permissions.answer}
                              canApprove={permissions.approve && !service}
                              archived={archived}
                              onChanged={refresh}
                            />
                          ))}
                        </div>
                      )}
                    <div className="agent-queue-panel">
                      {root &&
                        (queueOpen ||
                          pendingInputs > 0 ||
                          queuePaused ||
                          (!activeRunId &&
                            detail.view_state?.latest_result &&
                            ["failed", "cancelled", "interrupted"].includes(
                              detail.view_state.latest_result.status,
                            ))) && (
                          <div className="agent-chat-queuebar">
                            <div className="flex min-w-0 flex-wrap items-center gap-2">
                              <button
                                type="button"
                                className="agent-queue-toggle"
                                onClick={() => setQueueExpanded(!queueOpen)}
                                aria-expanded={queueOpen}
                                aria-controls="chat-pending-inputs"
                              >
                                <ListOrdered className="size-4" />
                                待处理输入{" "}
                                <span className="agent-queue-count">
                                  {pendingInputs}
                                </span>
                                {queuePaused && !archived ? " · 已暂停" : ""}
                              </button>
                              {permissions.control &&
                                queuePaused &&
                                !archived && (
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    disabled={
                                      action.pending || action.uncertain
                                    }
                                    onClick={() => control("resume")}
                                  >
                                    恢复队列
                                  </Button>
                                )}
                            </div>
                            {permissions.control &&
                              !activeRunId &&
                              !archived &&
                              detail.view_state?.latest_result &&
                              ["failed", "cancelled", "interrupted"].includes(
                                detail.view_state.latest_result.status,
                              ) && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  disabled={action.pending || action.uncertain}
                                  onClick={() => control("retry")}
                                >
                                  继续上次任务
                                </Button>
                              )}
                          </div>
                        )}
                      {root && queueOpen && (
                        <div id="chat-pending-inputs">
                          <QueuePanel
                            inline
                            sessionId={sessionId}
                            archived={archived}
                            canControl={permissions.control}
                            onChanged={refresh}
                            onClose={() => setQueueExpanded(false)}
                          />
                        </div>
                      )}
                    </div>
                    {archived ? (
                      <div className="agent-chat-readonly">
                        <div>
                          <strong>会话已归档</strong>
                          <p>
                            历史与文件保留。恢复后可以发送新消息，旧输入和问题不会重新执行。
                          </p>
                        </div>
                        {root && permissions.manage && (
                          <Button
                            variant="outline"
                            disabled={
                              action.pending ||
                              action.uncertain ||
                              !configuration.data
                            }
                            onClick={() => control("restore")}
                          >
                            <RotateCcw />
                            恢复会话
                          </Button>
                        )}
                      </div>
                    ) : !root ? (
                      <Notice>
                        临时子任务只读；输入、停止和需要人的交互由主会话处理。
                      </Notice>
                    ) : (
                      <ChatComposer
                        id={`session:${sessionId}`}
                        target={{
                          id: sessionId,
                          selection_hash: detail.selection.model_selection_hash,
                        }}
                        disabled={
                          !permissions.submit ||
                          !detail.selection.availability.available
                        }
                        queuePaused={queuePaused}
                        running={Boolean(activeRunId)}
                        onAccepted={refresh}
                        settings={
                          <>
                            <ContextUsage sessionId={sessionId} />
                            <button
                              type="button"
                              className="agent-composer-model"
                              disabled={!permissions.manage}
                              onClick={() => setPanel("settings")}
                              title={`${detail.selection.model_name} · ${detail.selection.thinking_label}${detail.selection.locked ? " · 模型已锁定" : ""}`}
                            >
                              <span className="truncate">
                                {detail.selection.model_name} ·{" "}
                                {detail.selection.thinking_label}
                              </span>
                              {detail.selection.locked && (
                                <LockKeyhole className="size-3" />
                              )}
                            </button>
                          </>
                        }
                        footerLeading={
                          detail.state.agent_access_available &&
                          detail.state.project_context_available ? undefined : (
                            <span role="status" className="text-xs text-muted">
                              {detail.state.agent_access_available
                                ? "项目当前不可用，请查看会话设置。"
                                : "当前已无此智能体的使用权限。"}
                            </span>
                          )
                        }
                        primaryAction={
                          permissions.control && activeRunId ? (
                            <button
                              type="button"
                              aria-busy={action.pending}
                              className="agent-send-button agent-stop-button"
                              aria-label="停止任务"
                              title="停止任务"
                              disabled={action.uncertain || action.pending}
                              onClick={() => control("stop")}
                            >
                              <Square className="size-3.5" />
                            </button>
                          ) : undefined
                        }
                      />
                    )}
                  </div>
                </footer>
              </main>
              {workspaceOpen && (
                <SessionWorkspace
                  session={{ ...detail, configuration: config }}
                  conversation={snapshot?.conversation}
                  records={state.records}
                  activeRunId={activeRunId}
                  activeStatus={activeStatus}
                  readonly={archived || !root || !permissions.manage}
                  onClose={() => {
                    setWorkspaceOpen(false);
                    workspaceToggle.current?.focus();
                  }}
                  onRuns={() => setPanel("runs")}
                  onFiles={() => setPanel("files")}
                />
              )}
            </div>
            {panel === "files" && (
              <SessionFiles
                sessionId={sessionId}
                readonly={archived || !root || !permissions.manage}
                canReference={permissions.submit && !archived && Boolean(root)}
                onReference={(ref) => {
                  const value = draft.getSnapshot();
                  if (
                    !value.file_refs.some(
                      (item) => item.kind === ref.kind && item.id === ref.id,
                    )
                  )
                    draft.patch({ file_refs: [...value.file_refs, ref] });
                }}
                onClose={() => setPanel(null)}
              />
            )}
            {panel === "runs" && (
              <RunInspector
                sessionId={sessionId}
                readonly={archived || !root || !permissions.manage}
                onClose={() => setPanel(null)}
                onChild={setChild}
              />
            )}
            {panel === "settings" && (
              <SessionSettings
                session={detail}
                onClose={() => setPanel(null)}
                onSaved={refresh}
              />
            )}
            {panel === "interactions" && (
              <InteractionList
                sessionId={sessionId}
                detail={detail}
                archived={archived}
                onClose={() => setPanel(null)}
                onChanged={refresh}
              />
            )}
            {child && (
              <ChildConversation
                sessionId={child}
                onClose={() => setChild(null)}
              />
            )}
            <ConfirmDialog
              open={confirm !== null}
              title={
                confirm === "archive" ? "归档这段会话？" : "压缩会话上下文？"
              }
              description={
                confirm === "archive"
                  ? "归档时会取消所有尚未领取的输入，关闭未回答和已排队回答的问题。历史与文件保留，恢复后这些待办不会复活。"
                  : "使用当前锁定模型生成摘要以减少后续上下文。原始对话历史仍可查看；需等当前任务和队列处理完。"
              }
              confirmLabel={confirm === "archive" ? "归档会话" : "开始压缩"}
              pending={action.pending || action.uncertain}
              onClose={() => setConfirm(null)}
              onConfirm={() => {
                if (confirm) control(confirm);
              }}
            >
              {action.recovery}
              {configurationRecovery}
            </ConfirmDialog>
          </>
        )}
      </AsyncBoundary>
    </>
  );
}
function SessionPin({ sessionId }: { sessionId: string }) {
  const query = useApiQuery<SessionPreference>(
    ["agent-session", sessionId, "preference"],
    `${agentRoot}/sessions/${sessionId}/preference`,
  );
  return query.data ? (
    <PinButton
      sessionId={sessionId}
      initial={query.data}
      onSaved={() => {
        void query.refetch();
      }}
    />
  ) : null;
}
function PinButton({
  sessionId,
  initial,
  onSaved,
}: {
  sessionId: string;
  initial: ApiResponse<SessionPreference>;
  onSaved: () => void;
}) {
  const [value, setValue] = useState(initial.data),
    cache = useQueryClient();
  const save = useResourceSave({
    initial,
    path: `${agentRoot}/sessions/${sessionId}/preference`,
    dirty: false,
    adopt: setValue,
    complete: () => {
      onSaved();
      void cache.invalidateQueries({ queryKey: ["agent-sessions"] });
    },
  });
  return (
    <div>
      {save.recovery}
      <Button
        variant="ghost"
        size="iconSm"
        aria-label={value.pinned ? "取消置顶会话" : "置顶会话"}
        title={value.pinned ? "取消置顶会话" : "置顶会话"}
        pending={save.pending}
        disabled={save.blocked}
        onClick={() => void save.save({ pinned: !value.pinned })}
      >
        <Pin
          className={`size-4 ${value.pinned ? "fill-primary text-primary" : ""}`}
        />
      </Button>
    </div>
  );
}
function InteractionList({
  sessionId,
  detail,
  archived,
  onClose,
  onChanged,
}: {
  sessionId: string;
  detail: SessionDetail;
  archived: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [page, setPage] = useState(1);
  const query = useApiQuery<Interaction[]>(
    ["agent-session", sessionId, "interactions", page],
    `${agentRoot}/sessions/${sessionId}/interactions?page=${page}&page_size=20`,
  );
  return (
    <Drawer
      open
      wide
      title="问题与审批记录"
      onClose={onClose}
      footer={<OverlayCancelButton>关闭</OverlayCancelButton>}
    >
      <AsyncBoundary
        loading={query.isPending}
        error={query.error}
        onRetry={() => query.refetch()}
      >
        <div className="space-y-4">
          {query.data?.data.map((item) => (
            <InteractionCard
              key={item.id}
              id={item.id}
              sessionId={sessionId}
              status={item.status}
              canAnswer={detail.permissions.answer}
              canApprove={detail.permissions.approve}
              archived={archived}
              onChanged={() => {
                void query.refetch();
                onChanged();
              }}
            />
          ))}
        </div>
        <Pagination
          page={page}
          size={20}
          total={query.data?.pagination?.total}
          pending={query.isFetching}
          onChange={setPage}
        />
      </AsyncBoundary>
    </Drawer>
  );
}
function ChildConversation({
  sessionId,
  onClose,
}: {
  sessionId: string;
  onClose: () => void;
}) {
  const { state, observation } = useConversationStream(sessionId);
  const cache = useQueryClient();
  useEffect(() => {
    if (state.reason === "access_revoked")
      cache.removeQueries({ queryKey: ["agent-session", sessionId] });
  }, [cache, sessionId, state.reason]);
  const [pending, setPending] = useState(false),
    [error, setError] = useState<unknown>();
  async function earlier() {
    if (pending || !state.beforeSeq) return;
    setPending(true);
    setError(undefined);
    const sub = state.subscriptionId,
      baseline = state.baselineGeneration;
    try {
      const params = new URLSearchParams({
        through_seq: state.throughSeq,
        before_seq: state.beforeSeq,
        limit: "100",
      });
      const result = await request<HistoryPage>(
        `${agentRoot}/sessions/${sessionId}/history?${params}`,
      );
      observation.mergeHistory(result.data, sub, baseline);
    } catch (failure) {
      setError(failure);
    } finally {
      setPending(false);
    }
  }
  return (
    <Drawer
      open
      wide
      title="临时子任务过程"
      description="继承主任务的身份、权限、模型和环境；停止主任务会传播给子任务。"
      onClose={onClose}
      footer={<OverlayCancelButton>关闭</OverlayCancelButton>}
    >
      {state.reason === "access_revoked" ? (
        <Notice tone="warning">当前内容不可访问。</Notice>
      ) : (
        <>
          <Notice>只读查看，所需人工回答和审批在主会话完成。</Notice>
          <ErrorNotice error={error} />
          {state.hasMore && (
            <Button
              className="mt-4"
              variant="outline"
              pending={pending}
              onClick={() => void earlier()}
            >
              加载更早记录
            </Button>
          )}
          <div className="mt-6">
            <ConversationTimeline
              sessionId={sessionId}
              records={state.records}
              attempt={visibleAttempt(state)}
            />
          </div>
        </>
      )}
    </Drawer>
  );
}
