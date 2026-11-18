import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import {
  focusManager,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { request } from "@/api/client";
import { ConversationSidebar } from "@/features/agents/chat/conversation-sidebar";
import { SessionInvalidation } from "@/features/agents/data/session-invalidation";

vi.mock("@/api/client", async (original) => ({
  ...(await original<typeof import("@/api/client")>()),
  request: vi.fn(),
}));
const mock = vi.mocked(request);
let phase: "running" | "unviewed" | "viewed";
let cache: QueryClient;
let invalidation: SessionInvalidation;

beforeEach(() => {
  vi.useFakeTimers();
  focusManager.setFocused(true);
  phase = "running";
  cache = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  invalidation = new SessionInvalidation(cache);
  mock.mockImplementation(async (path) => {
    if (path.startsWith("/agents/favorites?"))
      return { data: [], status: 200, etag: "" };
    const page = Number(new URL(path, "http://local").searchParams.get("page"));
    return {
      data: [
        {
          id: String(page + 1),
          agent_id: "1",
          title: `后台会话${page + 1}`,
          active_run_status: phase === "running" ? "running" : null,
          attention: {
            question_interaction_count: 0,
            approval_interaction_count: 0,
            unviewed_run_count: phase === "unviewed" ? 1 : 0,
          },
        },
      ],
      status: 200,
      etag: "",
      pagination: { total: 2 },
    };
  });
});
afterEach(() => {
  cleanup();
  invalidation.dispose();
  cache.clear();
  focusManager.setFocused(undefined);
  vi.useRealTimers();
});
async function advance(milliseconds: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(milliseconds);
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1);
  });
}
function mount() {
  return render(
    <QueryClientProvider client={cache}>
      <MemoryRouter initialEntries={["/chats/1"]}>
        <ConversationSidebar agentId="1" />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
const listCalls = () =>
  mock.mock.calls.filter(([path]) => path.startsWith("/agents/sessions?"));

it("refreshes off-screen results on all loaded pages without replacing rows, then clears viewed results", async () => {
  mount();
  await advance(1);
  const first = screen.getByRole("link", { name: "后台会话2" });
  expect(first.querySelector('[data-state="running"]')).not.toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "加载更多会话" }));
  await advance(1);
  const second = screen.getByRole("link", { name: "后台会话3" });
  phase = "unviewed";
  invalidation.changed();
  await advance(200);
  for (const row of [first, second]) {
    expect(row).toBeInTheDocument();
    expect(row.querySelector('[data-state="running"]')).toBeNull();
    expect(
      within(row).getByRole("img", { name: "有未查看的回复结果" }),
    ).toHaveClass("bg-emerald-500");
    expect(row).not.toHaveTextContent("新结果");
  }
  phase = "viewed";
  invalidation.changed();
  await advance(200);
  expect(screen.queryByRole("img", { name: "有未查看的回复结果" })).toBeNull();
  expect(first).toBeInTheDocument();
  expect(second).toBeInTheDocument();
});

it("does not poll and processes global notifications even in a hidden tab", async () => {
  const { unmount } = mount();
  await advance(1);
  const initial = listCalls().length;
  act(() => focusManager.setFocused(false));
  phase = "unviewed";
  await advance(15_000);
  expect(listCalls()).toHaveLength(initial);
  invalidation.changed();
  await advance(200);
  expect(
    screen.getByRole("img", { name: "有未查看的回复结果" }),
  ).toBeInTheDocument();
  const refreshed = listCalls().length;
  unmount();
  await advance(15_000);
  expect(listCalls()).toHaveLength(refreshed);
});

it("keeps load-more enabled during refresh and queues pagination without cancelling the refresh", async () => {
  mount();
  await advance(1);
  let resolve!: (value: Awaited<ReturnType<typeof request>>) => void;
  mock.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  invalidation.changed();
  await advance(200);
  const more = screen.getByRole("button", { name: "加载更多会话" });
  expect(more).toBeEnabled();
  const before = listCalls().length;
  fireEvent.click(more);
  await advance(1);
  expect(screen.getByRole("button", { name: "正在加载…" })).toBeDisabled();
  expect(listCalls()).toHaveLength(before);
  await act(async () =>
    resolve({
      data: [{ id: "2", agent_id: "1", title: "后台会话2", attention: {} }],
      status: 200,
      etag: "",
      pagination: { total: 2 },
    }),
  );
  await advance(1);
  expect(listCalls().map(([path]) => path)).toHaveLength(before + 1);
  expect(screen.getByRole("link", { name: "后台会话3" })).toBeInTheDocument();
});

it("coalesces bursts but refreshes again for a change arriving during an older response", async () => {
  mount();
  await advance(1);
  let resolve!: (value: Awaited<ReturnType<typeof request>>) => void;
  mock.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  for (let i = 0; i < 20; i++) invalidation.changed();
  await advance(200);
  expect(listCalls()).toHaveLength(2);
  phase = "unviewed";
  invalidation.changed();
  await act(async () =>
    resolve({
      data: [{ id: "2", agent_id: "1", title: "后台会话2", attention: {} }],
      status: 200,
      etag: "",
      pagination: { total: 2 },
    }),
  );
  await advance(200);
  expect(listCalls()).toHaveLength(3);
  expect(
    screen.getByRole("img", { name: "有未查看的回复结果" }),
  ).toBeInTheDocument();
});
