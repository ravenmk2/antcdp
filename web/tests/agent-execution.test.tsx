import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SandboxExecutionResult } from "@/features/agents/chat/execution-result";
import { validRecord } from "@/features/agents/data/stream-reducer";
import type { DurableRecord, SandboxExecution } from "@/types/agent-events";

vi.mock("@/app/theme", () => ({ useTheme: () => ({ resolved: "light" }) }));
beforeEach(() =>
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  ),
);
afterEach(() => vi.unstubAllGlobals());

const execution: SandboxExecution = {
  execution_id: "process-41",
  cloud_computer_id: "9",
  command: "printf 'public test'",
  cwd: "/data/sessions/10",
  background: true,
  state: "running",
  exit_code: null,
  stdout: "public test",
  stderr: "",
  truncated: false,
};
it("distinguishes a running background process from a completed tool invocation", () => {
  render(<SandboxExecutionResult execution={execution} />);
  expect(screen.getByText("进程运行中")).toBeVisible();
  expect(screen.queryByText(/退出码/)).not.toBeInTheDocument();
  expect(screen.getByText(/以上为该次工具返回时的状态/)).toBeVisible();
});
it("does not claim a cancel request has stopped the process", () => {
  render(
    <SandboxExecutionResult
      execution={{ ...execution, state: "cancel_requested" }}
    />,
  );
  expect(screen.getByText("停止请求已发出，尚未确认进程退出。")).toBeVisible();
  expect(screen.queryByText("进程已结束")).not.toBeInTheDocument();
});
it("keeps long output literal, copyable and wrapped with truncation and unknown warnings", async () => {
  const user = userEvent.setup();
  const output = "<script>doNotExecute()</script>\n".repeat(100);
  const { container } = render(
    <SandboxExecutionResult
      execution={{
        ...execution,
        state: "outcome_unknown",
        stdout: output,
        truncated: true,
      }}
    />,
  );
  expect(container.querySelector("script")).toBeNull();
  expect(screen.getByLabelText("标准输出")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "复制标准输出" }));
  expect(await navigator.clipboard.readText()).toBe(output);
  await user.click(screen.getByRole("button", { name: "标准输出自动换行" }));
  expect(screen.getByLabelText("标准输出")).toHaveAttribute(
    "data-wrapped",
    "true",
  );
  expect(
    screen.getByText("输出已按服务端上限截断，不代表完整进程输出。"),
  ).toBeVisible();
  expect(screen.getByText(/云电脑占用继续保留/)).toBeVisible();
});
it("reports nonzero and missing exit codes instead of a successful completion", () => {
  const { rerender } = render(
    <SandboxExecutionResult
      execution={{
        ...execution,
        state: "completed",
        exit_code: 7,
        stderr: "expected failure",
      }}
    />,
  );
  expect(screen.getByText("退出码 7")).toBeVisible();
  expect(screen.getByLabelText("标准错误")).toHaveTextContent(
    "expected failure",
  );
  rerender(
    <SandboxExecutionResult
      execution={{ ...execution, state: "completed", exit_code: null }}
    />,
  );
  expect(screen.getByText("进程已结束 · 退出码未知")).toBeVisible();
});
it("validates explicit execution metadata while leaving ordinary text JSON unclassified", () => {
  const event: DurableRecord = {
    schema_version: 1,
    seq: "4",
    occurred_at: "2026-11-09T00:00:00Z",
    run_id: "20",
    event_type: "tool/result",
    data: {
      tool_call_id: "8",
      status: "succeeded",
      executed: true,
      content: [{ type: "text", text: JSON.stringify(execution) }],
      truncated: false,
      outcome: { certainty: "known", reason: null },
    },
  };
  expect(validRecord(event)).toBe(true);
  expect(event.data).not.toHaveProperty("sandbox_execution");
  event.data.sandbox_execution = execution;
  expect(validRecord(event)).toBe(true);
  expect(
    validRecord({
      ...event,
      data: {
        ...event.data,
        sandbox_execution: { ...execution, stdout: null },
      },
    } as unknown as DurableRecord),
  ).toBe(false);
});
