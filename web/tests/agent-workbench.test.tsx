import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryRouter, RouterProvider } from "react-router";
import { beforeEach, expect, it, vi } from "vitest";
import { request } from "@/api/client";
import { NavigationGuardProvider } from "@/components/navigation-guard";
import { Workbench } from "@/areas/workspace/pages/workbench";
import { AgentRuntimeProvider } from "@/features/agents/data/agent-runtime";
import type { AttentionItem, CatalogAgent } from "@/types/agents";

vi.mock("@/api/client", async (original) => ({
  ...(await original<typeof import("@/api/client")>()),
  request: vi.fn(),
}));
vi.mock("@/app/auth", () => ({
  useSession: () => ({ user: { id: "1", role: "admin" } }),
}));
const mock = vi.mocked(request);
const time = "2026-11-09T01:00:00Z";
const agent: CatalogAgent = {
  scope_kind: "platform",
  available_projects: [],
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
const pending: AttentionItem[] = Array.from({ length: 3 }, (_, index) => ({
  kind: "response_required",
  session_id: String(index + 1),
  agent_id: "1",
  title: `需要补充排查信息 ${index + 1}`,
  question_interaction_count: 1,
  approval_interaction_count: 0,
  first_response_at: time,
  next_approval_expires_at: null,
  last_activity_at: time,
}));
let failResponses = false;
let selectedAgent = agent;
const response = (data: unknown) => ({ data, status: 200, etag: "" });
beforeEach(() => {
  failResponses = false;
  selectedAgent = agent;
  mock.mockReset();
  mock.mockImplementation(async (url) => {
    if (url === "/workspace/attention-summary")
      return response({
        counts: {
          response_required_sessions: 8,
          result_unviewed_sessions: 0,
        },
        generated_at: time,
      });
    if (url.startsWith("/workspace/attention?")) {
      const query = new URL(url, "http://local").searchParams;
      if (failResponses && query.get("kind") === "response_required")
        throw new Error("关注列表暂时无法读取");
      return {
        ...response(query.get("kind") === "response_required" ? pending : []),
        pagination: {
          page: Number(query.get("page")),
          page_size: Number(query.get("page_size")),
          total: query.get("kind") === "response_required" ? 8 : 0,
        },
      };
    }
    if (url === "/me/sidebar-shortcuts")
      return response({
        projects: { items: [], version: "1" },
        teams: { items: [], version: "1" },
      });
    if (url.startsWith("/agents/catalog?")) return response([selectedAgent]);
    if (url === "/agents/catalog/1") return response(selectedAgent);
    if (url === "/projects/23") return response({ id: "23", name: "发布项目" });
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
function mount() {
  const router = createMemoryRouter(
    [
      {
        path: "/home",
        element: (
          <NavigationGuardProvider>
            <AgentRuntimeProvider>
              <Workbench />
            </AgentRuntimeProvider>
          </NavigationGuardProvider>
        ),
      },
    ],
    { initialEntries: ["/home"] },
  );
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

it("does not infer project context from agent ownership", async () => {
  selectedAgent = {
    ...agent,
    scope_kind: "project",
    available_projects: [{ id: "23", name: "发布项目" }],
  };
  mount();
  expect(
    await screen.findByRole("button", { name: "选择项目上下文，不指定项目" }),
  ).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "清除项目上下文" }),
  ).not.toBeInTheDocument();
});

it("keeps the real start composer beside two bounded attention previews without creating or viewing a session", async () => {
  mount();
  expect(
    await screen.findByRole("button", { name: "选择智能体，项目协作助手" }),
  ).toBeEnabled();
  expect(screen.getByRole("heading", { name: "工作台" })).toBeVisible();
  expect(await screen.findByLabelText("待回应数量：8")).toHaveTextContent("8");
  expect(
    screen.getAllByRole("link", { name: /需要补充排查信息/ }),
  ).toHaveLength(3);
  expect(screen.getByRole("button", { name: "开始对话" })).toBeDisabled();
  for (const kind of ["response_required", "result_unviewed"]) {
    expect(
      mock.mock.calls.some(
        ([url]) =>
          url === `/workspace/attention?kind=${kind}&page=1&page_size=3`,
      ),
    ).toBe(true);
  }
  expect(
    mock.mock.calls.every(
      ([, options]) => !options?.method || options.method === "GET",
    ),
  ).toBe(true);
  expect(
    mock.mock.calls.some(
      ([url]) => url.includes("view-state") || url === "/agents/sessions",
    ),
  ).toBe(false);
});

it("opens the complete attention list and keeps its page size independent from the preview", async () => {
  const user = userEvent.setup();
  mount();
  const trigger = await screen.findByRole("button", { name: "查看全部待回应" });
  await user.click(trigger);
  const dialog = await screen.findByRole("dialog", { name: "待回应" });
  await waitFor(() =>
    expect(within(dialog).getByText("共 8 条")).toBeVisible(),
  );
  expect(
    mock.mock.calls.some(([url]) =>
      url.includes("kind=response_required&page=1&page_size=20"),
    ),
  ).toBe(true);
  await user.click(within(dialog).getByRole("combobox", { name: "每页条数" }));
  await user.click(await screen.findByRole("option", { name: "50" }));
  await waitFor(() =>
    expect(
      mock.mock.calls.some(([url]) =>
        url.includes("kind=response_required&page=1&page_size=50"),
      ),
    ).toBe(true),
  );
  await user.keyboard("{Escape}");
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  expect(trigger).toHaveFocus();
});

it("isolates one attention failure and preserves a usable composer and independent retry", async () => {
  const user = userEvent.setup();
  failResponses = true;
  mount();
  const retry = await screen.findByRole("button", { name: "重新读取待回应" });
  expect(await screen.findByText("暂无待查看结果")).toBeVisible();
  expect(screen.queryByText("没有待核实事项")).not.toBeInTheDocument();
  await user.type(
    screen.getByRole("textbox", { name: "消息内容" }),
    "公开测试草稿",
  );
  expect(screen.getByRole("button", { name: "开始对话" })).toBeEnabled();
  failResponses = false;
  await user.click(retry);
  expect(
    await screen.findByRole("link", { name: /需要补充排查信息 1/ }),
  ).toBeVisible();
  expect(screen.getByRole("textbox", { name: "消息内容" })).toHaveValue(
    "公开测试草稿",
  );
});
