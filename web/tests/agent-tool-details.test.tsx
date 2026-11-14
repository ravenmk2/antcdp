import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ToolEvent } from "@/features/agents/chat/tool-event";
import type { ToolNode } from "@/features/agents/data/conversation-projection";
import { question } from "./fixtures/agents";

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

function tool(
  name: string,
  args: Record<string, unknown>,
  output: unknown,
): ToolNode {
  const base = {
    schema_version: 1 as const,
    occurred_at: "2026-11-14T00:00:00Z",
    run_id: "1",
  };
  return {
    id: "8",
    status: "succeeded",
    call: {
      ...base,
      seq: "1",
      event_type: "tool/call",
      data: {
        tool_call_id: "8",
        tool_key: name,
        mcp_server_id: null,
        mcp_binding_id: null,
        mcp_tool_name: null,
        arguments: args,
        arguments_hash: "a".repeat(64),
        execution_class: "side_effect",
        policy: "allow",
      },
    },
    result: {
      ...base,
      seq: "2",
      event_type: "tool/result",
      data: {
        tool_call_id: "8",
        status: "succeeded",
        executed: true,
        content: [{ type: "text", text: JSON.stringify(output) }],
        truncated: false,
        outcome: { certainty: "known", reason: null },
      },
    },
  };
}

it("shows recorded file content, copies exact text and preserves it across folding", async () => {
  const user = userEvent.setup();
  const content = "<script>literal</script>\nalpha=1\n";
  const node = tool(
    "write_file",
    { path: "example.txt", content },
    {
      path: "/data/workspace/example.txt",
      size_bytes: "32",
      sha256: "receipt-sha",
    },
  );
  const { container } = render(<ToolEvent {...node} sessionId="1" />);
  expect(screen.queryByLabelText("写入内容")).not.toBeInTheDocument();
  await user.click(screen.getByText("写入文件"));
  expect(screen.getByLabelText("写入内容")).toHaveTextContent(
    "<script>literal</script>",
  );
  expect(container.querySelector("script")).toBeNull();
  expect(screen.queryByLabelText("调用参数")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "复制写入内容" }));
  expect(await navigator.clipboard.readText()).toBe(content);
  const output = screen.getByLabelText("写入内容");
  await user.click(screen.getByText("写入文件"));
  expect(output).not.toBeVisible();
  await user.click(screen.getByText("写入文件"));
  expect(screen.getByLabelText("写入内容")).toBe(output);
});

it("updates a reconciled tool in place without reopening it or showing the stale unknown warning", async () => {
  const node = tool("exec_command", { command: "sleep 90" }, "interrupted");
  node.result!.data.status = "outcome_unknown";
  node.result!.data.outcome.certainty = "unknown";
  const { rerender } = render(<ToolEvent {...node} sessionId="1" />);
  expect(screen.getByRole("button", { name: /结果未知/ })).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  node.reconciliation = {
    schema_version: 1,
    seq: "3",
    occurred_at: "2026-11-14T00:00:01Z",
    run_id: "1",
    event_type: "tool/reconciled",
    data: {
      tool_call_id: node.id,
      observed_status: "cancelled",
      executed: true,
      reason: "physical_execution_ended",
      observed_at: "2026-11-14T00:00:01Z",
      evidence_summary: "verified_adapter_observation",
    },
  };
  rerender(<ToolEvent {...node} sessionId="1" />);
  const trigger = screen.getByRole("button", { name: /已确认停止/ });
  expect(trigger).toHaveAttribute("aria-expanded", "false");
  await userEvent.setup().click(trigger);
  expect(screen.queryByText(/实际执行结果尚未核实/)).not.toBeInTheDocument();
  expect(node.result!.data.status).toBe("outcome_unknown");
});

it.each(["failed", "outcome_unknown", "truncated", "mcp"] as const)(
  "does not present %s file input as a successful write",
  async (kind) => {
    const node = tool(
      "write_file",
      { path: "example.txt", content: "unconfirmed" },
      { path: "/data/workspace/example.txt", error: "unconfirmed" },
    );
    if (kind === "failed" || kind === "outcome_unknown")
      node.result!.data.status = kind;
    if (kind === "outcome_unknown")
      node.result!.data.outcome.certainty = "unknown";
    if (kind === "truncated") node.result!.data.truncated = true;
    if (kind === "mcp") node.call!.data.mcp_server_id = "99";
    render(<ToolEvent {...node} sessionId="1" />);
    await userEvent.setup().click(screen.getByText("写入文件"));
    expect(screen.queryByLabelText("写入内容")).not.toBeInTheDocument();
    expect(screen.getByLabelText("返回内容")).toHaveTextContent("unconfirmed");
  },
);

