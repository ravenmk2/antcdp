import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
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
    tool_key: "read_file",
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
  ) => (
    <QueryClientProvider client={client}>
      <ConversationTimeline
        key={key}
        records={events}
        sessionId={sessionId}
        attempt={live}
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
    ) => rendered.rerender(view(events, live, key, sessionId)),
  };
}
const group = () =>
  within(screen.getByRole("region", { name: "工具过程" })).getAllByRole(
    "button",
  )[0];
const turn = () => screen.getByRole("button", { name: / · 执行过程$/ });

it.each(["succeeded", "failed", "cancelled"] as const)(
  "automatically collapses a %s turn and restores both folds collapsed on refresh",
  async (status) => {
    const { user, update } = setup();
    expect(group()).toHaveAttribute("aria-expanded", "true");
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

it("keeps a group open between tools and reasoning, then closes it at the reply boundary before the turn ends", () => {
  const { update } = setup(history.slice(0, 3));
  expect(group()).toHaveAttribute("aria-expanded", "true");
  update(history); // A tool result alone is not a group boundary.
  expect(group()).toHaveAttribute("aria-expanded", "true");
  update(history, draft);
  expect(group()).toHaveAttribute("aria-expanded", "true");
  update(history, {
    ...draft,
    content: [
      { type: "reasoning", text: "整理结果", duration_ms: 1000 },
      { type: "text", text: "后续正文" },
    ],
  });
  expect(group()).toHaveAttribute("aria-expanded", "false");
  expect(screen.getByText("后续正文")).toBeVisible();
  expect(screen.queryByRole("button", { name: / · 执行过程$/ })).toBeNull();
});

it("does not close a bounded group until its outstanding tool returns", () => {
  const { update } = setup([...history.slice(0, 3), reply]);
  expect(group()).toHaveAttribute("aria-expanded", "true");
  update([...history, reply]);
  expect(group()).toHaveAttribute("aria-expanded", "false");
});

it.each(["group", "thought", "tool"])(
  "protects manually opened %s and its ancestors through completion and replay",
  async (target) => {
    const { user, update } = setup();
    if (target === "group") {
      await user.click(group());
      await user.click(group());
    } else
      await user.click(
        screen.getByRole("button", {
          name: target === "thought" ? /思考.*用时/ : /读取文件/,
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

it("releases ancestor protection when a manually opened detail is closed again", async () => {
  const { user, update } = setup();
  const thoughtToggle = screen.getByRole("button", { name: /思考.*用时/ });
  await user.click(thoughtToggle);
  await user.click(thoughtToggle);
  update([...history, reply, end]);
  expect(turn()).toHaveAttribute("aria-expanded", "false");
});

it("honors manual group closure despite an open child and subsequent streaming", async () => {
  const { user, update } = setup(history, draft);
  await user.click(screen.getByRole("button", { name: /思考.*用时/ }));
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
