import type { DurableRecord } from "@/types/agent-events";
import type { Question } from "@/types/agents";
import { useState } from "react";
import { Circle, CircleCheck, LoaderCircle, X } from "lucide-react";
import { StatusHint, StatusNote } from "./status-hint";
import { diagnosticLines, diagnosticReason } from "../data/diagnostics";
import { isPapiTool, toolIconActive, toolSummary } from "../data/tool-summary";
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
  writeDiffFromContent,
} from "./tool-content";
export const builtinToolNames: Record<string, string> = {
  papi_list: "列出平台 API",
  papi_desc: "查看 API 用法",
  papi_call: "调用平台 API",
  web_search: "网络搜索",
  web_fetch: "网页读取",
  skill: "加载技能",
  ask_user_question: "向用户提问",
  update_plan: "更新任务计划",
  delegate: "委派临时子任务",
  read: "读取文件",
  read_tool_output: "读取工具输出",
  read_image: "读取图片",
  write: "写入文件",
  edit: "编辑文件",
  glob: "查找文件",
  grep: "检索文件内容",
  exec: "执行命令",
  task_list: "列出命令任务",
  task_output: "读取进程输出",
  task_kill: "停止命令任务",
  save_artifacts: "保存制品",
  load_artifacts: "载入制品",
  list_artifacts: "列出制品",
  show_artifacts: "展示制品",
};
export function ToolEvent({
  id,
  draft,
  rejected,
  call,
  result,
  taskStatus,
  reconciliation,
  status: liveStatus,
  question,
  sessionId,
  onIssue,
}: ToolNode & { sessionId: string; onIssue?: () => void }) {
  const [opened, setOpen] = useState<boolean | null>(null);
  const pendingQuestion = Boolean(
    question &&
    !question.answer &&
    ["waiting", "continued"].includes(question.status),
  );
  const open = opened ?? pendingQuestion;
  const [visited, setVisited] = useState(false);
  const status = result?.data.status ?? liveStatus;
  const { name, hint } = toolSummary({ call, draft, question });
  const args = call?.data.arguments ?? {};
  const papi = isPapiTool(name);
  const builtin = Boolean(
    call && !call.data.mcp_server_id && !call.data.mcp_binding_id,
  );
  const attention = toolNeedsAttention({
    id,
    call,
    result,
    status,
    taskStatus,
  });
  const snapshot = result?.data.sandbox_execution;
  const execution =
    snapshot && taskStatus
      ? {
          ...snapshot,
          state: taskStatus.state,
          exit_code: taskStatus.exit_code,
        }
      : snapshot;
  const failed = reconciliation
    ? reconciliation.data.observed_status === "failed"
    : status === "failed" ||
      (execution?.state === "completed" &&
        execution.exit_code !== null &&
        execution.exit_code !== 0);
  const knownSuccess = Boolean(
    result &&
    result.data.status === "succeeded" &&
    result.data.outcome.certainty === "known" &&
    !result.data.truncated,
  );
  const value =
    builtin && !papi && knownSuccess && result
      ? readToolObject(result.data.content)
      : null;
  const write =
    builtin &&
    name === "write" &&
    knownSuccess &&
    result?.data.executed === true
      ? result.data.file_write
      : undefined;
  const file = write
    ? {
        path: write.path,
        diff: write.diff || writeDiffFromContent(args.content),
      }
    : value &&
        result?.data.executed === true &&
        fileResultSupported(name, value)
      ? value
      : null;
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
    (taskStatus?.state === "running" ||
      (status && ["prepared", "dispatching", "running"].includes(status)));
  const verifiedStatus =
    taskStatus?.state === "completed"
      ? executionStatus(taskStatus)
      : reconciliation
        ? reconciliation.data.executed === false
          ? "确认未执行"
          : ({
              succeeded: "已核实结束",
              failed: "已核实失败",
              cancelled: "已确认停止",
            }[reconciliation.data.observed_status] ?? "已核实结束")
        : undefined;
  const label = rejected
    ? `${rejected.interrupted ? "生成已中断" : rejected.diagnostic?.code === "MODEL_TOOL_ARGUMENTS_SCHEMA_MISMATCH" ? "参数校验失败" : "调用未完成"} · 未执行`
    : draft
      ? draft.committed
        ? "正在准备调用"
        : "参数生成中"
      : (verifiedStatus ??
        (result?.data.outcome.certainty === "unknown"
          ? "结果未知"
          : execution
            ? `${status === "failed" ? "工具调用失败 · " : ""}${executionStatus(execution, !taskStatus)}`
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
              : "等待结果"));
  const specialized = Boolean(execution || file || plan || questions || search);
  return (
    <div
      id={`tool-${id}`}
      className={`agent-tool-event min-w-0 ${questions ? "agent-question-tool" : ""}`}
    >
      <ChatDisclosure
        open={open}
        onToggle={() => {
          setVisited(true);
          setOpen(!open);
        }}
        label={
          builtinToolNames[name] ??
          (name || (draft ? "准备工具调用" : "工具结果"))
        }
        active={Boolean(running) && !pendingQuestion}
        trailing={
          failed ? (
            onIssue ? (
              <button
                type="button"
                className="agent-tool-issue"
                aria-label="查看本轮工具异常"
                onClick={onIssue}
              >
                <X aria-hidden="true" />
              </button>
            ) : (
              <StatusHint
                label="工具调用失败原因"
                icon={<X aria-hidden="true" />}
                danger
              >
                {[
                  label,
                  diagnosticReason(
                    rejected?.diagnostic ?? result?.data.diagnostic,
                    rejected?.reason ?? result?.data.outcome.reason,
                  ),
                  ...diagnosticLines(
                    rejected?.diagnostic ?? result?.data.diagnostic,
                  ),
                ]
                  .filter(Boolean)
                  .join("\n")}
              </StatusHint>
            )
          ) : undefined
        }
        icon={
          <ActivityIcon
            name={name}
            active={toolIconActive(
              name,
              { call, result, status, rejected },
              Boolean(running) && !pendingQuestion,
            )}
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
              {typeof hint === "string" &&
              (name === "exec" ||
                rejected ||
                running ||
                (attention && !onIssue))
                ? ` · ${label}`
                : ""}
            </span>
          )
        }
      >
        {(visited || open) && (
          <div className="agent-tool-body min-w-0 space-y-3">
            {rejected && (
              <p className="text-xs text-muted">
                {[
                  label,
                  ...diagnosticLines(rejected.diagnostic),
                  rejected.truncated ? "参数仅保留开头预览。" : "",
                ]
                  .filter(Boolean)
                  .join("\n")}
              </p>
            )}
            {draft && (
              <pre className="max-h-60 overflow-auto whitespace-pre-wrap break-all text-xs">
                {draft.argumentsText}
              </pre>
            )}
            {papi && call?.data.arguments_text && (
              <ToolCode
                source={call.data.arguments_text}
                title="调用参数"
                language="json"
              />
            )}
            {!call && !question && !draft && (
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
            {file && <FileToolResult name={name} value={file} />}
            {search && (
              <div className="space-y-3">
                <p className="text-xs text-muted">
                  {search.count ? `${search.count} 项匹配` : "没有找到匹配项"}
                  {search.truncated ? " · 结果已截断" : ""}
                  {typeof value?.skipped_large_files === "number" &&
                    value.skipped_large_files > 0 &&
                    " · 跳过 " + value.skipped_large_files + " 个大文件"}
                  {value?.stop_reason === "byte_budget" &&
                    " · 已达到扫描字节上限"}
                  {value?.stop_reason === "scan_limit" &&
                    " · 已达到扫描条目上限"}
                </p>
                {search.text && (
                  <ToolCode source={search.text} title="匹配结果" />
                )}
              </div>
            )}
            {execution && (
              <SandboxExecutionResult
                execution={execution}
                currentStatus={Boolean(taskStatus)}
                logPath={`/sessions/${sessionId}/tool-calls/${id}/output`}
                verifiedStatus={verifiedStatus}
                diagnosticsInHeader={Boolean(onIssue)}
              />
            )}
            {!onIssue &&
              !reconciliation &&
              result?.data.outcome.certainty === "unknown" &&
              execution?.state !== "outcome_unknown" && (
                <StatusNote label="结果待核实">
                  实际执行结果尚未核实，不能据此认为操作没有发生。
                </StatusNote>
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
                {result.data.diagnostic && (
                  <div className="space-y-1 text-xs text-muted">
                    {reconciliation && <p>原工具调用诊断（核实前）</p>}
                    <p>
                      {diagnosticReason(
                        result.data.diagnostic,
                        result.data.outcome.reason,
                      )}
                    </p>
                    {diagnosticLines(result.data.diagnostic).map((line) => (
                      <p key={line}>{line}</p>
                    ))}
                  </div>
                )}
                {(!specialized || status !== "succeeded") && !execution && (
                  <ToolTextResult
                    blocks={result.data.content}
                    preserveSource={papi}
                  />
                )}
                <MessageContent
                  blocks={result.data.content.filter(
                    (block) =>
                      block.type !== "text" && block.type !== "tool_reference",
                  )}
                  sessionId={sessionId}
                />
                {result.data.output_file && (
                  <div className="agent-tool-output-reference">
                    <span>
                      已保留输出 ·{" "}
                      {Math.ceil(
                        Number(result.data.output_file.size_bytes) / 1024,
                      )}{" "}
                      KB
                    </span>
                    <a
                      href={`/api/v1/agents/files/${result.data.output_file.file_id}/content`}
                      download
                    >
                      下载完整记录
                    </a>
                    {result.data.source_truncated && (
                      <span>来源输出已有省略</span>
                    )}
                  </div>
                )}
                {result.data.truncated &&
                  !result.data.output_file &&
                  !execution?.truncated && (
                    <StatusNote label="输出已截断">
                      工具结果超过显示上限，已按服务端规则截断。
                    </StatusNote>
                  )}
              </>
            )}
            {!result && name === "exec" && typeof args.command === "string" && (
              <div>
                <p>
                  工作目录 ·{" "}
                  {typeof args.workdir === "string"
                    ? args.workdir
                    : "会话工作目录"}
                </p>
                <ToolCode
                  source={args.command}
                  title="待执行命令"
                  language="bash"
                />
              </div>
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
