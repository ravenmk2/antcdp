import { Notice } from "@/components/feedback";
import type { SandboxExecution } from "@/types/agent-events";
import { ToolCode } from "./tool-content";

export function executionStatus(execution: SandboxExecution): string {
  switch (execution.state) {
    case "running":
      return "进程运行中";
    case "outcome_unknown":
      return "实际结果待核实";
    case "cancel_requested":
      return "已请求停止";
    case "completed":
      return execution.exit_code === null
        ? "进程已结束 · 退出码未知"
        : `退出码 ${execution.exit_code}`;
  }
}
export function SandboxExecutionResult({
  execution,
  verifiedStatus,
}: {
  execution: SandboxExecution;
  verifiedStatus?: string;
}) {
  return (
    <section className="agent-terminal" aria-label="命令执行结果">
      <div className="agent-terminal-heading">
        <span className="min-w-0 truncate" title={execution.cwd}>
          {execution.cwd}
        </span>
        <span>{execution.background ? "后台进程" : "前台执行"}</span>
        <span>{verifiedStatus ?? executionStatus(execution)}</span>
      </div>
      <ToolCode source={execution.command} title="命令" language="bash" />
      {!verifiedStatus && execution.state === "cancel_requested" && (
        <Notice>停止请求已发出，尚未确认进程退出。</Notice>
      )}
      {!verifiedStatus && execution.state === "outcome_unknown" && (
        <Notice tone="warning">
          尚未确认实际执行结果，云电脑占用继续保留。不能认为命令未执行。
        </Notice>
      )}
      {execution.stdout && (
        <ToolCode source={execution.stdout} title="标准输出" />
      )}
      {execution.stderr && (
        <div className="border-l-2 border-warning pl-3">
          <ToolCode source={execution.stderr} title="标准错误" />
        </div>
      )}
      {!execution.stdout && !execution.stderr && (
        <p className="text-xs text-muted">本次观察没有返回输出。</p>
      )}
      {execution.truncated && (
        <Notice tone="warning">
          输出已按服务端上限截断，不代表完整进程输出。
        </Notice>
      )}
      {execution.state !== "completed" && (
        <p className="text-xs text-muted">以上为该次工具返回时的状态。</p>
      )}
    </section>
  );
}