it("shows replacement fragments without claiming a full-file diff", async () => {
  render(
    <ToolEvent
      {...tool(
        "edit_file",
        { path: "example.txt", old_text: "alpha=1", new_text: "alpha=3" },
        { path: "/data/workspace/example.txt", size_bytes: "15" },
      )}
      sessionId="1"
    />,
  );
  await userEvent.setup().click(screen.getByText("编辑文件"));
  expect(screen.getByLabelText("替换前片段")).toHaveTextContent("alpha=1");
  expect(screen.getByLabelText("替换后片段")).toHaveTextContent("alpha=3");
});

it("keeps partial read bounds and remaining-content notice visible", async () => {
  render(
    <ToolEvent
      {...tool(
        "read_file",
        { path: "example.txt", offset: 10 },
        {
          path: "/data/workspace/example.txt",
          text: "partial",
          offset: 10,
          next_offset: 17,
          size_bytes: "50",
          has_more: true,
        },
      )}
      sessionId="1"
    />,
  );
  await userEvent.setup().click(screen.getByText("读取文件"));
  expect(screen.getByLabelText("读取内容")).toHaveTextContent("partial");
  expect(screen.getByText(/字节范围 10–17/)).toHaveTextContent(
    "尚有未读取内容",
  );
});

it("shows readable grep matches with truncation and preserves unsupported result shapes", async () => {
  const node = tool(
    "grep",
    { pattern: "alpha", path: "." },
    {
      matches: [
        { path: "/data/workspace/example.txt", line: 2, text: "alpha=3" },
      ],
      truncated: true,
    },
  );
  const { rerender } = render(<ToolEvent {...node} sessionId="1" />);
  await userEvent.setup().click(screen.getByText("检索文件内容"));
  expect(screen.getByLabelText("匹配结果")).toHaveTextContent(
    "/data/workspace/example.txt:2: alpha=3",
  );
  expect(screen.getByText(/1 项匹配/)).toHaveTextContent("结果已截断");
  rerender(
    <ToolEvent
      {...tool(
        "grep",
        { pattern: "alpha" },
        { matches: [{ unexpected: "payload" }] },
      )}
      sessionId="1"
    />,
  );
  expect(screen.getByLabelText("返回内容")).toHaveTextContent("unexpected");
});

it("tolerates a successful plan state arriving before its result", async () => {
  const node = tool("update_plan", {}, {});
  node.result = undefined;
  render(<ToolEvent {...node} sessionId="1" />);
  await userEvent.setup().click(screen.getByText("更新任务计划"));
  expect(screen.getByText("尚未收到工具结果。")).toBeVisible();
});

it("shows question and answer pairs for waiting, multiple selections, late answers and skipped questions", async () => {
  if (question.kind !== "question")
    throw new Error("Expected question fixture");
  const node = tool("ask_user_question", { questions: question.questions }, {});
  const { rerender } = render(
    <ToolEvent
      {...node}
      question={{ ...question, status: "waiting" }}
      sessionId="1"
    />,
  );
  expect(screen.getByText("待回答")).toBeVisible();
  expect(screen.getByText("优先核对哪个环境？")).toBeVisible();
  rerender(
    <ToolEvent
      {...node}
      question={{
        ...question,
        status: "reply_queued",
        answer: {
          skip: false,
          answers: [
            {
              question_id: "q1",
              option_ids: ["test", "prod"],
              text: "都需要检查",
            },
          ],
        },
      }}
      sessionId="1"
    />,
  );
  await userEvent.setup().click(screen.getByText("向用户提问"));
  expect(screen.getByText("测试环境、生产环境、都需要检查")).toBeVisible();
  expect(screen.getByText("回答已排队，将在下一处理节点继续。")).toBeVisible();
  rerender(
    <ToolEvent
      {...node}
      question={{
        ...question,
        status: "answered",
        answer: { skip: true, answers: [] },
      }}
      sessionId="1"
    />,
  );
  expect(screen.getByText("已跳过", { exact: true })).toBeVisible();
  expect(
    screen.queryByText("测试环境、生产环境、都需要检查"),
  ).not.toBeInTheDocument();
});
