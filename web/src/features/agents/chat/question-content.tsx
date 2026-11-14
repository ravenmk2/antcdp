import type { Question, QuestionAnswer, QuestionStatus } from "@/types/agents";

// Explicit metadata wins; retain Wispjar's label convention for older records.
export function recommendedLabel(label: string, recommended?: boolean) {
  const match = label.match(/\s*[(（](?:Recommended|推荐)[)）]\s*$/i);
  return {
    text: match ? label.slice(0, match.index).trimEnd() : label,
    recommended: recommended ?? Boolean(match),
  };
}

export function questionReplyText(
  answer: QuestionAnswer,
  questions?: Question[],
) {
  if (answer.skip) return "已跳过问题";
  return answer.answers
    .map((item) => {
      const question = questions?.find(
        (q) => q.question_id === item.question_id,
      );
      const labels = item.option_ids.map(
        (id) => question?.options.find((option) => option.id === id)?.label,
      );
      const selected = labels.every((label) => label !== undefined)
        ? labels.map((label) => recommendedLabel(label!).text.trim()).join("、")
        : item.option_ids.length
          ? `已选择 ${item.option_ids.length} 项`
          : "";
      return [selected, item.text?.replace(/\r\n?/g, "\n").trim()]
        .filter(Boolean)
        .join("；");
    })
    .filter(Boolean)
    .join("\n");
}

export function QuestionAnswerList({
  questions,
  answer,
  status,
  settled = false,
}: {
  questions: Question[];
  answer?: QuestionAnswer | null;
  status?: QuestionStatus;
  settled?: boolean;
}) {
  return (
    <div className="agent-question-record">
      <dl>
        {questions.map((question) => {
          const item = answer?.answers.find(
            (item) => item.question_id === question.question_id,
          );
          const parts = item
            ? [
                ...item.option_ids.map((id) => {
                  const option = question.options.find(
                    (option) => option.id === id,
                  );
                  return option
                    ? recommendedLabel(option.label).text
                    : `选项 ${id}`;
                }),
                item.text?.trim(),
              ].filter(Boolean)
            : [];
          const tone = parts.length
            ? "answer"
            : answer?.skip
              ? "skip"
              : "pending";
          const text = parts.length
            ? parts.join("、")
            : answer?.skip
              ? "已跳过"
              : status === "cancelled"
                ? "问题已关闭"
                : status === "continued"
                  ? "待补充回答"
                  : settled && !status
                    ? "当前记录未包含回答"
                    : "待回答";
          return (
            <div key={question.question_id} className="agent-question-pair">
              <dt>
                <span className="agent-question-mark">问</span>
                <span>{question.prompt}</span>
              </dt>
              <dd data-tone={tone}>
                <span className="agent-question-mark">答</span>
                <span>{text}</span>
              </dd>
            </div>
          );
        })}
      </dl>
      {status === "continued" && !answer && (
        <p className="agent-question-record-note">
          等待已结束，仍可在下方提问卡补充回答。
        </p>
      )}
      {status === "reply_queued" && (
        <p className="agent-question-record-note">
          回答已排队，将在下一处理节点继续。
        </p>
      )}
    </div>
  );
}
