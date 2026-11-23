import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryRouter, Link, Outlet, RouterProvider } from "react-router";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ApiError, request } from "@/api/client";
import { NavigationGuardProvider } from "@/components/navigation-guard";
import { AgentRuntimeProvider } from "@/features/agents/data/agent-runtime";
import { NewConversation } from "@/features/agents/chat/new-conversation";
import type { CatalogAgent } from "@/types/agents";
import { session } from "./fixtures/agents";

vi.mock("@/api/client", async (original) => ({
  ...(await original<typeof import("@/api/client")>()),
  request: vi.fn(),
}));
vi.mock("@/app/auth", () => ({ useSession: () => ({ user: { id: "1" } }) }));
const mock = vi.mocked(request);
const response = (data: unknown) => ({ data, status: 200, etag: "v1" });
const agent: CatalogAgent = {
  executor_kind: "chat_user",
  id: "4",
  name: "研发助手",
  description: "",
  favorited: false,
  scope_kind: "platform",
  sandbox_required: false,
  availability: { available: true, reason: null },
  default_model_binding_id: "8",
  default_thinking_option_key: "default",
  model_options: [
    {
      binding_id: "8",
      model_id: "2",
      display_name: "测试模型",
      provider_label: "测试",
      protocol: "chat_completions",
      image_input: "supported",
      thinking_options: [
        { key: "default", label: "标准" },
        { key: "high", label: "高" },
      ],
    },
  ],
};
beforeEach(() => {
  mock.mockReset();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal(
    "WebSocket",
    class {
      readyState = 0;
      close() {}
      send() {}
    },
  );
});
afterEach(() => vi.unstubAllGlobals());

function setup(fixed: boolean) {
  let resolve!: (value: ReturnType<typeof response>) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<ReturnType<typeof response>>((accept, fail) => {
    resolve = accept;
    reject = fail;
  });
  const input = { promise, resolve, reject };
  mock.mockImplementation(async (url) => {
    if (url === "/agents/sessions/10/inputs") return input.promise;
    if (url === "/agents/sessions") return response(session);
    if (url === "/agents/catalog/4") return response(agent);
    if (url.startsWith("/agents/catalog?")) return response([agent]);
    if (url === "/agents/capabilities")
      return response({
        limits: { input_text_bytes: 65536, workspace_file_bytes: 32 << 20 },
      });
    if (url === "/agents/sessions/10/workspace/prepare")
      return response({ status: "ready" });
    if (url === "/agents/sessions/10/workspace/file-uploads")
      return response({
        status: "succeeded",
        result: { path: "sessions/10/notes (2).txt" },
      });
    throw new Error(`Unexpected request: ${url}`);
  });
  const cache = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const router = createMemoryRouter(
    [
      {
        element: (
          <QueryClientProvider client={cache}>
            <NavigationGuardProvider>
              <AgentRuntimeProvider>
                <Outlet />
              </AgentRuntimeProvider>
            </NavigationGuardProvider>
          </QueryClientProvider>
        ),
        children: [
          {
            path: "/new",
            element: (
              <>
                <Link to="/other">离开新对话</Link>
                <NewConversation agentId={fixed ? "4" : undefined} />
              </>
            ),
          },
          { path: "/chats/10", element: <p>已打开会话</p> },
          { path: "/other", element: <p>其他页面</p> },
        ],
      },
    ],
    { initialEntries: ["/new"] },
  );
  render(<RouterProvider router={router} />);
  const user = userEvent.setup();
  const send = async () => {
    const textbox = await screen.findByRole("textbox");
    await waitFor(() => expect(textbox).toBeEnabled());
    await user.type(textbox, "检查发送跳转");
    const button = screen.getByRole("button", {
      name: fixed ? "发送" : "开始对话",
    });
    await waitFor(() => expect(button).toBeEnabled());
    await user.click(button);
    await waitFor(() =>
      expect(mock).toHaveBeenCalledWith(
        "/agents/sessions/10/inputs",
        expect.anything(),
      ),
    );
  };
  return { input, user, send, router };
}

it.each([true, false])(
  "opens an accepted new conversation without a leave warning (fixed agent: %s)",
  async (fixed) => {
    const { input, send } = setup(fixed);
    await send();
    await act(async () => input.resolve(response({ input_id: "11" })));
    expect(await screen.findByText("已打开会话")).toBeVisible();
    expect(
      screen.queryByRole("dialog", { name: "离开当前页面？" }),
    ).not.toBeInTheDocument();
    expect(
      mock.mock.calls.filter(([url]) => url === "/agents/sessions/10/inputs"),
    ).toHaveLength(1);
  },
);

it("selects thinking directly in the new conversation composer", async () => {
  const { user, send, input } = setup(true);
  const thinking = await screen.findByRole("combobox", {
    name: "选择思考强度",
  });
  await user.click(thinking);
  await user.click(await screen.findByRole("option", { name: "高" }));
  expect(thinking).toHaveTextContent("高");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  await send();
  expect(mock).toHaveBeenCalledWith(
    "/agents/sessions",
    expect.objectContaining({
      body: expect.objectContaining({
        model_selection: { model_binding_id: "8", thinking_option_key: "high" },
      }),
    }),
  );
  expect(thinking).toBeDisabled();
  await act(async () => input.resolve(response({ input_id: "11" })));
  expect(await screen.findByText("已打开会话")).toBeVisible();
});

it("still protects navigation while a new conversation submission has failed", async () => {
  const { input, send, user, router } = setup(true);
  await send();
  await act(async () =>
    input.reject(new ApiError("VALIDATION_FAILED", "发送失败", 422)),
  );
  expect(await screen.findByRole("button", { name: "继续发送" })).toBeVisible();
  await user.click(screen.getByRole("link", { name: "离开新对话" }));
  expect(
    await screen.findByRole("dialog", { name: "离开当前页面？" }),
  ).toBeVisible();
  expect(router.state.location.pathname).toBe("/new");
  expect(screen.getByLabelText("消息内容")).toHaveValue("检查发送跳转");
});

it("sends a file-only message with its upload receipt and an empty text body", async () => {
  const { user, input } = setup(true);
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "添加消息图片" })).toBeEnabled(),
  );
  expect(
    screen.getByRole("button", { name: "上传文件到工作区" }),
  ).toBeEnabled();
  await user.upload(
    screen.getByLabelText("选择工作区文件"),
    new File(["content"], "notes.txt"),
  );
  const send = screen.getByRole("button", { name: "发送" });
  expect(send).toBeEnabled();
  expect(mock.mock.calls.map(([url]) => url)).not.toContain("/agents/sessions");
  await user.click(send);
  expect(mock).toHaveBeenCalledWith(
    "/agents/sessions/10/inputs",
    expect.objectContaining({
      body: expect.objectContaining({
        content: [],
        workspace_upload_keys: [
          mock.mock.calls.find(([url]) =>
            url.endsWith("/workspace/file-uploads"),
          )?.[1]?.idempotencyKey,
        ],
        file_refs: [],
      }),
    }),
  );
  await act(async () => input.resolve(response({ input_id: "11" })));
  expect(await screen.findByText("已打开会话")).toBeVisible();
});
