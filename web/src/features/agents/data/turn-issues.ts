import type { DurableRecord } from "@/types/agent-events";
import type { PresentedNode } from "./conversation-presentation";
import { runtimeReason } from "./runtime-reasons";
import { modelRetryStates } from "./model-retries";

export interface TurnIssue {
  id: string;
  source: string;
  state: "failed" | "pending" | "recovered" | "past";
  summary: string;
  reasons: string[];
  count: number;
  toolId?: string;
  step?: number;
}

/** Presentation only: retain all durable facts and never infer a physical outcome. */
export function turnIssues(records: DurableRecord[], nodes: PresentedNode[]) {
  const retries = modelRetryStates(records);
  const result = new Map<string, TurnIssue[]>();
  const ends = new Map<
    string,
    Extract<DurableRecord, { event_type: "run/ended" }>
  >();
  const settled = new Set<string>();
  const attempts = new Map<string, TurnIssue>();
  const pending = new Map<string, Set<TurnIssue>>();
  const add = (run: string, issue: TurnIssue) => {
    const items = result.get(run) ?? [];
    items.push(issue);
    result.set(run, items);
    return issue;
  };
  for (const record of records) {
    if (record.event_type === "run/settled") settled.add(record.data.run_id);
    const run = record.run_id;
    if (!run) continue;
    if (record.event_type === "run/ended") ends.set(run, record);
    if (record.event_type === "assistant/attempt") {
      const data = record.data;
      // Legacy records without step numbers must not merge unrelated attempts.
      const key = `${run}:${data.step_no ?? data.attempt_id}`;
      let issue = attempts.get(key);
      if (!issue) {
        issue = add(run, {
          id: `model:${key}`,
          source: "模型调用",
          state: "failed",
          summary: "模型调用未完成",
          reasons: [],
          count: 0,
          step: data.step_no,
        });
        attempts.set(key, issue);
      }
      issue.count++;
      const reason = runtimeReason(data.reason_code) || "模型响应未完整结束";
      if (!issue.reasons.includes(reason)) issue.reasons.push(reason);
      issue.state = data.retry ? "pending" : "failed";
      issue.summary = data.retry
        ? `${retries.get(data.attempt_id) === "running" ? "正在重试" : "等待重试"} · ${data.retry.number}/${data.retry.max_retries}`
        : "模型调用未完成";
      const active = pending.get(run) ?? new Set<TurnIssue>();
      active.add(issue);
      pending.set(run, active);
    }
    if (record.event_type === "assistant/message") {
      for (const issue of pending.get(run) ?? []) {
        if (issue.step !== undefined && record.data.step_no !== issue.step)
          continue;
        issue.state = "recovered";
        issue.summary = "模型响应已恢复";
      }
      for (const issue of pending.get(run) ?? []) {
        if (issue.state === "recovered") pending.get(run)?.delete(issue);
      }
    }
    if (
      record.event_type === "compaction/end" &&
      record.data.reason_code &&
      record.data.status !== "succeeded"
    ) {
      add(run, {
        id: `compaction:${record.data.compaction_id}`,
        source: "上下文压缩",
        state: "failed",
        summary: "压缩未完成",
        reasons: [runtimeReason(record.data.reason_code)],
        count: 1,
      });
    }
  }
  for (const node of nodes) {
    if (node.kind !== "process" || !node.runId) continue;
    const run = node.runId;
    for (const tool of node.tools) {
      const data = tool.result?.data;
      const execution = data?.sandbox_execution;
      const reconciled = tool.reconciliation?.data;
      const status = reconciled?.observed_status ?? data?.status ?? tool.status;
      const unknown =
        !reconciled &&
        (data?.outcome.certainty === "unknown" ||
          status === "outcome_unknown" ||
          execution?.state === "outcome_unknown" ||
          execution?.state === "cancel_requested" ||
          (Boolean(ends.get(run)) && execution?.state === "running"));
      const failed =
        status === "failed" ||
        (!reconciled &&
          execution?.state === "completed" &&
          execution.exit_code !== null &&
          execution.exit_code !== 0);
      const historical = Boolean(
        reconciled && data?.outcome.certainty === "unknown",
      );
      if (
        !unknown &&
        !failed &&
        status !== "blocked" &&
        status !== "cancelled" &&
        !historical
      )
        continue;
      const reason = reconciled?.reason ?? data?.outcome.reason;
      const reasons = reason ? [runtimeReason(reason)] : [];
      if (
        execution?.state === "completed" &&
        execution.exit_code !== null &&
        execution.exit_code !== 0 &&
        !reconciled
      )
        reasons.push(`命令退出码 ${execution.exit_code}`);
      if (unknown)
        reasons.push("实际执行结果尚未确认，请先核实，再决定是否重复执行。");
      add(run, {
        id: `tool:${tool.id}`,
        toolId: tool.id,
        source: tool.call?.data.tool_key ?? "工具调用",
        state: unknown
          ? "pending"
          : historical && !failed
            ? "recovered"
            : ends.get(run)?.data.status === "succeeded"
              ? "past"
              : "failed",
        summary: unknown
          ? "结果待核实"
          : historical && !failed
            ? "已核实结束"
            : failed
              ? "工具执行失败"
              : status === "blocked"
                ? "未获准执行"
                : "工具已取消",
        reasons,
        count: 1,
      });
    }
  }
  for (const [run, end] of ends) {
    const items = result.get(run) ?? [];
    for (const issue of pending.get(run) ?? []) {
      issue.state =
        end.data.status === "succeeded"
          ? "past"
          : end.data.status === "cancelled"
            ? "past"
            : "failed";
      issue.summary = "模型调用未完成";
    }
    const reason = end.data.reason_code;
    if (["failed", "interrupted", "cancelled"].includes(end.data.status)) {
      const explained = items.some(
        (item) =>
          item.state !== "recovered" &&
          item.state !== "past" &&
          (item.reasons.includes(runtimeReason(reason)) ||
            !reason ||
            ["EXECUTION_FAILED", "MODEL_REQUEST_FAILED"].includes(reason)),
      );
      if (!explained)
        add(run, {
          id: `run:${run}`,
          source: "本轮执行",
          state: end.data.status === "cancelled" ? "past" : "failed",
          summary:
            end.data.status === "cancelled" ? "本轮已停止" : "本轮未完成",
          reasons: [runtimeReason(reason) || "本次任务未完整结束"],
          count: 1,
        });
    }
    if (
      !settled.has(run) &&
      !["settled", "none"].includes(end.data.physical_activity_state) &&
      !items.some((item) => item.toolId && item.state === "pending")
    ) {
      add(run, {
        id: `physical:${run}`,
        source: "工作环境",
        state: "pending",
        summary: "环境活动仍需核实",
        reasons: [
          "本轮已结束，工作环境中的活动尚未全部确认结束。请先核实进程状态，再决定是否重复执行。",
        ],
        count: 1,
      });
    }
  }
  const priority = { pending: 0, failed: 1, recovered: 2, past: 3 };
  for (const items of result.values())
    items.sort((a, b) => priority[a.state] - priority[b.state]);
  return result;
}
