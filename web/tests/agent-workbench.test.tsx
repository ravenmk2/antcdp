import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryRouter, RouterProvider, Outlet } from "react-router";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { request } from "@/api/client";
import { NavigationGuardProvider } from "@/components/navigation-guard";
import { Workbench } from "@/areas/workspace/pages/workbench";
import {
  ConversationsPage,
  AgentDirectory,
} from "@/areas/workspace/pages/conversations-page";
import { ConversationSidebar } from "@/features/agents/chat/conversation-sidebar";
import { AgentRuntimeProvider } from "@/features/agents/data/agent-runtime";
import type { CatalogAgent } from "@/types/agents";

vi.mock("@/api/client", async (original) => ({
  ...(await original<typeof import("@/api/client")>()),
  request: vi.fn(),
}));
vi.mock("@/app/auth", () => ({
  useSession: () => ({ user: { id: "1", role: "admin" } }),
}));
const mock = vi.mocked(request);
const agent: CatalogAgent = {
  favorited: false,
  scope_kind: "platform",
  id: "1",
  name: "项目协作助手",
  description: "公开测试助手",
  default_model_binding_id: "8",
  default_thinking_option_key: "standard",
  sandbox_required: false,
  availability: { available: true, reason: null },
  model_options: [
    {
      binding_id: "8",
      model_id: "2",
      display_name: "对话模型",
      provider_label: "模型连接",
      protocol: "chat_completions",
      thinking_options: [{ key: "standard", label: "标准回答" }],
    },
  ],
};

