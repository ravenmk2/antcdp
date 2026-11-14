import { useEffect, useId, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  ArrowUp,
  ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/button";
import { AsyncBoundary, Notice } from "@/components/feedback";
import { useApiQuery } from "@/hooks/use-api";
import { useUnsaved } from "@/hooks/use-unsaved";
import type { ApiResponse } from "@/api/client";
import type {
  AnswerReceipt,
  DecisionReceipt,
  Interaction,
  Question,
  QuestionAnswer,
} from "@/types/agents";
import { agentRoot } from "../data/agent-api";
import { useAgentCommand, useCommandResult } from "../data/agent-runtime";
import { recommendedLabel } from "./question-content";

const statusNames: Record<Interaction["status"], string> = {
  waiting: "等待回答",
  continued: "可补充回答",
  reply_queued: "回答已排队",
  answered: "已回答",
  cancelled: "已关闭",
  pending: "等待批准",
  approved_once: "已批准本次操作",
  rejected: "已拒绝",
  expired: "审批已过期",
  unavailable: "无法取得人工授权",
};
export function emptyAnswer(questions: Question[]): QuestionAnswer {
  return {
    skip: false,
    answers: questions.map((question) => ({
      question_id: question.question_id,
      option_ids: [],
      text: null,
    })),
  };
}
export function validAnswer(questions: Question[], answer: QuestionAnswer) {
  return (
    answer.skip ||
    questions.every((question) => {
      const value = answer.answers.find(
        (item) => item.question_id === question.question_id,
      );
      return (
        value &&
        ((value.option_ids.length > 0 && question.type !== "text") ||
          ((question.type === "text" || question.allow_text) &&
            Boolean(value.text?.trim())))
      );
    })
  );
}
export function QuestionFields({
  questions,
  answer,
  onChange,
  disabled = false,
  page,
}: {
  questions: Question[];
  answer: QuestionAnswer;
  onChange: (answer: QuestionAnswer) => void;
  disabled?: boolean;
  page?: number;
}) {
  const groupId = useId();
  function patch(
    id: string,
    values: Partial<QuestionAnswer["answers"][number]>,
  ) {
    onChange({
      skip: false,
      answers: questions.map((question) => {
        const old = answer.answers.find(
          (value) => value.question_id === question.question_id,
        ) ?? { question_id: question.question_id, option_ids: [], text: null };
        return question.question_id === id ? { ...old, ...values } : old;
      }),
    });
  }
  return (
    <fieldset disabled={disabled} className="agent-question-form">
      {questions.map((question, index) => {
        if (page !== undefined && index !== page) return null;
        const value = answer.answers.find(
          (item) => item.question_id === question.question_id,
        );
        return (
          <section key={question.question_id} className="agent-question-fields">
            <h3 className="agent-question-prompt">
              {questions.length > 1 && `${index + 1}. `}
              {question.prompt}
              {question.type === "multi_choice" && (
                <span className="agent-question-type">可多选</span>
              )}
            </h3>
            {question.options.map((option, optionIndex) => (
              <label
                key={option.id}
                className="agent-question-option"
                data-selected={value?.option_ids.includes(option.id) ?? false}
              >
                <input
                  className="agent-question-choice"
                  type={question.type === "multi_choice" ? "checkbox" : "radio"}
                  name={`${groupId}-${question.question_id}`}
                  value={option.id}
                  checked={value?.option_ids.includes(option.id) ?? false}
                  onChange={(event) =>
                    patch(question.question_id, {
                      option_ids:
                        question.type === "multi_choice"
                          ? event.target.checked
                            ? [...(value?.option_ids ?? []), option.id]
                            : (value?.option_ids ?? []).filter(
                                (id) => id !== option.id,
                              )
                          : [option.id],
                    })
                  }
                />
                {question.type === "single_choice" && (
                  <span className="agent-question-number" aria-hidden>
                    {optionIndex + 1}
                  </span>
                )}
                <span className="agent-question-option-copy">
                  <span className="agent-question-option-label">
                    {recommendedLabel(option.label).text}
                    {recommendedLabel(option.label, option.recommended)
                      .recommended && (
                      <span className="agent-question-recommended">推荐</span>
                    )}
                  </span>
                  {option.description && (
                    <span className="agent-question-description">
                      {option.description}
                    </span>
                  )}
                </span>
              </label>
            ))}
            {question.type === "text" && (
              <textarea
                className="agent-question-answer"
                aria-label="你的回答"
                placeholder="写下你的回答…"
                rows={3}
                maxLength={4000}
                value={value?.text ?? ""}
                onChange={(event) =>
                  patch(question.question_id, {
                    text: event.target.value || null,
                  })
                }
              />
            )}
            {question.type !== "text" && question.allow_text && (
              <div className="agent-question-custom-row">
                <span className="agent-question-custom-marker" aria-hidden>
                  ＋
                </span>
                <textarea
                  className="agent-question-answer agent-question-custom"
                  aria-label="补充说明"
                  placeholder="其他想法或补充说明（可选）"
                  rows={1}
                  maxLength={4000}
                  value={value?.text ?? ""}
                  onChange={(event) =>
                    patch(question.question_id, {
                      text: event.target.value || null,
                    })
                  }
                />
              </div>
            )}
          </section>
        );
      })}
    </fieldset>
  );
}
export function InteractionCard({
  id,
  sessionId,
  status,
  canAnswer,
  canApprove,
  archived,
  onChanged,
}: {
  id: string;
  sessionId: string;
  status: string;
  canAnswer: boolean;
  canApprove: boolean;
  archived: boolean;
  onChanged: () => void;
}) {
  const query = useApiQuery<Interaction>(
    ["agent-session", sessionId, "interaction", id, status],
    `${agentRoot}/interactions/${id}`,
    {
      placeholderData: (previous) =>
        previous?.data.id === id ? previous : undefined,
    },
  );
  return (
    <section id={`interaction-${id}`} className="agent-interaction-card">
      <AsyncBoundary
        loading={query.isPending}
        error={query.error}
        onRetry={() => query.refetch()}
      >
        {query.data && (
          <InteractionEditor
            key={id}
            initial={query.data}
            sessionId={sessionId}
            canAnswer={canAnswer && !archived && !query.isPlaceholderData}
            canApprove={canApprove && !archived && !query.isPlaceholderData}
            onChanged={() => {
              void query.refetch();
              onChanged();
            }}
          />
        )}
      </AsyncBoundary>
    </section>
  );
}
function InteractionEditor({
  initial,
  sessionId,
  canAnswer,
  canApprove,
  onChanged,
}: {
  initial: ApiResponse<Interaction>;
  sessionId: string;
  canAnswer: boolean;
  canApprove: boolean;
  onChanged: () => void;
}) {
  const interaction = initial.data;
  const [page, setPage] = useState(0);
  const [minimized, setMinimized] = useState(false);
  const [answer, setAnswer] = useState<QuestionAnswer>(() =>
      interaction.kind === "question"
        ? emptyAnswer(interaction.questions)
        : { skip: false, answers: [] },
    ),
    [notice, setNotice] = useState(""),
    [now, setNow] = useState(Date.now());
  const action = useAgentCommand<AnswerReceipt | DecisionReceipt>(
    `session:${sessionId}:interaction:${interaction.id}`,
  );
  const editable =
    interaction.kind === "question"
      ? canAnswer && ["waiting", "continued"].includes(interaction.status)
      : canApprove &&
        interaction.status === "pending" &&
        now < new Date(interaction.expires_at).getTime();
  useUnsaved(
    editable &&
      answer.answers.some((item) => item.option_ids.length || item.text),
    action.pending || action.uncertain,
  );
  useEffect(() => {
    if (!editable) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [editable]);
  useCommandResult(action.state, (result) => {
    setAnswer(
      interaction.kind === "question"
        ? emptyAnswer(interaction.questions)
        : { skip: false, answers: [] },
    );
    setNotice(
      "delivery" in result
        ? result.delivery === "tool_result"
          ? "回答已提交，继续当前对话。"
          : result.queue_paused
            ? "补充回答已加入暂停队列，恢复队列后处理。"
            : "补充回答已排队。"
        : "决定已受理，实际执行仍会检查当前权限。",
    );
    action.command.reset();
    onChanged();
  });
  function submit(
    body: QuestionAnswer | { decision: "approve_once" | "reject" },
  ) {
    if (!editable) return;
    void action.command.run({
      domain: agentRoot,
      path: `/interactions/${interaction.id}/${interaction.kind === "question" ? "answers" : "decisions"}`,
      command:
        interaction.kind === "question"
          ? "interaction.answer"
          : "interaction.decide",
      scope: `interaction:${interaction.id}`,
      options: { method: "POST", etag: initial.etag, body },
    });
  }
  return (
    <div data-kind={interaction.kind} data-minimized={minimized}>
      <div className="agent-interaction-heading">
        {interaction.kind === "question" ? (
          <span className="agent-question-wait-dot" aria-hidden />
        ) : (
          <ShieldCheck className="size-4" />
        )}
        <h2 className="text-sm font-semibold">
          {interaction.kind === "question"
            ? statusNames[interaction.status]
            : "需要批准的操作"}
        </h2>
        {interaction.kind !== "question" && (
          <span className="ml-auto text-xs text-muted">
            {statusNames[interaction.status]}
          </span>
        )}
        {interaction.kind === "question" && (
          <>
            <span className="agent-question-hint">
              {interaction.status === "continued" ||
              now >= new Date(interaction.expires_at).getTime()
                ? ""
                : `等待至 ${new Date(interaction.expires_at).toLocaleTimeString()}`}
            </span>
            <button
              type="button"
              className="agent-question-minimize"
              aria-label={minimized ? "展开提问" : "收起提问"}
              aria-expanded={!minimized}
              onClick={() => setMinimized(!minimized)}
            >
              {minimized ? <ChevronUp /> : <ChevronDown />}
            </button>
          </>
        )}
      </div>
      <div
        className="agent-interaction-body"
        hidden={interaction.kind === "question" && minimized}
      >
        {notice && <Notice>{notice}</Notice>}
        {action.recovery}
        {interaction.kind === "question" ? (
          <>
            <QuestionFields
              questions={interaction.questions}
              page={page}
              answer={interaction.answer ?? answer}
              onChange={setAnswer}
              disabled={!editable || action.pending || action.uncertain}
            />
            {editable && (
              <div className="agent-question-footer">
                {interaction.kind === "question" &&
                  interaction.questions.length > 0 && (
                    <div className="agent-question-pagination">
                      <button
                        type="button"
                        className="agent-question-page-button"
                        aria-label="上一题"
                        disabled={page === 0}
                        onClick={() => setPage(page - 1)}
                      >
                        <ChevronLeft />
                      </button>
                      <span>
                        {page + 1} / {interaction.questions.length}
                      </span>
                      <button
                        type="button"
                        className="agent-question-page-button"
                        aria-label="查看下一题"
                        disabled={page === interaction.questions.length - 1}
                        onClick={() => setPage(page + 1)}
                      >
                        <ChevronRight />
                      </button>
                    </div>
                  )}
                <button
                  type="button"
                  className="agent-question-skip"
                  disabled={action.pending || action.uncertain}
                  onClick={() => submit({ skip: true, answers: [] })}
                >
                  跳过全部问题
                </button>
                <button
                  type="button"
                  className="agent-question-submit"
                  disabled={
                    action.pending ||
                    action.uncertain ||
                    (page === interaction.questions.length - 1
                      ? !validAnswer(interaction.questions, answer)
                      : !validAnswer([interaction.questions[page]], answer))
                  }
                  onClick={() =>
                    page < interaction.questions.length - 1
                      ? setPage(page + 1)
                      : submit(answer)
                  }
                >
                  {action.pending
                    ? "提交中…"
                    : page < interaction.questions.length - 1
                      ? "下一题"
                      : "提交回答"}
                  <ArrowUp aria-hidden />
                </button>
              </div>
            )}
          </>
        ) : (
          <>
            <p className="whitespace-pre-wrap break-words text-sm leading-7">
              {interaction.action.summary}
            </p>
            <details>
              <summary className="cursor-pointer text-xs text-muted">
                查看本次工具与参数
              </summary>
              <p className="mt-3 font-mono text-xs">
                {interaction.action.tool_key}
              </p>
              <pre className="mt-2 max-h-64 overflow-auto rounded-lg border bg-surface p-3 text-xs">
                {JSON.stringify(interaction.action.arguments, null, 2)}
              </pre>
            </details>
            <p className="text-xs text-muted">
              仅批准此调用，截止{" "}
              {new Date(interaction.expires_at).toLocaleString()}
              。过期决定不能执行。
            </p>
            {editable && (
              <div className="agent-interaction-actions">
                <Button
                  pending={action.pending}
                  disabled={action.uncertain}
                  onClick={() => submit({ decision: "approve_once" })}
                >
                  批准本次操作
                </Button>
                <Button
                  variant="outline"
                  disabled={action.pending || action.uncertain}
                  onClick={() => submit({ decision: "reject" })}
                >
                  拒绝
                </Button>
              </div>
            )}
          </>
        )}
        {action.state.phase === "failed" && (
          <Button variant="outline" onClick={onChanged}>
            重新读取当前状态
          </Button>
        )}
      </div>
    </div>
  );
}
