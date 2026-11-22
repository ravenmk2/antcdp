import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ToolEvent } from "@/features/agents/chat/tool-event";
import activityIconStyles from "@/features/agents/chat/activity-icon.module.css";
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

it("animates a live PAPI call and preserves the exact historical JSON", async () => {
  const args =
    '{"api":"echo","args":{ "n":9007199254740993,"d":0.1234567890123456789 }}';
  const output = '{ "n":9007199254740993,"d":0.1234567890123456789 }';
  const node = tool("papi_call", { api: "echo", args: {} }, {});
  node.call!.data.arguments_text = args;
  node.result!.data.content = [{ type: "text", text: output }];
  const { container, rerender } = render(
    <ToolEvent {...node} result={undefined} status="prepared" sessionId="1" />,
  );
  const icon = () =>
    container.querySelector(".activity-papi-signal")?.closest("svg");
  expect(icon()).not.toHaveClass(activityIconStyles.active);
  rerender(
    <ToolEvent {...node} result={undefined} status="running" sessionId="1" />,
  );
  expect(icon()).toHaveClass(activityIconStyles.active);
  await userEvent
    .setup()
    .click(screen.getByRole("button", { name: /调用平台 API.*echo/ }));
  expect(screen.getByLabelText("调用参数").textContent).toBe(args);
  rerender(<ToolEvent {...node} status="running" sessionId="1" />);
  expect(icon()).not.toHaveClass(activityIconStyles.active);
  expect(screen.getByLabelText("返回内容").textContent).toBe(output);
});

it("uses distinct static icons for PAPI listing and description", () => {
  const { container, rerender } = render(
    <ToolEvent
      {...tool("papi_list", {}, {})}
      status="running"
      result={undefined}
      sessionId="1"
    />,
  );
  expect(container.querySelector("svg.lucide-list-tree")).toBeInTheDocument();
  expect(container.querySelector("svg.lucide-list-tree")).not.toHaveClass(
    activityIconStyles.active,
  );
  rerender(
    <ToolEvent
      {...tool("papi_desc", { api: "echo" }, {})}
      status="running"
      result={undefined}
      sessionId="1"
    />,
  );
  expect(container.querySelector("svg.lucide-file-text")).toBeInTheDocument();
  expect(container.querySelector("svg.lucide-file-text")).not.toHaveClass(
    activityIconStyles.active,
  );
});

it("opens a failure hint independently from the tool disclosure", async () => {
  const node = tool("read", { path: "missing.txt" }, "file unavailable");
  node.result!.data.status = "failed";
  node.result!.data.outcome.reason = "FILE_NOT_FOUND";
  const user = userEvent.setup();
  render(<ToolEvent {...node} sessionId="1" />);
  const disclosure = screen.getByRole("button", {
    name: /读取文件\s*missing.txt/,
  });
  const hint = screen.getByRole("button", { name: "工具调用失败原因" });
  expect(disclosure).not.toContainElement(hint);
  await user.click(hint);
  expect(await screen.findByRole("tooltip")).toHaveTextContent(
    "FILE_NOT_FOUND",
  );
  expect(disclosure).toHaveAttribute("aria-expanded", "false");
  await user.keyboard("{Escape}");
  await user.click(disclosure);
  expect(screen.getByLabelText("返回内容")).toBeVisible();
  expect(screen.getByLabelText("返回内容")).toHaveAttribute(
    "data-wrapped",
    "true",
  );
});

it("shows a new file from the write arguments and preserves its preview across folding", async () => {
  const user = userEvent.setup();
  const content = "<script>literal</script>\nalpha=1\n";
  const node = tool(
    "write",
    { file_path: "example.txt", content },
    "Created file",
  );
  node.result!.data.file_write = {
    path: "/data/workspace/example.txt",
    operation: "create",
    diff: "",
  };
  const { container } = render(<ToolEvent {...node} sessionId="1" />);
  expect(screen.queryByLabelText("文件差异")).not.toBeInTheDocument();
  await user.click(screen.getByText("写入文件"));
  expect(screen.getByLabelText("文件差异")).toHaveTextContent(
    "<script>literal</script>",
  );
  expect(container.querySelector("script")).toBeNull();
  expect(screen.queryByLabelText("调用参数")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "复制文件差异" }));
  expect(await navigator.clipboard.readText()).toBe(
    "+<script>literal</script>\n+alpha=1\n",
  );
  const output = screen.getByLabelText("文件差异");
  await user.click(screen.getByText("写入文件"));
  expect(output).not.toBeVisible();
  await user.click(screen.getByText("写入文件"));
  expect(screen.getByLabelText("文件差异")).toBe(output);
});

it("uses the applied overwrite diff from the result event", async () => {
  const node = tool(
    "write",
    { file_path: "example.txt", content: "new\n" },
    "Updated file",
  );
  const path = "/data/workspace/example.txt";
  node.result!.data.file_write = {
    path,
    operation: "update",
    diff: `--- ${path}\n+++ ${path}\n@@ -0,0 +1 @@\n+new\n`,
  };
  render(<ToolEvent {...node} sessionId="1" />);
  await userEvent.setup().click(screen.getByText("写入文件"));
  expect(screen.getByLabelText("文件差异")).toHaveTextContent("@@ -0,0 +1 @@");
  expect(screen.getByLabelText("文件差异")).toHaveTextContent("+new");
});

