import { Fragment, memo, useEffect, useMemo, useRef, useState } from "react";
import { Waypoints, Bot } from "lucide-react";
import { useSession } from "@/app/auth";
import { ChatCopyButton as CopyButton } from "./controls";
import type { ActiveAttempt, DurableRecord } from "@/types/agent-events";
import type { FileRef } from "@/types/agents";
import type { AcceptedSubmission } from "../data/send-flow";
import { runStatusNames } from "@/features/agents/resources/admin-shared";
import {
  ConversationProjector,
  conversationTurns,
  toolNeedsAttention,
  type ConversationTurn,
} from "../data/conversation-projection";
import {
  conversationPresentation,
  type PresentedNode,
  type PresentedProcess,
} from "../data/conversation-presentation";
import { turnIssues } from "../data/turn-issues";
import { TurnIssues } from "./turn-issues";
import { MessageContent, FileReference } from "./content";
import { ToolEvent, builtinToolNames } from "./tool-event";
import { ChatDisclosure } from "./disclosure";
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
export function ConversationTimeline({
  records,
  sessionId,
  attempt,
  service = false,
  onVisibleResult,
  submissions = [],
}: {
  records: DurableRecord[];
  sessionId: string;
  attempt: ActiveAttempt | null;
  service?: boolean;
  submissions?: readonly AcceptedSubmission[];
  onVisibleResult?: (
    record: Extract<DurableRecord, { event_type: "run/ended" }>,
  ) => void;
}) {
  const { user } = useSession();
  const [projector] = useState(() => new ConversationProjector());
  const nodes = useMemo(
    () => conversationPresentation(projector.project(records), attempt),
    [projector, records, attempt],
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
  const [opened, setOpened] = useState<Map<string, boolean>>(() => new Map());
  const motion = useDisclosureMotion();
  const [turnRevisions, setTurnRevisions] = useState(new Map<string, number>());
  const latestTurnId = submissions.length
    ? undefined
    : (attempt?.run_id ??
      [...records]
        .reverse()
        .find((record) => record.run_id && turns.has(record.run_id))?.run_id);
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
  const turnExpanded = (turn?: ConversationTurn) =>
    !turn?.foldable ||
    !foldableTurns.has(turn.id) ||
    (opened.get(turn.id) ??
      (turn.id === latestTurnId ||
        Boolean(
          issues.get(turn.id)?.some((issue) => issue.state === "pending"),
        )));
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
      <div className="agent-turn-heading">
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
                setOpened((previous) => {
                  const next = new Map(previous);
                  next.set(turn.id, !expanded);
                  return next;
                });
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
      {items.map((node) => {
        if (node.kind === "submission") {
          const item = node.submission;
          return (
            <UserBubble
              key={`input:${item.inputId}`}
              inputId={item.inputId}
              text={item.text}
              fileRefs={item.fileRefs}
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
          return (
            <Fragment key={node.id}>
              {turn?.firstNode === node.id && turnHeader(turn)}
              <DisclosureContent open={expanded} revision={revision}>
                <div
                  className="agent-process-slot"
                  onFocusCapture={() => {
                    if (turn && !expanded)
                      setOpened((previous) =>
                        new Map(previous).set(turn.id, true),
                      );
                  }}
                >
                  <ProcessGroup
                    node={node}
                    sessionId={sessionId}
                    historical={Boolean(turn?.end)}
                    onIssue={(toolId) => {
                      if (turn)
                        setDiagnostic({
                          runId: turn.id,
                          issueId: `tool:${toolId}`,
                        });
                    }}
                  />
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
          !record.data.question_answer
        )
          return null;
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
          return (
            <UserBubble
              key={`input:${record.data.input_id}`}
              inputId={record.data.input_id}
              text={text}
              fileRefs={record.data.file_refs}
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
              {(files.length > 0 || reply) && (
                <div className="agent-turn-tail" data-run-id={runId}>
                  <ArtifactCards files={files} sessionId={sessionId} />
                  {reply && (
                    <div className="agent-message-actions">
                      <CopyButton
                        value={reply.data.content
                          .flatMap((block) =>
                            block.type === "text" ? [block.text] : [],
                          )
                          .join("\n\n")}
                        label="复制回复"
                      />
                      <TurnUsage sessionId={sessionId} runId={runId} />
                      <time>
                        {new Date(record.data.finished_at).toLocaleTimeString(
                          [],
                          { hour: "2-digit", minute: "2-digit" },
                        )}
                      </time>
                    </div>
                  )}
                </div>
              )}
              {!turns.get(runId)?.firstNode && turnHeader(turns.get(runId))}
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
  sessionId,
  time,
  latest,
  actorLabel = "",
}: {
  inputId: string;
  text: string;
  fileRefs: FileRef[];
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
        <div className="agent-user-bubble">
          {text && (
            <div className="whitespace-pre-wrap break-words text-base leading-[26px]">
              {text}
            </div>
          )}
          {fileRefs.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {fileRefs.map((ref) => (
                <FileReference
                  key={`${ref.kind}:${ref.id}`}
                  reference={ref}
                  sessionId={sessionId}
                />
              ))}
            </div>
          )}
        </div>
        <div className="agent-message-actions justify-end">
          <span>
            {actorLabel}
            {new Date(time).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
          <CopyButton value={text} label="复制消息" />
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
      aria-label={attempt ? "正在生成的回复" : "智能体回复"}
      data-message-anchor={
        anchor ?? record?.seq ?? `attempt:${attempt?.attempt_id}`
      }
    >
      {incomplete && <span className="agent-incomplete-label">未完成</span>}
      <MessageContent
        blocks={blocks.filter((block) => block.type !== "tool_reference")}
        sessionId={sessionId}
        streaming={Boolean(attempt)}
      />
      {attempt?.content
        .filter((block) => block.type === "tool_call")
        .map((block) => (
          <DraftTool
            key={block.draft_call_id}
            name={block.name ?? "工具调用"}
            argumentsText={block.arguments_text}
          />
        ))}
    </article>
  );
});

function DraftTool({
  name,
  argumentsText,
}: {
  name: string;
  argumentsText: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <ChatDisclosure
      open={open}
      onToggle={() => setOpen(!open)}
      label={`正在准备${builtinToolNames[name] ?? name}`}
      active
      icon={<ActivityIcon name={name} active />}
    >
      <div className="agent-tool-body">
        <pre className="max-h-60 overflow-auto whitespace-pre-wrap break-all text-xs">
          {argumentsText}
        </pre>
        <p className="mt-2 text-xs text-muted">参数仍在生成，工具尚未执行。</p>
      </div>
    </ChatDisclosure>
  );
}

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
  onIssue,
}: {
  node: PresentedProcess;
  sessionId: string;
  historical: boolean;
  onIssue: (toolId: string) => void;
}) {
  const attention = node.tools.some(
    (tool) =>
      toolNeedsAttention(tool) &&
      (!historical ||
        (tool.result?.data.outcome.certainty === "unknown" &&
          !tool.reconciliation)),
  );
  const [opened, setOpened] = useState<boolean | null>(null);
  const grouped =
    node.entries.reduce(
      (count, entry) =>
        count +
        (entry.kind === "tool"
          ? 1
          : (entry.attempt?.content ?? entry.record?.data.content ?? []).filter(
              (block) =>
                block.type === "tool_call" ||
                (block.type === "reasoning" && block.text.trim()),
            ).length),
      0,
    ) > 1;
  const live = node.entries.some(
    (entry) => entry.kind === "assistant" && entry.attempt,
  );
  // Keep the automatically revealed live process open after it settles, while
  // respecting an explicit user collapse throughout subsequent streaming.
  if (live && opened === null) setOpened(true);
  const open = opened ?? (attention || live);
  const activeTool = !historical
    ? [...node.tools]
        .reverse()
        .find(
          (tool) =>
            !tool.result &&
            ["prepared", "dispatching", "running"].includes(tool.status ?? ""),
        )
    : undefined;
  const activeName = activeTool?.call?.data.tool_key;
  const activityLabel = activeName
    ? `正在${builtinToolNames[activeName] ?? activeName}`
    : !historical
      ? "思考与工具过程"
      : null;
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
        key={tool.id}
        id={tool.id}
        call={tool.call}
        result={tool.result}
        reconciliation={tool.reconciliation}
        status={tool.status}
        question={tool.question}
        onIssue={() => onIssue(tool.id)}
        sessionId={sessionId}
      />
    );
  });
  return (
    <section
      className="min-w-0"
      data-has-tools={Boolean(node.tools.length)}
      data-grouped={grouped}
      data-message-anchor={node.anchor}
      aria-label={node.tools.length ? "工具过程" : "思考过程"}
    >
      <ChatDisclosure
        open={!grouped || open}
        headingHidden={!grouped}
        onToggle={() => setOpened(!open)}
        label={
          activeName
            ? activityLabel!
            : live
              ? "思考与工具过程"
              : node.tools.length
                ? `已使用工具 ${node.tools.length} 次`
                : "思考过程"
        }
        active={Boolean(activeName) || live}
        icon={
          activeName ? (
            <ActivityIcon name={activeName} active />
          ) : (
            <Waypoints aria-hidden className="agent-activity-icon" />
          )
        }
      >
        <div className="agent-process-steps">
          {content.map((child, index) => (
            <div key={node.entries[index].id} className="agent-process-step">
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
    const check = () => {
      const box = node.getBoundingClientRect();
      const clip = node.closest(".agent-chat-scroll")?.getBoundingClientRect();
      if (
        document.visibilityState === "visible" &&
        document.hasFocus() &&
        box.top >= 0 &&
        box.bottom <= window.innerHeight &&
        (!clip || (box.top >= clip.top && box.bottom <= clip.bottom))
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
    document.addEventListener("visibilitychange", check);
    window.addEventListener("focus", check);
    return () => {
      observer.disconnect();
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
