import { MessageAttachments } from "./attachment-tiles";
import { Fragment, memo, useEffect, useMemo, useRef, useState } from "react";
import { Atom, Bot } from "lucide-react";
import { useSession } from "@/app/auth";
import { ChatCopyButton as CopyButton } from "./controls";
import type { ActiveAttempt, DurableRecord } from "@/types/agent-events";
import type { FileRef } from "@/types/agents";
import type {
  AcceptedSubmission,
  MessageWorkspaceFile,
} from "../data/send-flow";
import { runStatusNames } from "@/features/agents/resources/admin-shared";
import {
  ConversationProjector,
  conversationTurns,
  type ConversationTurn,
} from "../data/conversation-projection";
import {
  ConversationPresenter,
  type PresentedNode,
  type PresentedProcess,
} from "../data/conversation-presentation";
import { diagnosticReason, diagnosticLines } from "../data/diagnostics";
import { turnIssues } from "../data/turn-issues";
import { TurnIssues } from "./turn-issues";
import { MessageContent } from "./content";
import { ToolEvent, builtinToolNames } from "./tool-event";
import { toolIconActive, toolSummary } from "../data/tool-summary";
import { ChatDisclosure } from "./disclosure";
import {
  DisclosureScope,
  DisclosureState,
  useDisclosureState,
} from "./disclosure-state";
import { ActivityIcon } from "./activity-icon";
import { questionReplyText } from "./question-content";
import { TurnUsage } from "./turn-usage";
import { ArtifactCards } from "./artifact-cards";
import { turnDeliverables } from "../data/turn-deliverables";
import {
  DisclosureContent,
  DisclosureChevron,
  useDisclosureMotion,
} from "./disclosure-motion";

