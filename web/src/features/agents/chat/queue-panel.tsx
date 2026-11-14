import { useEffect, useId, useState } from "react";
import {
  Pencil,
  Trash2,
  ChevronLeft,
  ChevronRight,
  Paperclip,
} from "lucide-react";
import { ChatIconButton } from "./controls";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/button";
import { Field, Textarea } from "@/components/fields";
import {
  AsyncBoundary,
  EmptyState,
  Notice,
  StatusBadge,
} from "@/components/feedback";
import {
  Drawer,
  OverlayCancelButton,
  ConfirmDialog,
} from "@/components/overlays";
import { Pagination } from "@/components/pagination";
import { useApiQuery } from "@/hooks/use-api";
import { isVersionConflict, type ApiResponse } from "@/api/client";
import type { AgentInput, Interaction, QuestionAnswer } from "@/types/agents";
import { agentRoot } from "../data/agent-api";
import { useAgentCommand, useCommandResult } from "../data/agent-runtime";
import { useResourceSave } from "@/features/agents/resources/admin-shared";
import { FileReference } from "./content";
import { QuestionFields, validAnswer } from "./interactions";
import { questionReplyText } from "./question-content";

export function QueuePanel({
  sessionId,
  archived,
  canControl,
  onChanged,
  onClose,
  inline = false,
}: {
  sessionId: string;
  archived: boolean;
  canControl: boolean;
  onChanged: () => void;
  onClose: () => void;
  inline?: boolean;
}) {
  const cache = useQueryClient();
  const pageSize = inline ? 4 : 20;
  const [page, setPage] = useState(1),
    [editing, setEditing] = useState<string | null>(null);
  const query = useApiQuery<AgentInput[]>(
    ["agent-session", sessionId, "queue", page, pageSize],
    `${agentRoot}/sessions/${sessionId}/inputs?state=pending&page=${page}&page_size=${pageSize}`,
  );
  const total = query.data?.pagination?.total;
  useEffect(() => {
    if (
      total !== undefined &&
      page > Math.max(1, Math.ceil(total / pageSize))
    ) {
      setPage(Math.max(1, Math.ceil(total / pageSize)));
    }
  }, [total, page, pageSize]);
  const content = (
    <>
      <AsyncBoundary
        loading={query.isPending}
        error={query.error}
        onRetry={() => query.refetch()}
      >
        <div className={inline ? "agent-queue-items" : "space-y-4"}>
          {query.data?.data.map((input) => (
            <QueuedInput
              key={`${input.id}:${input.version}`}
              input={input}
              compact={inline}
              sessionId={sessionId}
              enabled={canControl && !archived}
              refreshing={query.isFetching}
              onEdit={() => setEditing(input.id)}
              onChanged={() => {
                void query.refetch();
                onChanged();
              }}
            />
          ))}
          {query.data?.data.length === 0 &&
            (inline ? (
              <p className="agent-queue-empty">没有待发送消息</p>
            ) : (
              <EmptyState title="没有待处理输入" />
            ))}
        </div>
        {inline ? (
          (query.data?.pagination?.total ?? 0) > pageSize && (
            <div className="agent-queue-pages">
              <ChatIconButton
                label="上一页待发送消息"
                disabled={page === 1 || query.isFetching}
                onClick={() => setPage(page - 1)}
              >
                <ChevronLeft />
              </ChatIconButton>
              <span>
                {page} /{" "}
                {Math.ceil((query.data?.pagination?.total ?? 0) / pageSize)}
              </span>
              <ChatIconButton
                label="下一页待发送消息"
                disabled={
                  page * pageSize >= (query.data?.pagination?.total ?? 0) ||
                  query.isFetching
                }
                onClick={() => setPage(page + 1)}
              >
                <ChevronRight />
              </ChatIconButton>
            </div>
          )
        ) : (
          <Pagination
            page={page}
            size={20}
            total={query.data?.pagination?.total}
            pending={query.isFetching}
            onChange={setPage}
          />
        )}
      </AsyncBoundary>
      {editing && (
        <InputEditor
          sessionId={sessionId}
          id={editing}
          onClose={() => setEditing(null)}
          onSaved={async (updated) => {
            const key = ["agent-session", sessionId, "queue"];
            await cache.cancelQueries({ queryKey: key });
            cache.setQueriesData<ApiResponse<AgentInput[]>>(
              { queryKey: key },
              (current) =>
                current && {
                  ...current,
                  data: current.data.map((item) =>
                    item.id === updated.id ? updated : item,
                  ),
                },
            );
            setEditing(null);
            void query.refetch();
            onChanged();
          }}
        />
      )}
    </>
  );
  return inline ? (
    <section className="agent-inline-queue" aria-label="待处理输入列表">
      {content}
    </section>
  ) : (
    <Drawer
      open
      wide
      title="待处理输入"
      onClose={onClose}
      description="按受理顺序在新轮次处理，编辑不会延长排队期限。"
      footer={<OverlayCancelButton>关闭</OverlayCancelButton>}
    >
      {content}
    </Drawer>
  );
}
function QueuedInput({
  input,
  compact = false,
  sessionId,
  enabled,
  refreshing,
  onEdit,
  onChanged,
}: {
  input: AgentInput;
  compact?: boolean;
  sessionId: string;
  enabled: boolean;
  refreshing: boolean;
  onEdit: () => void;
  onChanged: () => void;
}) {
  const previewId = useId();
  const [preview, setPreview] = useState(false);
  const message =
    [
      input.content
        .map((block) => block.text)
        .join("\n")
        .trim(),
      input.question_answer &&
        questionReplyText(
          input.question_answer,
          input.question_context?.questions,
        ),
    ]
      .filter(Boolean)
      .join("\n") ||
    {
      message: "附件消息",
      question_reply: "补充回答",
      approval_reply: "审批回应",
      continue: "继续执行",
    }[input.kind];
  const action = useAgentCommand<AgentInput | null>(
      `session:${sessionId}:input:${input.id}:control`,
    ),
    [remove, setRemove] = useState(false);
  useCommandResult(action.state, () => {
    setRemove(false);
    action.command.reset();
    onChanged();
  });
  const conflictRecovery = action.state.phase === "failed" &&
    isVersionConflict(action.state.error) && (
      <Notice tone="warning">
        这条输入已有变化，请读取最新内容后再确认操作。
        <Button
          className="mt-3"
          variant="outline"
          pending={refreshing}
          onClick={() => {
            action.command.reset();
            onChanged();
          }}
        >
          读取最新输入
        </Button>
      </Notice>
    );
  return (
    <article
      className={
        compact
          ? "agent-queued-message"
          : "agent-queued-input rounded-xl border p-4"
      }
    >
      {compact ? (
        <>
          <div className="agent-queued-message-row">
            <span className="agent-queue-marker" aria-hidden />
            <div
              className="agent-queue-preview-anchor"
              tabIndex={0}
              aria-describedby={preview ? previewId : undefined}
              onMouseEnter={() => setPreview(true)}
              onMouseLeave={() => setPreview(false)}
              onFocus={() => setPreview(true)}
              onBlur={() => setPreview(false)}
              onKeyDown={(event) => {
                if (event.key === "Escape") setPreview(false);
              }}
            >
              <p>{message}</p>
              {preview && (
                <div
                  id={previewId}
                  role="tooltip"
                  className="agent-queue-preview"
                >
                  {message}
                </div>
              )}
            </div>
            {input.file_refs.length > 0 && (
              <span
                className="agent-queue-files"
                title={`${input.file_refs.length} 个附件`}
              >
                <Paperclip />
                {input.file_refs.length}
              </span>
            )}
            {enabled && (
              <div className="agent-queue-actions">
                <ChatIconButton
                  label="编辑"
                  disabled={
                    refreshing ||
                    action.pending ||
                    action.uncertain ||
                    input.kind === "continue" ||
                    input.kind === "approval_reply"
                  }
                  onClick={onEdit}
                >
                  <Pencil />
                </ChatIconButton>
                <ChatIconButton
                  label="删除"
                  disabled={refreshing || action.pending || action.uncertain}
                  onClick={() => setRemove(true)}
                >
                  <Trash2 />
                </ChatIconButton>
              </div>
            )}
          </div>
          {action.recovery}
          {conflictRecovery}
        </>
      ) : (
        <>
          <div className="mb-3 flex items-center justify-between">
            <StatusBadge>
              {
                {
                  message: "消息",
                  question_reply: "补充回答",
                  approval_reply: "审批回应",
                  continue: "继续执行",
                }[input.kind]
              }
            </StatusBadge>
            <span className="text-xs text-muted">下一轮处理</span>
          </div>
          <p className="max-h-40 overflow-auto whitespace-pre-wrap break-words text-sm leading-6">
            {input.content.map((block) => block.text).join("\n") ||
              (input.kind === "question_reply"
                ? "对先前问题的补充回答"
                : "从已结束的任务继续")}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {input.file_refs.map((ref) => (
              <FileReference
                key={`${ref.kind}:${ref.id}`}
                reference={ref}
                sessionId={sessionId}
              />
            ))}
          </div>
          <p className="mt-3 text-xs text-muted">
            截止 {new Date(input.queue_deadline_at).toLocaleString()} · 修订{" "}
            {input.revision}
            {input.last_modified_by && " · 曾被修改"}
          </p>
          {action.recovery}
          {conflictRecovery}
          {enabled && (
            <div className="mt-4 flex flex-wrap gap-2">
              <Button
                variant="outline"
                disabled={
                  refreshing ||
                  action.pending ||
                  action.uncertain ||
                  input.kind === "continue" ||
                  input.kind === "approval_reply"
                }
                onClick={onEdit}
              >
                编辑
              </Button>
              <Button
                variant="ghost"
                disabled={refreshing || action.pending || action.uncertain}
                onClick={() => setRemove(true)}
              >
                移除
              </Button>
            </div>
          )}
        </>
      )}
      <ConfirmDialog
        open={remove}
        title="移除这条待处理输入？"
        description="只移除尚未被领取的输入，已记录的历史和原发送回执会保留。"
        danger
        confirmLabel="移除"
        pending={refreshing || action.pending || action.uncertain}
        onClose={() => setRemove(false)}
        onConfirm={() => {
          void action.command
            .run({
              domain: agentRoot,
              path: `/sessions/${sessionId}/inputs/${input.id}`,
              command: "input.remove",
              scope: `input:${input.id}`,
              options: { method: "DELETE", etag: `"${input.version}"` },
            })
            .then(() => {
              if (action.command.getSnapshot().phase === "failed")
                setRemove(false);
            });
        }}
      >
        {action.recovery}
        {conflictRecovery}
      </ConfirmDialog>
    </article>
  );
}
function InputEditor({
  sessionId,
  id,
  onClose,
  onSaved,
}: {
  sessionId: string;
  id: string;
  onClose: () => void;
  onSaved: (input: AgentInput) => void;
}) {
  const query = useApiQuery<AgentInput>(
    ["agent-session", sessionId, "input", id],
    `${agentRoot}/sessions/${sessionId}/inputs/${id}`,
  );
  const [editorState, setEditorState] = useState({
    dirty: false,
    pending: false,
  });
  return (
    <Drawer
      open
      wide
      title="编辑待处理输入"
      dirty={editorState.dirty}
      pending={editorState.pending}
      onClose={onClose}
    >
      <AsyncBoundary
        loading={query.isPending}
        error={query.error}
        onRetry={() => query.refetch()}
      >
        {query.data && (
          <InputEditorForm
            initial={query.data}
            onSaved={onSaved}
            onState={setEditorState}
          />
        )}
      </AsyncBoundary>
    </Drawer>
  );
}
function InputEditorForm({
  initial,
  onSaved,
  onState,
}: {
  initial: ApiResponse<AgentInput>;
  onSaved: (input: AgentInput) => void;
  onState: (state: { dirty: boolean; pending: boolean }) => void;
}) {
  const input = initial.data;
  const [text, setText] = useState(
      input.content.map((block) => block.text).join("\n"),
    ),
    [refs, setRefs] = useState(input.file_refs),
    [answer, setAnswer] = useState(input.question_answer),
    [baseline, setBaseline] = useState(JSON.stringify({ text, refs, answer }));
  const questionId =
    input.source_ref?.kind === "interaction" ? input.source_ref.id : "";
  const question = useApiQuery<Interaction>(
    ["agent-session", input.session_id, "interaction", questionId],
    `${agentRoot}/interactions/${questionId}`,
    { enabled: input.kind === "question_reply" && Boolean(questionId) },
  );
  const dirty = JSON.stringify({ text, refs, answer }) !== baseline;
  const save = useResourceSave({
    initial,
    path: `${agentRoot}/sessions/${input.session_id}/inputs/${input.id}`,
    dirty,
    adopt: (value) => {
      const updated = {
        text: value.content.map((block) => block.text).join("\n"),
        refs: value.file_refs,
        answer: value.question_answer,
      };
      setText(updated.text);
      setRefs(updated.refs);
      setAnswer(updated.answer);
      setBaseline(JSON.stringify(updated));
    },
    complete: onSaved,
  });
  const questionData = question.data?.data;
  useEffect(
    () => onState({ dirty, pending: save.pending || save.blocked }),
    [dirty, save.pending, save.blocked, onState],
  );
  const valid =
    input.kind === "message"
      ? Boolean(text.trim() || refs.length)
      : questionData?.kind === "question" &&
        answer &&
        validAnswer(questionData.questions, answer);
  return (
    <form
      className="space-y-5"
      onSubmit={(event) => {
        event.preventDefault();
        void save.save(
          input.kind === "message"
            ? {
                content: text.trim() ? [{ type: "text", text }] : [],
                file_refs: refs,
              }
            : { question_answer: answer },
        );
      }}
    >
      {save.recovery}
      {input.state !== "pending" && (
        <Notice tone="warning">输入已被领取或结束，不能继续编辑。</Notice>
      )}
      {input.kind === "message" ? (
        <>
          <Field label="消息正文">
            <Textarea
              rows={8}
              value={text}
              disabled={save.pending || save.blocked}
              onChange={(event) => setText(event.target.value)}
            />
          </Field>
          <div className="space-y-2">
            {refs.map((ref) => (
              <div
                key={`${ref.kind}:${ref.id}`}
                className="flex items-center justify-between gap-3"
              >
                <FileReference reference={ref} sessionId={input.session_id} />
                <Button
                  variant="ghost"
                  disabled={save.pending || save.blocked}
                  onClick={() => setRefs(refs.filter((value) => value !== ref))}
                >
                  移除引用
                </Button>
              </div>
            ))}
          </div>
        </>
      ) : (
        <AsyncBoundary
          loading={question.isPending}
          error={question.error}
          onRetry={() => question.refetch()}
        >
          {questionData?.kind === "question" && answer && (
            <QuestionFields
              questions={questionData.questions}
              answer={answer}
              onChange={(value: QuestionAnswer) => setAnswer(value)}
              disabled={save.pending || save.blocked}
            />
          )}
        </AsyncBoundary>
      )}
      <Button
        type="submit"
        pending={save.pending}
        disabled={save.blocked || !dirty || !valid || input.state !== "pending"}
      >
        保存修订
      </Button>
    </form>
  );
}
