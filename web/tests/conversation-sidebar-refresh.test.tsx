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

vi.mock("@/api/client", async (original) => ({
  ...(await original<typeof import("@/api/client")>()),
  request: vi.fn(),
}));
const mock = vi.mocked(request);
let phase: "running" | "unviewed" | "viewed";
let cache: QueryClient;

beforeEach(() => {
  vi.useFakeTimers();
  focusManager.setFocused(true);
  phase = "running";
  cache = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
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
      <MemoryRouter initialEntries={["/agents/sessions/1"]}>
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
  await advance(5_000);
  for (const row of [first, second]) {
    expect(row).toBeInTheDocument();
    expect(row.querySelector('[data-state="running"]')).toBeNull();
    expect(
      within(row).getByRole("img", { name: "有未查看的回复结果" }),
    ).toHaveClass("bg-emerald-500");
    expect(row).not.toHaveTextContent("新结果");
  }
  phase = "viewed";
  await advance(5_000);
  expect(screen.queryByRole("img", { name: "有未查看的回复结果" })).toBeNull();
  expect(first).toBeInTheDocument();
  expect(second).toBeInTheDocument();
});

it("pauses periodic requests in a hidden tab and stops them when the sidebar unmounts", async () => {
  const { unmount } = mount();
  await advance(1);
  const initial = listCalls().length;
  act(() => focusManager.setFocused(false));
  phase = "unviewed";
  await advance(15_000);
  expect(listCalls()).toHaveLength(initial);
  act(() => focusManager.setFocused(true));
  await advance(5_000);
  expect(
    screen.getByRole("img", { name: "有未查看的回复结果" }),
  ).toBeInTheDocument();
  const refreshed = listCalls().length;
  unmount();
  await advance(15_000);
  expect(listCalls()).toHaveLength(refreshed);
});