export { runtimeReason } from "../data/runtime-reasons";
export { readPlan } from "./tool-event";
export function ConversationTimeline(props: ConversationTimelineProps) {
  return (
    <DisclosureState key={props.sessionId}>
      <Timeline {...props} />
    </DisclosureState>
  );
}
type ConversationTimelineProps = {
  records: DurableRecord[];
  sessionId: string;
  attempt: ActiveAttempt | null;
  service?: boolean;
  pauseAutoCollapse?: boolean;
  computerId?: string | null;
  submissions?: readonly AcceptedSubmission[];
  onVisibleResult?: (
    record: Extract<DurableRecord, { event_type: "run/ended" }>,
  ) => void;
};
function Timeline({
  records,
  sessionId,
  attempt,
  service = false,
  pauseAutoCollapse = false,
  onVisibleResult,
  computerId,
  submissions = [],
}: ConversationTimelineProps) {
  const { user } = useSession();
  const projector = useMemo(() => new ConversationProjector(), []);
  const presenter = useMemo(() => new ConversationPresenter(), []);
  const nodes = useMemo(
    () => presenter.project(projector.project(records), attempt),
    [presenter, projector, records, attempt],
  );
  const turns = useMemo(
    () => conversationTurns(records, nodes),
    [records, nodes],
  );
  const issues = useMemo(() => turnIssues(records, nodes), [records, nodes]);
  const [diagnostic, setDiagnostic] = useState<{
    runId: string;
    issueId?: string;
  } | null>(null);
  const artifacts = useMemo(() => turnDeliverables(records), [records]);
  const closingReplies = useMemo(() => {
    const lastReplies = new Map<
      string,
      Extract<DurableRecord, { event_type: "assistant/message" }>
    >();
    const final = new Map<
      string,
      Extract<DurableRecord, { event_type: "assistant/message" }>
    >();
    for (const record of records) {
      if (!record.run_id) continue;
      if (
        record.event_type === "assistant/message" &&
        record.data.content.some(
          (block) =>
            block.type === "file_reference" ||
            (block.type === "text" && block.text.trim()),
        )
      )
        lastReplies.set(record.run_id, record);
      if (
        record.event_type === "run/ended" &&
        record.data.status === "succeeded"
      ) {
        const reply = lastReplies.get(record.run_id);
        if (reply) final.set(record.run_id, reply);
      }
    }
    return final;
  }, [records]);
  const finalReplies = useMemo(
    () => new Set([...closingReplies.values()].map((record) => record.seq)),
    [closingReplies],
  );
  const questions = useMemo(
    () =>
      new Map(
        records.flatMap((record) =>
          record.event_type === "interaction/asked" &&
          record.data.interaction.kind === "question"
            ? [
                [
                  record.data.interaction.id,
                  record.data.interaction.questions,
                ] as const,
              ]
            : [],
        ),
      ),
    [records],
  );
  const disclosure = useDisclosureState();
  const motion = useDisclosureMotion();
  const [turnRevisions, setTurnRevisions] = useState(new Map<string, number>());
  const latestReply = [...records]
    .reverse()
    .find(
      (record) =>
        record.event_type === "assistant/message" ||
        record.event_type === "assistant/attempt",
    )?.seq;
  const latestInput = [...records]
    .reverse()
    .find((record) => record.event_type === "input/message")?.seq;
  const questionSources = useMemo(
    () =>
      new Map(
        records.flatMap((record) =>
          record.event_type === "interaction/decided" &&
          record.data.pending_reply_input_id
            ? [
                [
                  record.data.pending_reply_input_id,
                  record.data.interaction_id,
                ] as const,
              ]
            : [],
        ),
      ),
    [records],
  );
  const foldableTurns = useMemo(() => {
    const result = new Set<string>();
    for (const node of nodes) {
      if (node.kind === "process" && node.runId) result.add(node.runId);
      if (
        node.kind === "record" &&
        node.record.run_id &&
        ["assistant/message", "assistant/attempt"].includes(
          node.record.event_type,
        ) &&
        (node.record.event_type !== "assistant/attempt" ||
          node.record.data.content.some(
            (block) =>
              block.type === "file_reference" ||
              ((block.type === "text" || block.type === "reasoning") &&
                block.text.trim()),
          )) &&
        !finalReplies.has(node.record.seq)
      )
        result.add(node.record.run_id);
    }
    return result;
  }, [nodes, finalReplies]);
  const endedTurns = [...turns.values()]
    .filter((turn) => turn.end)
    .map((turn) => turn.id);
  const [collapsedTurns, setCollapsedTurns] = useState(
    () => new Set(endedTurns),
  );
  if (!pauseAutoCollapse && endedTurns.some((id) => !collapsedTurns.has(id)))
    setCollapsedTurns(new Set([...collapsedTurns, ...endedTurns]));
  const turnExpanded = (turn?: ConversationTurn) =>
    !turn?.foldable ||
    !foldableTurns.has(turn.id) ||
    disclosure.expanded(
      turn.id,
      pauseAutoCollapse && !collapsedTurns.has(turn.id),
    );
  const turnHeader = (turn?: ConversationTurn) => {
    if (!turn) return null;
    const foldable = turn.foldable && foldableTurns.has(turn.id);
    const expanded = turnExpanded(turn);
    const revision = turn ? (turnRevisions.get(turn.id) ?? 0) : 0;
    const duration =
      turn?.startedAt && turn.end
        ? Math.max(
            1,
            Math.round(
              (Date.parse(turn.end.data.finished_at) -
                Date.parse(turn.startedAt)) /
                1000,
            ),
          )
        : null;
    return (
      <div
        className="agent-turn-heading"
        data-message-anchor={`turn:${turn.id}`}
      >
        {!turn.end && <WorkingTime startedAt={turn.startedAt} />}
        {turn.end && (
          <button
            type="button"
            className="agent-turn-control"
            disabled={!foldable}
            aria-expanded={foldable ? expanded : undefined}
            aria-label={`${runStatusNames[turn.end.data.status]} · 执行过程`}
            onClick={(event) =>
              motion.toggle(event, () => {
                setTurnRevisions((previous) =>
                  new Map(previous).set(
                    turn.id,
                    (previous.get(turn.id) ?? 0) + 1,
                  ),
                );
                disclosure.change(turn.id, !expanded);
              })
            }
          >
            <Bot aria-hidden="true" className="agent-turn-bot" />
            <span>
              {turn.end.data.status === "succeeded"
                ? "已工作"
                : runStatusNames[turn.end.data.status]}
              {duration !== null &&
                ` · 用时 ${duration >= 60 ? `${Math.floor(duration / 60)} 分 ` : ""}${duration % 60} 秒`}
            </span>
            {foldable && (
              <DisclosureChevron open={expanded} revision={revision} />
            )}
          </button>
        )}
        {Boolean(issues.get(turn.id)?.length) && (
          <div className="agent-turn-issues" data-foldable={foldable}>
            <TurnIssues
              issues={issues.get(turn.id)!}
              open={diagnostic?.runId === turn.id}
              selected={
                diagnostic?.runId === turn.id ? diagnostic.issueId : undefined
              }
              onOpenChange={(open) =>
                setDiagnostic(open ? { runId: turn.id } : null)
              }
            />
          </div>
        )}
      </div>
    );
  };
  const items: (
    PresentedNode | { kind: "submission"; submission: AcceptedSubmission }
  )[] = [...nodes];
  for (const submission of submissions)
    items.push({ kind: "submission", submission });
  return (
    <div className="agent-timeline">
      {items.map((node, index) => {
        if (node.kind === "submission") {
          const item = node.submission;
          return (
            <UserBubble
              key={`input:${item.inputId}`}
              inputId={item.inputId}
              text={item.text}
              fileRefs={item.fileRefs}
              workspaceFiles={item.workspaceFiles}
              computerId={computerId}
              sessionId={sessionId}
              time={item.time}
              latest
            />
          );
        }
        if (node.kind === "process") {
          const turn = node.runId ? turns.get(node.runId) : undefined;
          const expanded = turnExpanded(turn);
          const revision = turn ? (turnRevisions.get(turn.id) ?? 0) : 0;
          const next = nodes[index + 1];
          // An empty next-attempt placeholder is only a model/tool handoff.
          const closed = Boolean(next && next.kind !== "draft");
          return (
            <Fragment key={node.id}>
              {turn?.firstNode === node.id && turnHeader(turn)}
              <DisclosureContent open={expanded} revision={revision}>
                <div className="agent-process-slot">
                  <DisclosureScope id={node.runId ?? node.id}>
                    <ProcessGroup
                      node={node}
                      sessionId={sessionId}
                      historical={Boolean(turn?.end)}
                      pauseAutoCollapse={pauseAutoCollapse}
                      closed={closed}
                      issueToolIds={(
                        issues.get(node.runId ?? "") ?? []
                      ).flatMap((issue) =>
                        issue.toolId ? [issue.toolId] : [],
                      )}
                      onIssue={(toolId) => {
                        if (turn)
                          setDiagnostic({
                            runId: turn.id,
                            issueId: `tool:${toolId}`,
                          });
                      }}
                    />
                  </DisclosureScope>
                </div>
              </DisclosureContent>
            </Fragment>
          );
        }
        if (
          node.kind === "draft" ||
          (node.kind === "record" &&
            (node.record.event_type === "assistant/message" ||
              node.record.event_type === "assistant/attempt"))
        ) {
          const record = node.kind === "record" ? node.record : undefined;
          const draft = node.kind === "draft" ? node.attempt : undefined;
          const runId = draft?.run_id ?? record?.run_id;
          const turn = runId ? turns.get(runId) : undefined;
          const final = Boolean(record && finalReplies.has(record.seq));
          const expanded = final || turnExpanded(turn);
          const revision = turn ? (turnRevisions.get(turn.id) ?? 0) : 0;
          return (
            <Fragment key={node.id}>
              {(!turn?.firstNode || turn.firstNode === node.id) &&
                turnHeader(turn)}
              <DisclosureContent open={expanded} revision={revision}>
                <AssistantMessage
                  record={
                    record as
                      | Extract<
                          DurableRecord,
                          {
                            event_type:
                              "assistant/message" | "assistant/attempt";
                          }
                        >
                      | undefined
                  }
                  attempt={draft}
                  sessionId={sessionId}
                  latest={record?.seq === latestReply}
                />
              </DisclosureContent>
            </Fragment>
          );
        }
        const record = node.record;
        if (
          record.event_type === "input/message" &&
          !record.data.content.some((block) => block.text.trim()) &&
          !record.data.file_refs.length &&
          !record.data.workspace_files?.length &&
          !record.data.question_answer
        )
          return null;
        if (
          record.event_type === "input/cancelled" &&
          (record.data.diagnostic ||
            /^(CLOUD|SANDBOX|WORKSPACE|CREDENTIAL|NETWORK)_/.test(
              record.data.reason,
            ))
        ) {
          const id = `input:${record.data.input_id}`;
          return (
            <div key={record.seq} className="agent-turn-heading">
              <span className="text-xs text-muted">
                消息未执行 · 输入 {record.data.input_id}
              </span>
              <TurnIssues
                label="消息未执行原因"
                issues={[
                  {
                    id,
                    source: "运行环境",
                    state: "failed",
                    summary: "环境不可用，消息未进入运行",
                    reasons: [
                      diagnosticReason(
                        record.data.diagnostic,
                        record.data.reason,
                      ),
                    ],
                    details: diagnosticLines(record.data.diagnostic),
                    count: 1,
                  },
                ]}
                open={diagnostic?.runId === id}
                onOpenChange={(open) =>
                  setDiagnostic(open ? { runId: id } : null)
                }
              />
            </div>
          );
        }
        if (record.event_type === "input/message") {
          const source = record.data.source_ref;
          const sourceId =
            source?.kind === "interaction"
              ? source.id
              : questionSources.get(record.data.input_id);
          const replyQuestions =
            record.data.question_context?.questions ??
            (sourceId ? questions.get(sourceId) : undefined);
          const text = [
            record.data.content
              .map((block) => block.text)
              .filter((text) => text.trim())
              .join("\n"),
            record.data.question_answer
              ? questionReplyText(record.data.question_answer, replyQuestions)
              : "",
          ]
            .filter(Boolean)
            .join("\n");
          if (
            !text &&
            !record.data.file_refs.length &&
            !record.data.workspace_files?.length
          )
            return null;
          return (
            <UserBubble
              key={`input:${record.data.input_id}`}
              inputId={record.data.input_id}
              text={text}
              fileRefs={record.data.file_refs}
              workspaceFiles={record.data.workspace_files}
              computerId={computerId}
              sessionId={sessionId}
              time={record.occurred_at}
              latest={record.seq === latestInput && !submissions.length}
              actorLabel={
                record.data.actor_ref.kind === "user" &&
                record.data.actor_ref.id === user.id
                  ? ""
                  : service
                    ? "管理员 · "
                    : "用户 · "
              }
            />
          );
        }
        if (record.event_type === "run/ended") {
          const runId = record.run_id ?? record.data.run_id;
          const files = artifacts.get(runId) ?? [];
          const reply = closingReplies.get(runId);
          return (
            <Fragment key={record.seq}>
              {!turns.get(runId)?.firstNode && turnHeader(turns.get(runId))}
              <div className="agent-turn-tail" data-run-id={runId}>
                <ArtifactCards files={files} sessionId={sessionId} />
                <div className="agent-message-actions">
                  {reply && (
                    <CopyButton
                      value={reply.data.content
                        .flatMap((block) =>
                          block.type === "text" ? [block.text] : [],
                        )
                        .join("\n\n")}
                      label="复制回复"
                    />
                  )}
                  <TurnUsage sessionId={sessionId} runId={runId} />
                  <time>
                    {new Date(record.data.finished_at).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </time>
                </div>
              </div>
              <VisibleResult record={record} onVisible={onVisibleResult} />
            </Fragment>
          );
        }
        if (record.event_type === "compaction/summary")
          return (
            <details key={record.seq} className="rounded-lg border p-4">
              <summary className="cursor-pointer text-xs text-muted">
                上下文已压缩，原始对话历史仍保留
              </summary>
              <div className="mt-3">
                <MessageContent
                  blocks={record.data.content}
                  sessionId={sessionId}
                />
              </div>
            </details>
          );
        return null;
      })}
      {[...turns.values()]
        .filter(
          (turn) => !turn.end && !turn.firstNode && issues.get(turn.id)?.length,
        )
        .map((turn) => (
          <Fragment key={`pending:${turn.id}`}>{turnHeader(turn)}</Fragment>
        ))}
    </div>
  );
}
function UserBubble({
  inputId,
  text,
  fileRefs,
  workspaceFiles,
  computerId,
  sessionId,
  time,
  latest,
  actorLabel = "",
}: {
  inputId: string;
  text: string;
  fileRefs: FileRef[];
  workspaceFiles?: MessageWorkspaceFile[];
  computerId?: string | null;
  sessionId: string;
  time: string;
  latest: boolean;
  actorLabel?: string;
}) {
  return (
    <article
      className="agent-message-user"
      data-latest={latest}
      data-message-anchor={`input:${inputId}`}
    >
      <div className="agent-user-message-content">
        <MessageAttachments
          references={fileRefs}
          files={workspaceFiles}
          sessionId={sessionId}
          computerId={computerId}
        />
        {text && (
          <div className="agent-user-bubble">
            <div className="whitespace-pre-wrap break-words text-base leading-[26px]">
              {text}
            </div>
          </div>
        )}
        <div className="agent-message-actions justify-end">
          <span>
            {actorLabel}
            {new Date(time).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
          {text && <CopyButton value={text} label="复制消息" />}
        </div>
      </div>
    </article>
  );
}

const AssistantMessage = memo(function AssistantMessage({
  record,
  attempt,
  sessionId,
  latest = false,
  anchor,
}: {
  record?: Extract<
    DurableRecord,
    { event_type: "assistant/message" | "assistant/attempt" }
  >;
  attempt?: ActiveAttempt;
  sessionId: string;
  latest?: boolean;
  anchor?: string;
}) {
  const incomplete = record?.event_type === "assistant/attempt";
  const blocks =
    record?.data.content ??
    attempt?.content.filter((block) => block.type !== "tool_call") ??
    [];
  if (
    incomplete &&
    !blocks.some(
      (block) =>
        block.type === "file_reference" ||
        ((block.type === "text" || block.type === "reasoning") &&
          block.text.trim()),
    )
  )
    return null;
  return (
    <article
      className="agent-message-assistant min-w-0"
      data-latest={latest || Boolean(attempt)}
      aria-label={attempt ? "正在生成的回复" : "助手回复"}
      data-message-anchor={
        anchor ?? `attempt:${record?.data.attempt_id ?? attempt?.attempt_id}`
      }
    >
      <MessageContent
        blocks={blocks.filter((block) => block.type !== "tool_reference")}
        sessionId={sessionId}
        streaming={Boolean(attempt)}
      />
    </article>
  );
});

function WorkingTime({ startedAt }: { startedAt?: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const seconds = startedAt
    ? Math.max(0, Math.floor((now - Date.parse(startedAt)) / 1000))
    : null;
  return (
    <div className="agent-turn-working" role="status">
      <ActivityIcon name="reasoning" active />
      <span className="agent-activity-label">
        工作中
        {seconds !== null
          ? ` · ${seconds >= 60 ? `${Math.floor(seconds / 60)} 分 ` : ""}${seconds % 60} 秒`
          : ""}
      </span>
    </div>
  );
}

const ProcessGroup = memo(function ProcessGroup({
  node,
  sessionId,
  historical,
  pauseAutoCollapse,
  closed,
  onIssue,
  issueToolIds,
}: {
  node: PresentedProcess;
  sessionId: string;
  historical: boolean;
  pauseAutoCollapse: boolean;
  closed: boolean;
  onIssue: (toolId: string) => void;
  issueToolIds: string[];
}) {
  const pending = node.tools.some(
    (tool) =>
      Boolean(tool.draft && !tool.rejected) ||
      (!tool.result &&
        ![
          "succeeded",
          "failed",
          "blocked",
          "cancelled",
          "outcome_unknown",
        ].includes(tool.status ?? "")) ||
      (tool.question &&
        ["waiting", "continued"].includes(tool.question.status) &&
        !tool.question.answer),
  );
  const completed = historical || (closed && !pending);
  const [automaticOpen, setAutomaticOpen] = useState(!completed);
  if (!pauseAutoCollapse && automaticOpen === completed)
    setAutomaticOpen(!completed);
  const live =
    !completed &&
    (node.tools.some((tool) => tool.draft && !tool.rejected) ||
      node.entries.some(
        (entry) => entry.kind === "assistant" && entry.attempt,
      ));
  const activeTool = !historical
    ? [...node.tools]
        .reverse()
        .find(
          (tool) =>
            !tool.rejected &&
            !tool.result &&
            (tool.draft ||
              ["prepared", "dispatching", "running"].includes(
                tool.status ?? "",
              )),
        )
    : undefined;
  const activeName = activeTool?.call?.data.tool_key ?? activeTool?.draft?.name;
  const lastEntry = node.entries.at(-1);
  const previewTool =
    activeTool ??
    (lastEntry?.kind === "tool"
      ? node.tools.find((tool) => tool.id === lastEntry.id)
      : undefined);
  const summary = previewTool ? toolSummary(previewTool) : undefined;
  const reasoning =
    lastEntry?.kind === "assistant"
      ? (lastEntry.attempt?.content ?? lastEntry.record?.data.content ?? [])
          .flatMap((block) => (block.type === "reasoning" ? [block.text] : []))
          .join(" ")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 160)
      : "";
  const preview = summary
    ? [builtinToolNames[summary.name] ?? summary.name, summary.hint]
        .filter(Boolean)
        .join(" · ")
    : reasoning;
  const content = node.entries.map((entry) => {
    if (entry.kind === "assistant")
      return (
        <AssistantMessage
          key={entry.id}
          anchor={`${node.id}:${entry.id}`}
          record={entry.record}
          attempt={entry.attempt}
          sessionId={sessionId}
        />
      );
    const tool = node.tools.find((item) => item.id === entry.id)!;
    return (
      <ToolEvent
        key={entry.key ?? tool.id}
        id={tool.id}
        draft={tool.draft}
        rejected={tool.rejected}
        call={tool.call}
        result={tool.result}
        reconciliation={tool.reconciliation}
        status={tool.status}
        question={tool.question}
        onIssue={
          issueToolIds.includes(tool.id) ? () => onIssue(tool.id) : undefined
        }
        sessionId={sessionId}
      />
    );
  });
  return (
    <section
      className="min-w-0"
      data-has-tools={Boolean(node.tools.length)}
      data-grouped="true"
      data-message-anchor={node.anchor}
      aria-label={node.tools.length ? "工具过程" : "思考过程"}
    >
      <ChatDisclosure
        open={pauseAutoCollapse ? automaticOpen : !completed}
        automatic
        label={
          live
            ? "思考与工具过程"
            : node.tools.length
              ? `已使用工具 ${node.tools.length} 次`
              : "思考过程"
        }
        active={Boolean(activeName) || live}
        collapsedDetail={!completed && preview ? preview : undefined}
        icon={
          activeName && activeTool ? (
            <ActivityIcon
              name={activeName}
              active={toolIconActive(activeName, activeTool, true)}
            />
          ) : (
            <Atom aria-hidden className="agent-activity-icon" />
          )
        }
      >
        <div className="agent-process-steps">
          {content.map((child, index) => (
            <div
              key={
                node.entries[index].kind === "tool"
                  ? (node.entries[index].key ?? node.entries[index].id)
                  : node.entries[index].id
              }
              className="agent-process-step"
              data-message-anchor={`${node.id}:${node.entries[index].kind === "tool" ? (node.entries[index].key ?? node.entries[index].id) : node.entries[index].id}`}
            >
              {child}
            </div>
          ))}
        </div>
      </ChatDisclosure>
    </section>
  );
});

function VisibleResult({
  record,
  onVisible,
}: {
  record: Extract<DurableRecord, { event_type: "run/ended" }>;
  onVisible?: (
    record: Extract<DurableRecord, { event_type: "run/ended" }>,
  ) => void;
}) {
  const element = useRef<HTMLDivElement>(null),
    callback = useRef(onVisible);
  callback.current = onVisible;
  const watching = Boolean(onVisible);
  useEffect(() => {
    const node = element.current;
    if (!node || !watching) return;
    const scroll = node.closest(".agent-chat-scroll");
    const footer = scroll?.parentElement?.querySelector(".agent-chat-footer");
    const check = () => {
      const box = node.getBoundingClientRect();
      const clip = scroll?.getBoundingClientRect();
      const visibleBottom = Math.min(
        clip?.bottom ?? window.innerHeight,
        footer?.getBoundingClientRect().top ?? window.innerHeight,
      );
      if (
        document.visibilityState === "visible" &&
        document.hasFocus() &&
        box.top >= 0 &&
        box.bottom <= window.innerHeight &&
        (!clip || box.top >= clip.top) &&
        box.bottom <= visibleBottom
      )
        callback.current?.(record);
    };
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) check();
      },
      { threshold: 1 },
    );
    observer.observe(node);
    // IntersectionObserver cannot see a floating composer covering the result.
    const dockObserver = new ResizeObserver(check);
    if (footer) dockObserver.observe(footer);
    scroll?.addEventListener("scroll", check, { passive: true });
    document.addEventListener("visibilitychange", check);
    window.addEventListener("focus", check);
    return () => {
      observer.disconnect();
      dockObserver.disconnect();
      scroll?.removeEventListener("scroll", check);
      document.removeEventListener("visibilitychange", check);
      window.removeEventListener("focus", check);
    };
  }, [record, watching]);
  return (
    <div
      ref={element}
      data-message-anchor={record.seq}
      className="agent-turn-result"
      aria-hidden="true"
    />
  );
}
