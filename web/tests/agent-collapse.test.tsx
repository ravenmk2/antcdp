import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ConversationTimeline } from "@/features/agents/chat/timeline";
import type { ActiveAttempt, DurableRecord } from "@/types/agent-events";
import { records } from "./fixtures/agents";

vi.mock("@/app/auth", () => ({ useSession: () => ({ user: { id: "1" } }) }));
vi.mock("@/app/theme", () => ({ useTheme: () => ({ resolved: "light" }) }));
beforeEach(() => {
  for (const name of ["IntersectionObserver", "ResizeObserver"])
    vi.stubGlobal(
      name,
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
});
afterEach(() => vi.unstubAllGlobals());

const thought: Extract<DurableRecord, { event_type: "assistant/message" }> = {
  ...records[0],
  seq: "2",
  event_type: "assistant/message",
  data: {
    attempt_id: "thought",
    model_call_id: "30",
    finish_reason: "tool_calls",
    content: [{ type: "reasoning", text: "核对文件内容", duration_ms: 1000 }],
  },
};
const call: Extract<DurableRecord, { event_type: "tool/call" }> = {
  ...records[0],
  seq: "3",
  event_type: "tool/call",
  data: {
    tool_call_id: "80",
    tool_key: "read",
    mcp_server_id: null,
    mcp_binding_id: null,
    mcp_tool_name: null,
    arguments: { path: "example.txt" },
    arguments_hash: "hash",
    execution_class: "read_only",
    policy: "allow",
  },
};
const result: Extract<DurableRecord, { event_type: "tool/result" }> = {
  ...call,
  seq: "4",
  event_type: "tool/result",
  data: {
    tool_call_id: "80",
    status: "succeeded",
    executed: true,
    content: [{ type: "text", text: "文件结果" }],
    truncated: false,
    outcome: { certainty: "known", reason: null },
  },
};
const history = [records[0], thought, call, result];
const reply: DurableRecord = { ...records[1], seq: "5" };
const end = { ...records[2], seq: "6" } as Extract<
  DurableRecord,
  { event_type: "run/ended" }
>;
const draft: ActiveAttempt = {
  run_id: "20",
  attempt_id: "next",
  step: 2,
  next_index: 1,
  content: [{ type: "reasoning", text: "整理结果" }],
};

function setup(
  initial: DurableRecord[] = history,
  attempt: ActiveAttempt | null = null,
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const view = (
    events: DurableRecord[],
    live: ActiveAttempt | null,
    key = "page",
    sessionId = "10",
    pauseAutoCollapse = false,
  ) => (
    <QueryClientProvider client={client}>
      <ConversationTimeline
        key={key}
        records={events}
        sessionId={sessionId}
        attempt={live}
        pauseAutoCollapse={pauseAutoCollapse}
      />
    </QueryClientProvider>
  );
  const rendered = render(view(initial, attempt));
  return {
    user: userEvent.setup(),
    update: (
      events: DurableRecord[],
      live: ActiveAttempt | null = null,
      key = "page",
      sessionId = "10",
      pauseAutoCollapse = false,
    ) =>
      rendered.rerender(view(events, live, key, sessionId, pauseAutoCollapse)),
  };
}
const group = () =>
  within(screen.getByRole("region", { name: "工具过程" })).getAllByRole(
    "button",
  )[0];
const turn = () => screen.getByRole("button", { name: / · 执行过程$/ });

it("keeps a rejected streamed tool mounted, updates its status and restores it from history", async () => {
  const live: ActiveAttempt = {
    ...draft,
    content: [
      {
        type: "tool_call",
        draft_call_id: "draft-0",
        name: "exec",
        arguments_text: '{"command":"pwd","wait_ms":600001}',
      },
    ],
  };
  const { update, user } = setup([records[0]], live);
  await user.click(group());
  const button = screen.getByRole("button", { name: /执行命令.*pwd/ });
  await user.click(button);
  const rejected: Extract<DurableRecord, { event_type: "assistant/attempt" }> =
    {
      ...records[0],
      seq: "3",
      event_type: "assistant/attempt",
      data: {
        attempt_id: live.attempt_id,
        model_call_id: "30",
        status: "failed",
        content: [],
        partial: false,
        reason_code: "MODEL_RESPONSE_INVALID",
        diagnostic: {
          code: "MODEL_TOOL_ARGUMENTS_SCHEMA_MISMATCH",
          tool_name: "exec",
          field_path: "/wait_ms",
          constraint: "maximum",
          expected: "600000",
        },
        rejected_tools: [
          {
            name: "exec",
            arguments_text: '{"command":"pwd","wait_ms":600001}',
            truncated: false,
          },
        ],
      },
    };
  update([records[0], rejected]);
  expect(screen.getByRole("button", { name: /执行命令.*pwd/ })).toBe(button);
  expect(button).toHaveTextContent("参数校验失败 · 未执行");
  expect(button).toHaveAttribute("aria-expanded", "true");
  expect(screen.getByText(/参数字段：\/wait_ms/)).toBeVisible();
  expect(screen.queryByText("尚未收到工具结果。")).toBeNull();
  update([records[0], rejected], null, "reload");
  await user.click(group());
  expect(
    screen.getByRole("button", { name: /执行命令.*pwd/ }),
  ).toHaveTextContent("未执行");
});

it("does not render empty stream text as a placeholder or split the process group", async () => {
  const first: ActiveAttempt = {
    ...draft,
    content: [
      { type: "reasoning", text: "准备读取文件" },
      { type: "text", text: "\n " },
      {
        type: "tool_call",
        draft_call_id: "draft-0",
        name: "read",
        arguments_text: '{"path":"example.txt"}',
      },
    ],
  };
  const { update, user } = setup([records[0]], first);
  expect(screen.queryByText(/暂无介绍/)).toBeNull();
  expect(screen.queryByRole("region", { name: "思考过程" })).toBeNull();
  const region = screen.getByRole("region", { name: "工具过程" });
  expect(group()).toHaveAttribute("aria-expanded", "false");
  expect(within(region).queryByRole("button", { name: "思考中" })).toBeNull();
  await user.click(group());
  expect(within(region).getByRole("button", { name: "思考中" })).toBeVisible();
  expect(
    within(region).getByRole("button", { name: /读取文件/ }),
  ).toBeVisible();
  update([records[0]], {
    ...first,
    next_index: 2,
    content: first.content.map((block) =>
      block.type === "text" ? { ...block, text: "\n读取前的进度说明" } : block,
    ),
  });
  expect(screen.getByText("读取前的进度说明")).toBeVisible();
  expect(screen.getByRole("region", { name: "工具过程" })).toBe(region);
  expect(screen.queryByText(/暂无介绍/)).toBeNull();
});

it("previews live file work only while collapsed and removes the preview at completion", async () => {
  const first: ActiveAttempt = {
    ...draft,
    attempt_id: "thought",
    content: [
      {
        type: "tool_call",
        draft_call_id: "draft-0",
        name: "write",
        arguments_text: '{"path":"reports/result.txt","content":"unfinished',
      },
    ],
  };
  const { user, update } = setup([records[0]], first);
  const header = group();
  expect(header).toHaveAttribute("aria-expanded", "false");
  expect(header).toHaveTextContent("写入文件 · reports/result.txt");
  await user.click(header);
  expect(header).toHaveAttribute("aria-expanded", "true");
  expect(header).not.toHaveTextContent(/写入文件|reports\/result.txt/);
  const tool = screen.getByRole("button", {
    name: /写入文件\s*reports\/result.txt/,
  });
  expect(tool).toBeVisible();
  await user.click(header);
  expect(header).toHaveTextContent("写入文件 · reports/result.txt");
  expect(header).toHaveAttribute("aria-expanded", "false");
  const saved: typeof thought = {
    ...thought,
    data: {
      ...thought.data,
      content: [{ type: "tool_reference", tool_call_id: "80" }],
    },
  };
  const written: typeof call = {
    ...call,
    data: {
      ...call.data,
      model_call_id: "thought",
      call_ordinal: 0,
      tool_key: "write",
      arguments: { path: "reports/result.txt", content: "done" },
    },
  };
  update([records[0], saved, written]);
  expect(group()).toBe(header);
  expect(header).toHaveTextContent("写入文件 · reports/result.txt");
  await user.click(header);
  expect(header).not.toHaveTextContent("reports/result.txt");
  expect(
    screen.getByRole("button", { name: /^写入文件\s*reports\/result.txt/ }),
  ).toBe(tool);
  await user.click(header);
  update([records[0], saved, written, result, reply]);
  expect(group()).toBe(header);
  expect(header).toHaveAttribute("aria-expanded", "false");
  expect(header).not.toHaveTextContent(/写入文件|reports\/result.txt/);
  update([records[0], saved, written, result, reply, end]);
  await user.click(turn());
  expect(group()).not.toHaveTextContent(/写入文件|reports\/result.txt/);
});

it("previews running reasoning only while collapsed and hides historical previews", async () => {
  const { user, update } = setup([records[0]], draft);
  const region = screen.getByRole("region", { name: "思考过程" });
  const header = within(region).getAllByRole("button")[0];
  expect(header).toHaveAttribute("aria-expanded", "false");
  expect(header).toHaveTextContent("整理结果");
  await user.click(header);
  expect(header).not.toHaveTextContent("整理结果");
  update([records[0], thought, reply, end], null, "refresh");
  await user.click(turn());
  const savedHeader = within(
    screen.getByRole("region", { name: "思考过程" }),
  ).getAllByRole("button")[0];
  expect(savedHeader).toHaveAttribute("aria-expanded", "false");
  expect(savedHeader).not.toHaveTextContent("核对文件内容");
});

it.each(["succeeded", "failed", "cancelled"] as const)(
  "automatically collapses a %s turn and restores both folds collapsed on refresh",
  async (status) => {
    const { user, update } = setup();
    expect(group()).toHaveAttribute("aria-expanded", "false");
    const finished = [
      ...history,
      reply,
      { ...end, data: { ...end.data, status } },
    ];
    update(finished);
    expect(turn()).toHaveAttribute("aria-expanded", "false");
    if (status === "succeeded")
      expect(screen.getByText("已完成配置核对。")).toBeVisible();
    await user.click(turn());
    expect(group()).toHaveAttribute("aria-expanded", "false");
    await user.click(group());
    expect(group()).toHaveAttribute("aria-expanded", "true");
    update(structuredClone(finished), null, "refresh");
    expect(turn()).toHaveAttribute("aria-expanded", "false");
    await user.click(turn());
    expect(group()).toHaveAttribute("aria-expanded", "false");
  },
);

it("keeps a group folded through tool results and reasoning while reply text streams", () => {
  const { update } = setup(history.slice(0, 3));
  expect(group()).toHaveAttribute("aria-expanded", "false");
  update(history); // A tool result alone is not a group boundary.
  expect(group()).toHaveAttribute("aria-expanded", "false");
  update(history, draft);
  expect(group()).toHaveAttribute("aria-expanded", "false");
  update(history, {
    ...draft,
    content: [
      { type: "reasoning", text: "整理结果", duration_ms: 1000 },
      { type: "text", text: "后续正文" },
    ],
  });
  expect(group()).toHaveAttribute("aria-expanded", "false");
  expect(screen.getByText("后续正文")).toBeVisible();
  update([...history, reply]);
  expect(group()).toHaveAttribute("aria-expanded", "false");
  expect(screen.queryByRole("button", { name: / · 执行过程$/ })).toBeNull();
});

it("keeps the folded preview of a bounded group until its outstanding tool returns", () => {
  const { update } = setup([...history.slice(0, 3), reply]);
  expect(group()).toHaveAttribute("aria-expanded", "false");
  expect(group()).toHaveTextContent("读取文件 · example.txt");
  update([...history, reply]);
  expect(group()).toHaveAttribute("aria-expanded", "false");
  expect(group()).not.toHaveTextContent("example.txt");
});

it.each(["group", "thought", "tool"])(
  "protects manually opened %s and its ancestors through completion and replay",
  async (target) => {
    const { user, update } = setup();
    await user.click(group());
    if (target !== "group")
      await user.click(
        screen.getByRole("button", {
          name: target === "thought" ? /思考.*·/ : /读取文件/,
        }),
      );
    const finished = [...history, reply, end];
    update(finished);
    expect(turn()).toHaveAttribute("aria-expanded", "true");
    expect(group()).toHaveAttribute("aria-expanded", "true");
    update(structuredClone(finished)); // Snapshot replacement does not erase intent.
    expect(turn()).toHaveAttribute("aria-expanded", "true");
    update([
      { ...records[2], seq: "0", run_id: "older" },
      ...structuredClone(finished),
    ]);
    const activeTurn = screen
      .getAllByRole("button", { name: / · 执行过程$/ })
      .find((button) => !button.hasAttribute("disabled"))!;
    expect(activeTurn).toHaveAttribute("aria-expanded", "true");
    await user.click(activeTurn);
    expect(screen.queryByRole("region", { name: "工具过程" })).toBeNull();
    expect(screen.getByText("已完成配置核对。")).toBeVisible();
    await user.click(activeTurn);
    expect(group()).toHaveAttribute("aria-expanded", "true");
    if (target === "thought")
      expect(screen.getByText("核对文件内容")).toBeVisible();
    if (target === "tool") expect(screen.getByText("文件结果")).toBeVisible();
  },
);

it("keeps the turn expanded when the group is open and its detail is closed again", async () => {
  const { user, update } = setup();
  await user.click(group());
  const thoughtToggle = screen.getByRole("button", { name: /思考.*·/ });
  await user.click(thoughtToggle);
  await user.click(thoughtToggle);
  update([...history, reply, end]);
  expect(turn()).toHaveAttribute("aria-expanded", "true");
  expect(group()).toHaveAttribute("aria-expanded", "true");
  expect(thoughtToggle).toHaveAttribute("aria-expanded", "false");
});

it("honors manual group closure despite an open child and subsequent streaming", async () => {
  const { user, update } = setup(history, draft);
  await user.click(group());
  await user.click(screen.getByRole("button", { name: /思考.*·/ }));
  await user.click(group());
  update(history, { ...draft, next_index: 2 });
  expect(group()).toHaveAttribute("aria-expanded", "false");
  update([...history, reply, end]);
  expect(turn()).toHaveAttribute("aria-expanded", "false");
  await user.click(turn());
  expect(group()).toHaveAttribute("aria-expanded", "false");
  await user.click(group());
  expect(screen.getByText("核对文件内容")).toBeVisible();
});

it("preserves manual reasoning expansion as the first draft becomes a durable multi-entry group", async () => {
  const first = {
    ...draft,
    attempt_id: "thought",
    content: [{ type: "reasoning" as const, text: "核对文件内容" }],
  };
  const { user, update } = setup([records[0]], first);
  await user.click(screen.getByRole("button", { name: /^思考与工具过程/ }));
  await user.click(screen.getByRole("button", { name: "思考中" }));
  const body = screen.getByText("核对文件内容");
  update(history);
  expect(screen.getByText("核对文件内容")).toBe(body);
  update([...history, reply, end]);
  expect(body).toBeVisible();
  expect(turn()).toHaveAttribute("aria-expanded", "true");
  update([...history, reply, end], null, "page", "another-session");
  expect(turn()).toHaveAttribute("aria-expanded", "false");
});

it("does not force unknown tool outcomes open after completion", async () => {
  const unknown: DurableRecord = {
    ...result,
    data: {
      ...result.data,
      status: "outcome_unknown",
      outcome: { certainty: "unknown", reason: "timeout" },
    },
  };
  const { user } = setup([records[0], thought, call, unknown, reply, end]);
  expect(turn()).toHaveAttribute("aria-expanded", "false");
  expect(screen.getByRole("button", { name: /本轮异常/ })).toBeVisible();
  await user.click(turn());
  expect(group()).toHaveAttribute("aria-expanded", "false");
});

it("retains an open tool when pagination reveals the earlier reasoning in the same group", async () => {
  const { user, update } = setup([call, result]);
  await user.click(group());
  await user.click(screen.getByRole("button", { name: /读取文件/ }));
  const body = screen.getByText("文件结果");
  update(structuredClone(history));
  expect(screen.getByText("文件结果")).toBe(body);
  expect(body).toBeVisible();
  update([...history, reply, end]);
  expect(turn()).toHaveAttribute("aria-expanded", "true");
  expect(group()).toHaveAttribute("aria-expanded", "true");
  expect(body).toBeVisible();
});

it.each([false, true])(
  "keeps the tool row mounted across separate commit frames (reasoning=%s)",
  async (reasoning) => {
    const first: ActiveAttempt = {
      ...draft,
      attempt_id: "thought",
      content: [
        ...(reasoning
          ? [{ type: "reasoning" as const, text: "核对文件内容" }]
          : []),
        {
          type: "tool_call",
          draft_call_id: "draft-0",
          name: "read",
          arguments_text: '{"path":"example.txt"}',
        },
      ],
    };
    const saved: typeof thought = {
      ...thought,
      data: {
        ...thought.data,
        content: [
          ...(reasoning
            ? [{ type: "reasoning" as const, text: "核对文件内容" }]
            : []),
          { type: "tool_reference", tool_call_id: "80" },
        ],
      },
    };
    const { user, update } = setup([records[0]], first);
    await user.click(group());
    const button = screen.getByRole("button", { name: /^读取文件/ });
    await user.click(button);
    const section = screen.getByRole("region", { name: "工具过程" });
    const anchor = section.getAttribute("data-message-anchor");
    update([records[0], saved]);
    expect(screen.getByRole("region", { name: "工具过程" })).toBe(section);
    expect(section).toHaveAttribute("data-message-anchor", anchor);
    expect(screen.getByRole("button", { name: /^读取文件/ })).toBe(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
    update([
      records[0],
      saved,
      {
        ...call,
        data: { ...call.data, model_call_id: "thought", call_ordinal: 0 },
      },
    ]);
    expect(screen.getByRole("button", { name: /^读取文件/ })).toBe(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(section).toHaveAttribute("data-message-anchor", anchor);
  },
);

it("defers automatic turn folding while reading and keeps the group folded throughout", () => {
  const { update } = setup(history);
  update(history, draft, "page", "10", true);
  const finished = [...history, reply, end];
  update(finished, null, "page", "10", true);
  expect(turn()).toHaveAttribute("aria-expanded", "true");
  expect(group()).toHaveAttribute("aria-expanded", "false");
  update(finished, null, "page", "10", false);
  expect(turn()).toHaveAttribute("aria-expanded", "false");
});

it("allows manual turn folding while automatic folding is paused", async () => {
  const { user, update } = setup(history);
  update(history, draft, "page", "10", true);
  const finished = [...history, reply, end];
  update(finished, null, "page", "10", true);
  expect(turn()).toHaveAttribute("aria-expanded", "true");
  await user.click(turn());
  expect(turn()).toHaveAttribute("aria-expanded", "false");
  await user.click(turn());
  expect(turn()).toHaveAttribute("aria-expanded", "true");
  update(finished, null, "page", "10", false);
  expect(turn()).toHaveAttribute("aria-expanded", "true");
});

it("refreshes a detached command in a finished turn without altering the tool result", async () => {
  const sessionTask = "/sessions/10/tool-calls/80/task";
  let exited = false;
  const fetchStatus = vi.fn(async (url: string) => {
    if (!String(url).endsWith(sessionTask)) throw Error("Unexpected request");
    return Response.json({
      data: {
        task_id: "48",
        state: exited ? "completed" : "running",
        exit_code: exited ? 0 : null,
      },
    });
  });
  vi.stubGlobal("fetch", fetchStatus);
  const launch = {
    ...call,
    data: {
      ...call.data,
      tool_key: "exec",
      arguments: { description: "Check network", command: "probe" },
    },
  };
  const snapshot = {
    task_id: "48",
    cloud_computer_id: "6",
    command: "probe",
    cwd: "/data/home",
    background: true,
    description: "Check network",
    state: "running" as const,
    exit_code: null,
    stdout: "initial",
    stderr: "",
    truncated: false,
    output_pending: true,
    output_incomplete: false,
  };
  const launched = {
    ...result,
    data: { ...result.data, sandbox_execution: snapshot },
  };
  const { user } = setup([records[0], thought, launch, launched, reply, end]);
  await user.click(turn());
  if (group().getAttribute("aria-expanded") !== "true")
    await user.click(group());
  const card = await screen.findByRole("button", {
    name: /执行命令.*Check network.*进程运行中/,
  });
  exited = true;
  await waitFor(() => expect(card).toHaveTextContent("已结束 · 退出码 0"), {
    timeout: 5000,
  });
  expect(screen.queryByRole("button", { name: "本轮异常 · 1 项" })).toBeNull();
  await user.click(card);
  expect(screen.getByLabelText("标准输出")).toHaveTextContent("initial");
  expect(snapshot.state).toBe("running");
  expect(snapshot.exit_code).toBeNull();
});
