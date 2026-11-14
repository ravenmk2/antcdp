import type { DurableRecord } from "@/types/agent-events";
import type { Question } from "@/types/agents";
import { useState } from "react";
import { Circle, CircleCheck, LoaderCircle } from "lucide-react";
import { Notice } from "@/components/feedback";
import {
  toolNeedsAttention,
  type ToolNode,
} from "../data/conversation-projection";
import { MessageContent } from "./content";
import { ChatDisclosure } from "./disclosure";
import { ActivityIcon } from "./activity-icon";
import { QuestionAnswerList } from "./question-content";
import { SandboxExecutionResult, executionStatus } from "./execution-result";
import {
  FileToolResult,
  ToolCode,
  ToolTextResult,
  fileResultSupported,
  readToolObject,
  readSearchResult,
} from "./tool-content";
export const builtinToolNames: Record<string, string> = {
  web_search: "网络搜索",
  web_fetch: "网页读取",
  skill: "加载技能",
  ask_user_question: "向用户提问",
  update_plan: "更新任务计划",
  delegate: "委派临时子任务",
  read_file: "读取文件",
  read_image: "读取图片",
  write_file: "写入文件",
  edit_file: "编辑文件",
  glob: "查找文件",
  grep: "检索文件内容",
  import_file: "导入会话文件",
  exec_command: "执行命令",
  process_status: "查看进程状态",
  process_output: "读取进程输出",
  process_cancel: "停止进程",
  present: "保存正式成果",
};
export function ToolEvent({
  id,
  call,
  result,
  reconciliation,
  status: liveStatus,
  question,
  sessionId,
}: ToolNode & { sessionId: string }) {
  const [opened, setOpen] = useState<boolean | null>(null);
  const pendingQuestion = Boolean(
    question &&
    !question.answer &&
    ["waiting", "continued"].includes(question.status),
  );
  const open = opened ?? pendingQuestion;
  const [visited, setVisited] = useState(false);
  const status = result?.data.status ?? liveStatus;
  const name =
    call?.data.tool_key ?? (question ? "ask_user_question" : "工具结果");
  const args = call?.data.arguments ?? {};
  const builtin = Boolean(
    call && !call.data.mcp_server_id && !call.data.mcp_binding_id,
  );
  const hint =
    (name === "glob" || name === "grep") && typeof args.pattern === "string"
      ? [args.pattern, args.path].filter(Boolean).join(" · ")
      : [
          args.path,
          args.file_path,
          args.command,
          args.pattern,
          args.query,
          args.url,
        ].find((value) => typeof value === "string");
  const attention = toolNeedsAttention({ id, call, result, status });
  const execution = result?.data.sandbox_execution;
  const knownSuccess = Boolean(
    result &&
    result.data.status === "succeeded" &&
    result.data.outcome.certainty === "known" &&
    !result.data.truncated,
  );
  const value =
    builtin && knownSuccess && result
      ? readToolObject(result.data.content)
      : null;
  const file =
    value &&
    result?.data.executed === true &&
    fileResultSupported(name, args, value);
  const search = value ? readSearchResult(name, value) : null;
  const plan =
    name === "update_plan" && builtin && knownSuccess && result
      ? readPlan(result.data.content)
      : null;
  const questions =
    question?.questions ??
    (name === "ask_user_question" &&
    builtin &&
    Array.isArray(args.questions) &&
    args.questions.length > 0 &&
    args.questions.every(
      (q: unknown) =>
        q &&
        typeof q === "object" &&
        "prompt" in q &&
        typeof q.prompt === "string" &&
        "options" in q &&
        Array.isArray(q.options) &&
        q.options.every(
          (o: unknown) =>
            o &&
            typeof o === "object" &&
            "label" in o &&
            typeof o.label === "string",
        ),
    )
      ? (args.questions as Question[])
      : null);
  const running =
    !reconciliation &&
    (execution?.state === "running" ||
      (status && ["prepared", "dispatching", "running"].includes(status)));
  const verifiedStatus = reconciliation
    ? reconciliation.data.executed === false
      ? "确认未执行"
      : ({
          succeeded: "已核实结束",
          failed: "已核实失败",
          cancelled: "已确认停止",
        }[reconciliation.data.observed_status] ?? "已核实结束")
    : undefined;
  const label =
    verifiedStatus ??
    (result?.data.outcome.certainty === "unknown"
      ? "结果未知"
      : execution
        ? `${status === "failed" ? "工具调用失败 · " : ""}${executionStatus(execution)}`
        : status
          ? {
              succeeded: "已完成",
              failed: "失败",
              blocked: "未获准执行",
              cancelled: "已取消",
              outcome_unknown: "结果未知",
              running: "执行中",
              dispatching: "正在派发",
              prepared: "已准备",
              waiting_approval:
                name === "ask_user_question" ? "等待回答" : "等待批准",
            }[status]
          : "等待结果");
  const specialized = Boolean(execution || file || plan || questions || search);
  return (
    <div
      id={`tool-${id}`}
      className={`agent-tool-event min-w-0 ${questions ? "agent-question-tool" : attention ? "agent-process-attention" : ""}`}
    >
      <ChatDisclosure
        open={open}
        onToggle={() => {
          setVisited(true);
          setOpen(!open);
        }}
        label={builtinToolNames[name] ?? name}
        active={Boolean(running) && !pendingQuestion}
        icon={
          <ActivityIcon
            name={name}
            active={Boolean(running) && !pendingQuestion}
          />
        }
        detail={
          questions ? (
            <span
              className="agent-question-status"
              data-pending={pendingQuestion}
            >
              {questions.length} 个问题 ·{" "}
              {question?.answer?.skip
                ? "已跳过"
                : question?.answer
                  ? "已回答"
                  : question?.status === "continued"
                    ? "可补充回答"
                    : question?.status === "cancelled"
                      ? "已关闭"
                      : pendingQuestion
                        ? "待回答"
                        : label}
            </span>
          ) : (
            <span title={typeof hint === "string" ? hint : undefined}>
              {typeof hint === "string" ? hint : label}
              {typeof hint === "string" && (attention || running)
                ? ` · ${label}`
                : ""}
            </span>
          )
        }
      >
        {(visited || open) && (
          <div className="agent-tool-body min-w-0 space-y-3">
            {!call && !question && (
              <p className="text-xs text-muted">
                当前记录包含工具结果；加载更早记录可查看关联的调用名称和参数。
              </p>
            )}
            {plan && (
              <div className="space-y-3">
                {plan.explanation && (
                  <p className="whitespace-pre-wrap text-sm leading-6 text-muted">
                    {plan.explanation}
                  </p>
                )}
                <ol className="space-y-2">
                  {plan.plan.map((step, index) => (
                    <li
                      key={index}
                      className="flex items-start gap-3 text-sm leading-6"
                    >
                      {step.status === "completed" ? (
                        <CircleCheck
                          aria-hidden="true"
                          className="mt-1 size-4 shrink-0 text-success"
                        />
                      ) : step.status === "in_progress" ? (
                        <LoaderCircle
                          aria-hidden="true"
                          className="mt-1 size-4 shrink-0 text-primary"
                        />
                      ) : (
                        <Circle
                          aria-hidden="true"
                          className="mt-1 size-4 shrink-0 text-muted"
                        />
                      )}
                      <span
                        className={
                          step.status === "pending"
                            ? "text-muted"
                            : "text-foreground"
                        }
                      >
                        {step.step}
                      </span>
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
              </div>
            )}
            {questions && (
              <QuestionAnswerList
                questions={questions}
                answer={question?.answer}
                status={question?.status}
                settled={Boolean(result)}
              />
            )}
            {file && value && (
              <FileToolResult name={name} args={args} value={value} />
            )}
            {search && (
              <div className="space-y-3">
                <p className="text-xs text-muted">
                  {search.count ? `${search.count} 项匹配` : "没有找到匹配项"}
                  {search.truncated ? " · 结果已截断" : ""}
                </p>
                {search.text && (
                  <ToolCode source={search.text} title="匹配结果" />
                )}
              </div>
            )}
            {execution && (
              <SandboxExecutionResult
                execution={execution}
                verifiedStatus={verifiedStatus}
              />
            )}
            {!reconciliation &&
              result?.data.outcome.certainty === "unknown" &&
              execution?.state !== "outcome_unknown" && (
                <Notice tone="warning">
                  实际执行结果尚未核实，不能据此认为操作没有发生。
                </Notice>
              )}
            {result?.data.skill_load && (
              <div className="space-y-1 text-xs leading-6 text-muted">
                <p className="break-all font-mono">
                  已加载技能版本 {result.data.skill_load.skill_version_id} ·{" "}
                  {result.data.skill_load.relative_path}
                </p>
                <p>
                  {result.data.skill_load.materialized
                    ? "工作目录副本已准备。"
                    : "技能文本可用，尚无工作目录副本。"}
                </p>
                {result.data.skill_load.materialized &&
                  result.data.skill_load.stable_path && (
                    <p className="break-all font-mono">
                      {result.data.skill_load.stable_path}
                    </p>
                  )}
              </div>
            )}
            {result && (
              <>
                {(!specialized || status !== "succeeded") && !execution && (
                  <ToolTextResult blocks={result.data.content} />
                )}
                <MessageContent
                  blocks={result.data.content.filter(
                    (block) =>
                      block.type !== "text" && block.type !== "tool_reference",
                  )}
                  sessionId={sessionId}
                />
                {result.data.truncated && !execution?.truncated && (
                  <p className="text-xs text-warning">
                    工具结果超过显示上限，已按服务端规则截断。
                  </p>
                )}
              </>
            )}
            {!result &&
              name === "exec_command" &&
              typeof args.command === "string" && (
                <ToolCode
                  source={args.command}
                  title="待执行命令"
                  language="bash"
                />
              )}
            {!result && !questions && (
              <p className="text-xs text-muted">
                {status === "waiting_approval"
                  ? "等待交互完成后继续。"
                  : "尚未收到工具结果。"}
              </p>
            )}
          </div>
        )}
      </ChatDisclosure>
    </div>
  );
}

export function readPlan(
  blocks: Extract<
    DurableRecord,
    { event_type: "tool/result" }
  >["data"]["content"],
): {
  explanation?: string;
  plan: { step: string; status: "pending" | "in_progress" | "completed" }[];
} | null {
  if (blocks.length !== 1 || blocks[0].type !== "text") return null;
  try {
    const value: unknown = JSON.parse(blocks[0].text);
    if (
      !value ||
      typeof value !== "object" ||
      !("plan" in value) ||
      !Array.isArray(value.plan) ||
      value.plan.length > 20 ||
      !value.plan.length
    )
      return null;
    if ("explanation" in value && typeof value.explanation !== "string")
      return null;
    if (
      !value.plan.every(
        (step: unknown) =>
          step &&
          typeof step === "object" &&
          "step" in step &&
          typeof step.step === "string" &&
          step.step.length <= 1000 &&
          "status" in step &&
          ["pending", "in_progress", "completed"].includes(String(step.status)),
      )
    )
      return null;
    return value as {
      explanation?: string;
      plan: { step: string; status: "pending" | "in_progress" | "completed" }[];
    };
  } catch {
    return null;
  }
}