const response = (data: unknown) => ({ data, status: 200, etag: "" });
afterEach(() => vi.unstubAllGlobals());
let favorited = false;
let favoriteIds: string[] = [];
beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  localStorage.clear();
  favorited = false;
  favoriteIds = Array.from({ length: 7 }, (_, i) => String(i + 1));
  mock.mockReset();
  mock.mockImplementation(async (url, options) => {
    if (url === "/agents/favorites/1") {
      if (options?.method === "DELETE")
        favoriteIds = favoriteIds.filter((id) => id !== "1");
      favorited = options?.method === "PUT";
      return response({ agent_id: "1", favorited });
    }
    if (url.startsWith("/agents/favorites?"))
      return response(
        favoriteIds.map((id) => ({
          ...agent,
          id,
          name: `收藏助手${id}`,
          favorited: true,
        })),
      );
    if (url.startsWith("/agents/catalog?"))
      return response([{ ...agent, favorited }]);
    if (url.startsWith("/agents/catalog/"))
      return response({ ...agent, id: url.split("/").at(-1), favorited });
    if (url.startsWith("/agents/sessions?")) {
      const params = new URL(url, "http://local").searchParams;
      const page = Number(params.get("page"));
      return {
        ...response(
          Array.from({ length: page === 1 ? 10 : 2 }, (_, i) => ({
            id: String((page - 1) * 10 + i + 1),
            title: `测试会话${(page - 1) * 10 + i + 1}`,
            attention: {
              question_interaction_count: 0,
              approval_interaction_count: 0,
              unviewed_run_count: 0,
            },
          })),
        ),
        pagination: { page, page_size: 10, total: 12 },
      };
    }
    if (url === "/agents/capabilities")
      return response({
        limits: {
          input_text_bytes: 65536,
          input_file_refs: 20,
          attachment_file_bytes: 1048576,
        },
      });
    throw new Error(`Unexpected request: ${url}`);
  });
});
function mount(route = "/agent-catalog", sidebar = false) {
  const router = createMemoryRouter(
    [
      {
        element: (
          <NavigationGuardProvider>
            <AgentRuntimeProvider>
              {sidebar ? <ConversationSidebar agentId="1" /> : <Outlet />}
            </AgentRuntimeProvider>
          </NavigationGuardProvider>
        ),
        children: [
          { path: "home", element: <Workbench /> },
          { path: "agent-catalog", element: <AgentDirectory /> },
          { path: "agents", element: <ConversationsPage /> },
          { path: "agents/sessions/:id", element: <div>恢复的会话</div> },
        ],
      },
    ],
    { initialEntries: [route] },
  );
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}
it("keeps the workbench as a decorative vector canvas without fetching business content", () => {
  mount("/home");
  expect(screen.getByLabelText("工作台").querySelector("svg")).toHaveAttribute(
    "aria-hidden",
    "true",
  );
  expect(mock).not.toHaveBeenCalled();
});
it("opens an agent by its card and changes favorites without navigating or creating sessions", async () => {
  const user = userEvent.setup();
  const router = mount();
  expect(await screen.findByRole("link", { name: agent.name })).toHaveAttribute(
    "href",
    "/agents?agent=1",
  );
  expect(
    screen.queryByRole("button", { name: "开始对话" }),
  ).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: `收藏${agent.name}` }));
  expect(
    await screen.findByRole("button", { name: `取消收藏${agent.name}` }),
  ).toHaveAttribute("aria-pressed", "true");
  expect(router.state.location.search).toBe("");
  await user.click(screen.getByRole("link", { name: agent.name }));
  expect(
    await screen.findByRole("textbox", { name: "消息内容" }),
  ).toBeVisible();
  expect(router.state.location.search).toBe("?agent=1");
  expect(
    mock.mock.calls.some(
      ([url, options]) =>
        url === "/agents/sessions" && options?.method === "POST",
    ),
  ).toBe(false);
});
it("isolates new conversation drafts by selected agent and restores each draft", async () => {
  const user = userEvent.setup();
  const router = mount("/agents?agent=1");
  await user.type(
    await screen.findByRole("textbox", { name: "消息内容" }),
    "第一位助手的草稿",
  );
  await act(() => router.navigate("/agents?agent=2"));
  expect(await screen.findByRole("textbox", { name: "消息内容" })).toHaveValue(
    "",
  );
  await user.type(
    screen.getByRole("textbox", { name: "消息内容" }),
    "第二位助手的草稿",
  );
  await act(() => router.navigate("/agents?agent=1"));
  expect(await screen.findByRole("textbox", { name: "消息内容" })).toHaveValue(
    "第一位助手的草稿",
  );
});
it("shows five favorites and ten filtered sessions, with independent expansion", async () => {
  const user = userEvent.setup();
  mount("/agents?agent=1", true);
  expect(
    screen.queryByRole("link", { name: "收藏助手1" }),
  ).not.toBeInTheDocument();
  await user.click(
    await screen.findByRole("button", { name: "选择智能体：收藏助手1" }),
  );
  await screen.findByRole("link", { name: "收藏助手1" });
  expect(
    screen.queryByRole("link", { name: "全部智能体" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("combobox", { name: "会话关注状态" }),
  ).not.toBeInTheDocument();
  expect(screen.getAllByRole("link", { name: /收藏助手/ })).toHaveLength(5);
  expect(
    screen.queryByRole("link", { name: "收藏助手6" }),
  ).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "展开更多" }));
  expect(screen.getAllByRole("link", { name: /收藏助手/ })).toHaveLength(7);
  await user.click(screen.getByRole("button", { name: "收起收藏" }));
  expect(screen.getAllByRole("link", { name: /收藏助手/ })).toHaveLength(5);
  await user.keyboard("{Escape}");
  await screen.findByRole("link", { name: "测试会话1" });
  expect(screen.getAllByRole("link", { name: /测试会话/ })).toHaveLength(10);
  await user.click(screen.getByRole("button", { name: "加载更多会话" }));
  await waitFor(() =>
    expect(screen.getAllByRole("link", { name: /测试会话/ })).toHaveLength(12),
  );
  expect(
    mock.mock.calls
      .filter(([url]) => url.startsWith("/agents/sessions?"))
      .every(
        ([url]) => url.includes("agent_id=1") && url.includes("page_size=10"),
      ),
  ).toBe(true);
  await user.click(screen.getByRole("button", { name: "搜索会话" }));
  const dialog = await screen.findByRole("dialog", { name: "搜索个人会话" });
  await user.click(
    within(dialog).getByRole("button", { name: "搜索全部智能体的会话" }),
  );
  await waitFor(() =>
    expect(
      mock.mock.calls.some(
        ([url]) =>
          url.startsWith("/agents/sessions?") &&
          !url.includes("agent_id=") &&
          url.includes("page_size=20"),
      ),
    ).toBe(true),
  );
});