it("updates a reconciled tool in place without reopening it or showing the stale unknown warning", async () => {
  const node = tool("exec", { command: "sleep 90" }, "interrupted");
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
      "write",
      { file_path: "example.txt", content: "unconfirmed" },
      { path: "/data/workspace/example.txt", error: "unconfirmed" },
    );
    node.result!.data.file_write = {
      path: "/data/workspace/example.txt",
      operation: "create",
      diff: "",
    };
    if (kind === "failed" || kind === "outcome_unknown")
      node.result!.data.status = kind;
    if (kind === "outcome_unknown")
      node.result!.data.outcome.certainty = "unknown";
    if (kind === "truncated") node.result!.data.truncated = true;
    if (kind === "mcp") node.call!.data.mcp_server_id = "99";
    render(<ToolEvent {...node} sessionId="1" />);
    await userEvent.setup().click(screen.getByText("写入文件"));
    expect(screen.queryByLabelText("文件差异")).not.toBeInTheDocument();
    expect(screen.getByLabelText("返回内容")).toHaveTextContent("unconfirmed");
  },
);

it("highlights removed and added lines from the recorded diff", async () => {
  render(
    <ToolEvent
      {...tool(
        "edit",
        { path: "example.txt", old_text: "alpha=1", new_text: "alpha=3" },
        {
          path: "/data/workspace/example.txt",
          diff: "@@ -1 +1 @@\n-alpha=1\n+alpha=3",
        },
      )}
      sessionId="1"
    />,
  );
  await userEvent.setup().click(screen.getByText("编辑文件"));
  expect(screen.getByText("-alpha=1")).toHaveClass("text-destructive");
  expect(screen.getByText("+alpha=3")).toHaveClass("text-success");
});

it("keeps partial read bounds and remaining-content notice visible", async () => {
  render(
    <ToolEvent
      {...tool(
        "read",
        { path: "example.txt", offset: 10 },
        {
          path: "/data/workspace/example.txt",
          text: "10 | partial",
          has_more: true,
        },
      )}
      sessionId="1"
    />,
  );
  await userEvent.setup().click(screen.getByText("读取文件"));
  expect(screen.getByLabelText("读取内容")).toHaveTextContent("partial");
  expect(screen.getByText("尚有未读取内容")).toBeVisible();
});

it("shows readable grep matches with truncation and preserves unsupported result shapes", async () => {
  const node = tool(
    "grep",
    { pattern: "alpha", path: "." },
    {
      groups: [
        {
          path: "/data/workspace/example.txt",
          lines: [{ line: 2, text: "alpha=3" }],
        },
      ],
      truncated: true,
    },
  );
  const { rerender } = render(<ToolEvent {...node} sessionId="1" />);
  await userEvent.setup().click(screen.getByText("检索文件内容"));
  expect(screen.getByLabelText("匹配结果")).toHaveTextContent(
    "/data/workspace/example.txt 2: alpha=3",
  );
  expect(screen.getByText(/1 项匹配/)).toHaveTextContent("结果已截断");
  rerender(
    <ToolEvent
      {...tool(
        "grep",
        { pattern: "alpha" },
        { groups: [{ unexpected: "payload" }] },
      )}
      sessionId="1"
    />,
  );
  expect(screen.getByLabelText("返回内容")).toHaveTextContent("unexpected");
});

it("tolerates a successful plan state arriving before its result", async () => {
  const node = tool("todo_write", {}, {});
  node.result = undefined;
  render(<ToolEvent {...node} sessionId="1" />);
  await userEvent.setup().click(screen.getByText("更新待办"));
  expect(screen.queryByText("尚未收到工具结果。")).toBeNull();
});

it("shows question and answer pairs for waiting, multiple selections, late answers and skipped questions", async () => {
  if (question.kind !== "question")
    throw new Error("Expected question fixture");
  const node = tool("ask_question", { questions: question.questions }, {});
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
          answers: [
            {
              status: "answered",
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
        answer: {
          answers: [
            {
              status: "skipped",
              question_id: "q1",
              option_ids: [],
              text: null,
            },
          ],
        },
      }}
      sessionId="1"
    />,
  );
  expect(screen.getByText("已跳过", { exact: true })).toBeVisible();
  expect(
    screen.queryByText("测试环境、生产环境、都需要检查"),
  ).not.toBeInTheDocument();
});

it("highlights applied file changes from the tool result", async () => {
  const node = tool(
    "edit",
    { file_path: "a", old_string: "old", new_string: "new" },
    { path: "/data/home/a", diff: "@@ -1 +1 @@\n-old\n+new" },
  );
  render(<ToolEvent {...node} sessionId="1" />);
  await userEvent
    .setup()
    .click(screen.getByRole("button", { name: /编辑文件/ }));
  expect(screen.getByLabelText("文件差异")).toHaveTextContent("+new");
  expect(screen.getByText("-old")).toHaveClass("text-destructive");
  expect(screen.getByText("+new")).toHaveClass("text-success");
});

it("shows a background child report on its original card", async () => {
  const node = tool(
    "subagent",
    { task: "Review the file", background: true },
    {},
  );
  node.result!.data.child_started = {
    child_id: "3",
    session_id: "4",
    description: "Review",
    status: "started",
  };
  const onChild = vi.fn();
  const { rerender } = render(
    <ToolEvent {...node} sessionId="1" onChild={onChild} />,
  );
  await userEvent.setup().click(screen.getByText("委派临时子任务"));
  expect(screen.getByText("子助手运行中")).toBeTruthy();
  node.report = {
    source: "subagent",
    child_id: "3",
    session_id: "4",
    run_id: "3",
    tool_call_id: "8",
    description: "Review",
    status: "succeeded",
    reason_code: null,
    result_summary: "Reviewed the file",
    artifact_ids: [],
  };
  rerender(<ToolEvent {...node} sessionId="1" onChild={onChild} />);
  expect(screen.getByText("Reviewed the file")).toBeTruthy();
  await userEvent.setup().click(screen.getByText("查看子任务详情"));
  expect(onChild).toHaveBeenCalledWith("4");
});
