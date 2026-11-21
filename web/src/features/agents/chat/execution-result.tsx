import { useState } from "react";
import { request } from "@/api/client";
import { agentRoot } from "../data/agent-api";
import { StatusNote } from "./status-hint";
import type { SandboxExecution } from "@/types/agent-events";
import { ToolCode } from "./tool-content";

export function executionStatus(
  execution: Pick<SandboxExecution, "state" | "exit_code">,
  snapshotOnly = false,
): string {
  switch (execution.state) {
    case "running":
      return snapshotOnly ? "返回时运行中" : "进程运行中";
    case "outcome_unknown":
      return "实际结果待核实";
    case "cancel_requested":
      return "已请求停止";
    case "completed":
      return execution.exit_code === null
        ? "进程已结束 · 退出码未知"
        : `已结束 · 退出码 ${execution.exit_code}`;
  }
}
export function SandboxExecutionResult({
  execution,
  verifiedStatus,
  currentStatus = false,
  logPath,
  diagnosticsInHeader = false,
}: {
  execution: SandboxExecution;
  verifiedStatus?: string;
  currentStatus?: boolean;
  logPath?: string;
  diagnosticsInHeader?: boolean;
}) {
  const [page, setPage] = useState<CommandLogPage>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  async function readPage() {
    if (!logPath || loading) return;
    setLoading(true);
    setError("");
    try {
      const response = await request<CommandLogPage>(
        `${agentRoot}${logPath}?cursor=${page?.next_cursor ?? "0"}`,
      );
      const next = response.data;
      setPage({
        ...next,
        stdout: (page?.stdout ?? "") + next.stdout,
        stderr: (page?.stderr ?? "") + next.stderr,
      });
    } catch {
      setError("读取日志失败，请重试。");
    } finally {
      setLoading(false);
    }
  }
  const stdout = page?.stdout ?? execution.stdout,
    stderr = page?.stderr ?? execution.stderr;
  const canRead =
    logPath &&
    (page
      ? page.has_more || page.pending
      : execution.truncated ||
        execution.output_incomplete ||
        execution.output_pending ||
        execution.background);
  return (
    <section className="agent-terminal" aria-label="命令执行结果">
      <div className="agent-terminal-heading">
        <span className="min-w-0 truncate" title={execution.cwd}>
          工作目录 · {execution.cwd}
        </span>
        <span>任务 #{execution.task_id}</span>
        <span>{execution.background ? "后台进程" : "前台执行"}</span>
        <span>
          {verifiedStatus ?? executionStatus(execution, !currentStatus)}
        </span>
      </div>
      <ToolCode source={execution.command} title="命令" language="bash" />
      {!diagnosticsInHeader &&
        !verifiedStatus &&
        execution.state === "cancel_requested" && (
          <StatusNote label="停止待确认">
            停止请求已发出，尚未确认进程退出。
          </StatusNote>
        )}
      {!diagnosticsInHeader &&
        !verifiedStatus &&
        execution.state === "outcome_unknown" && (
          <StatusNote label="结果待核实">
            尚未确认实际执行结果，云电脑占用继续保留。不能认为命令未执行。
          </StatusNote>
        )}
      {stdout && <ToolCode source={stdout} title="标准输出" />}
      {stderr && (
        <div className="border-l-2 border-warning pl-3">
          <ToolCode source={stderr} title="标准错误" />
        </div>
      )}
      {!stdout && !stderr && (
        <p className="text-xs text-muted">本次观察没有返回输出。</p>
      )}
      {(page?.incomplete ?? execution.output_incomplete) && (
        <StatusNote label="日志不完整">
          采集已中断或超过留存上限，部分输出无法恢复。
        </StatusNote>
      )}
      {page?.pending && <p>仍在采集命令输出。</p>}
      {!page && execution.output_pending && (
        <p>工具返回时仍在采集输出，可读取已保存日志。</p>
      )}
      {!page && execution.truncated && (
        <StatusNote label="输出已截断">
          可使用 task_output 分段读取已保存的日志。
        </StatusNote>
      )}
      {canRead && (
        <button
          type="button"
          className="agent-tool-expand"
          disabled={loading}
          onClick={() => void readPage()}
        >
          {loading
            ? "读取中…"
            : !page
              ? "读取已保存日志"
              : page.has_more
                ? "读取下一页"
                : "读取新增输出"}
        </button>
      )}
      {error && <p role="alert">{error}</p>}
      {!currentStatus && execution.state !== "completed" && (
        <p className="text-xs text-muted">以上为该次工具返回时的状态。</p>
      )}
    </section>
  );
}

interface CommandLogPage {
  stdout: string;
  stderr: string;
  next_cursor: string;
  has_more: boolean;
  pending: boolean;
  incomplete: boolean;
}