it("keeps an unvisited conversation entry blank and restores the last agent and session per user", async () => {
  const router = mount("/agents");
  expect(screen.queryByRole("heading")).not.toBeInTheDocument();
  expect(mock).not.toHaveBeenCalled();
  localStorage.setItem(
    "antcdp.workspace.last-conversation:2",
    JSON.stringify({ agentId: "2", sessionId: "99" }),
  );
  await act(() => router.navigate("/agents"));
  expect(router.state.location.pathname).toBe("/agents");
  localStorage.setItem(
    "antcdp.workspace.last-conversation:1",
    JSON.stringify({ agentId: "1", sessionId: "31" }),
  );
  await act(() => router.navigate("/agents"));
  await screen.findByText("恢复的会话");
  expect(router.state.location.pathname).toBe("/agents/sessions/31");
  localStorage.setItem(
    "antcdp.workspace.last-conversation:1",
    JSON.stringify({ agentId: "1" }),
  );
  await act(() => router.navigate("/agents"));
  expect(
    await screen.findByRole("textbox", { name: "消息内容" }),
  ).toBeVisible();
  expect(router.state.location.search).toBe("?agent=1");
});

it("uses an empty conversation body and the regular footer composer for new conversations", async () => {
  const user = userEvent.setup();
  mount("/agents?agent=1");
  const input = await screen.findByRole("textbox", { name: "消息内容" });
  expect(input.closest(".agent-chat-footer")).not.toBeNull();
  expect(screen.getByLabelText("对话内容")).toBeEmptyDOMElement();
  expect(screen.queryByText("公开测试助手")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "发送" })).toBeDisabled();
  expect(
    mock.mock.calls.some(([url]) => url.startsWith("/agents/catalog?")),
  ).toBe(false);
  await user.click(screen.getByRole("button", { name: "模型与思考模式" }));
  const dialog = await screen.findByRole("dialog", { name: "会话设置" });
  expect(within(dialog).getByRole("combobox", { name: "模型" })).toBeEnabled();
  await user.click(within(dialog).getByRole("button", { name: "完成" }));
  await user.type(input, "未提交的首条消息");
  expect(screen.getByRole("button", { name: "发送" })).toBeEnabled();
  expect(mock.mock.calls.some(([url]) => url === "/agents/sessions")).toBe(
    false,
  );
});

it("shows an empty favorite hint and removes favorites through the item menu", async () => {
  favoriteIds = ["1"];
  const user = userEvent.setup();
  const router = mount("/agents?agent=1", true);
  await user.click(
    await screen.findByRole("button", { name: "选择智能体：收藏助手1" }),
  );
  await screen.findByRole("link", { name: "收藏助手1" });
  expect(
    screen.queryByRole("heading", { name: "收藏的智能体" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: /取消收藏/ }),
  ).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "收藏助手1的操作" }));
  await user.click(await screen.findByRole("menuitem", { name: "取消收藏" }));
  expect(await screen.findByText("尚未收藏")).toBeVisible();
  expect(
    screen.queryByRole("link", { name: "收藏助手1" }),
  ).not.toBeInTheDocument();
  expect(router.state.location.search).toBe("?agent=1");
  expect(
    mock.mock.calls.some(
      ([path, options]) =>
        path === "/agents/favorites/1" && options?.method === "DELETE",
    ),
  ).toBe(true);
});
it("closes the agent selector on selection without resetting the current conversation", async () => {
  const user = userEvent.setup();
  const router = mount("/agents/sessions/31", true);
  const trigger = await screen.findByRole("button", {
    name: "选择智能体：收藏助手1",
  });
  await user.click(trigger);
  await user.click(await screen.findByRole("link", { name: "收藏助手1" }));
  expect(router.state.location.pathname).toBe("/agents/sessions/31");
  expect(trigger).toHaveAttribute("aria-expanded", "false");
  await user.click(trigger);
  await user.click(await screen.findByRole("link", { name: "收藏助手2" }));
  expect(router.state.location.pathname).toBe("/agents");
  expect(router.state.location.search).toBe("?agent=2");
  expect(trigger).toHaveAttribute("aria-expanded", "false");
});
