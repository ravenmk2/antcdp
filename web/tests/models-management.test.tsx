import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryRouter, Outlet, RouterProvider } from "react-router";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ApiError, request, type RequestOptions } from "@/api/client";
import { NavigationGuardProvider } from "@/components/navigation-guard";
import {
  ModelProvidersPage,
  ModelProviderDetailPage,
} from "@/areas/console/pages/models-page";
import { DiagnosticView } from "@/features/models/model-shared";
import type {
  ModelDefinition,
  ModelTestResult,
  ModelProvider,
  ProviderType,
} from "@/types/models";

vi.mock("@/api/client", async (original) => ({
  ...(await original<typeof import("@/api/client")>()),
  request: vi.fn(),
}));
const mocked = vi.mocked(request);
const response = (data: unknown, etag = '"v1"') => ({
  data,
  etag,
  status: 200,
});
const catalog: ProviderType[] = [
  {
    default_base_url: "https://api.deepseek.com",
    default_icon_key: "deepseek",
    provider_type: "deepseek",
    name: "DeepSeek",
    auth_methods: ["api_key"],
    discovery_supported: true,
    protocols: [
      {
        protocol: "chat_completions",
        available: true,
        reason: null,
        thinking_options: [
          {
            key: "none",
            label: "关闭",
            parameters: { thinking: { type: "disabled" } },
          },
          {
            key: "high",
            label: "高",
            parameters: {
              thinking: { type: "enabled" },
              reasoning_effort: "high",
            },
          },
        ],
        parameter_schema: {
          type: "object",
          properties: {
            temperature: { type: "number", minimum: 0, maximum: 2 },
            top_p: { type: "number", minimum: 0, maximum: 1 },
            max_output_tokens: { type: "integer" },
            thinking: { type: "object" },
            stop: { type: "array" },
          },
        },
      },
      {
        protocol: "anthropic_messages",
        available: false,
        reason: "该适配器尚未开放",
        parameter_schema: {},
      },
    ],
  },
];
const provider: ModelProvider = {
  icon_key: null,
  id: "3",
  code: "deepseek-main",
  name: "研发模型服务",
  description: "研发共享连接",
  provider_type: "deepseek",
  enabled: true,
  config: {
    base_url: "https://example.test/v1",
    region: null,
    custom_ca_pem: null,
    connect_timeout_seconds: 10,
    request_timeout_seconds: 120,
  },
  authentication: { auth_method: "api_key", has_secret: true },
  version: "v1",
  created_at: "2026-11-09T00:00:00Z",
  updated_at: "2026-11-09T00:00:00Z",
};
const model: ModelDefinition = {
  icon_key: null,
  id: "12",
  provider_id: "3",
  name: "工具模型",
  description: "长内容模型",
  model_id: "remote-reasoner",
  protocol: "chat_completions",
  enabled: true,
  declared_capabilities: {
    text_input: "supported",
    image_input: "unsupported",
    tool_calling: "supported",
    streaming: "unsupported",
    thinking: "unsupported",
  },
  context_window: 128000,
  max_output_tokens: 8192,
  default_parameters: { temperature: 0.6 },
  thinking_levels: [],
  thinking_mapping: {},
  thinking_options: [{ key: "standard", label: "默认", parameters: {} }],
  version: "model-v1",
  created_at: provider.created_at,
  updated_at: provider.updated_at,
};
const discovered: ModelTestResult = {
  models: [{ model_id: "remote-new", display_name: "发现的新模型" }],
  truncated: false,
};
let override:
  | ((
      path: string,
      options: RequestOptions,
    ) => Promise<ReturnType<typeof response> | undefined>)
  | undefined;
beforeEach(() => {
  vi.stubGlobal("crypto", {
    getRandomValues: crypto.getRandomValues.bind(crypto),
  });
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  override = undefined;
  mocked.mockImplementation(async (path, options = {}) => {
    const result = await override?.(path, options);
    if (result) return result;
    if (path.endsWith("/provider-types"))
      return response({
        items: catalog,
        icons: [
          { key: "qwen", label: "Qwen" },
          { key: "model", label: "通用模型" },
        ],
      });
    if (path.includes("/providers?"))
      return {
        ...response([
          {
            ...provider,
            endpoint_display: provider.config.base_url,
            model_count: 1,
            has_secret: true,
            auth_method: "api_key",
          },
        ]),
        pagination: { page: 1, page_size: 20, total: 37 },
      };
    if (path.includes("/definitions?"))
      return {
        ...response([model]),
        pagination: { page: 1, page_size: 20, total: 1 },
      };
    if (path.endsWith("/providers/3")) return response(provider);
    if (path.endsWith("/definitions/12")) return response(model, '"model-v1"');
    if (path.endsWith("/model-discovery")) return response(discovered);
    throw new Error(`Unexpected request ${path}`);
  });
});
afterEach(() => vi.unstubAllGlobals());
it("shows measured diagnostic capabilities and nullable usage without raw JSON", async () => {
  const user = userEvent.setup();
  render(
    <DiagnosticView
      diagnostic={{
        kind: "model_probe",
        status: "failed",
        started_at: provider.created_at,
        finished_at: provider.created_at,
        checks: [
          { name: "connectivity", status: "succeeded", reason: null },
          { name: "tools", status: "failed", reason: "unexpected_tool" },
          { name: "future_check", status: "failed", reason: "future_reason" },
        ],
        capabilities: {
          ...model.declared_capabilities,
          image_input: "unknown",
          streaming: "unknown",
          thinking: "unknown",
        },
        usage: {
          input_tokens: 1200,
          output_tokens: 9,
          cache_read_tokens: 0,
          cache_write_tokens: null,
          normalization_version: "chat-completions-v1",
        },
      }}
    />,
  );
  expect(screen.getByText("连接验证")).toBeVisible();
  expect(
    screen.getByText("模型返回的工具名称或参数不符合测试要求。"),
  ).toBeVisible();
  expect(screen.getByText("诊断标识：future_reason")).toBeVisible();
  await user.click(screen.getByText("能力与用量详情"));
  expect(screen.getByText("1,200")).toBeVisible();
  expect(screen.getByText("0")).toBeVisible();
  expect(screen.getByText("未提供")).toBeVisible();
  expect(screen.getAllByText("未验证")).toHaveLength(3);
  expect(screen.getAllByText("已验证支持")).toHaveLength(2);
  expect(screen.queryByText(/"capabilities"/)).not.toBeInTheDocument();
});

it("does not infer capabilities or zero usage from a diagnostic without observations", async () => {
  const user = userEvent.setup();
  render(
    <DiagnosticView
      diagnostic={{
        kind: "provider_probe",
        status: "succeeded",
        started_at: provider.created_at,
        finished_at: provider.created_at,
        checks: [{ name: "connectivity", status: "succeeded", reason: null }],
        capabilities: null,
        usage: null,
      }}
    />,
  );
  await user.click(screen.getByText("能力与用量详情"));
  expect(screen.getAllByText("未验证")).toHaveLength(5);
  expect(screen.getAllByText("未提供")).toHaveLength(4);
  expect(screen.queryByText("已验证支持")).not.toBeInTheDocument();
});
function setup(entry = "/admin/models") {
  const router = createMemoryRouter(
    [
      {
        element: (
          <NavigationGuardProvider>
            <Outlet />
          </NavigationGuardProvider>
        ),
        children: [
          { path: "/admin/models", element: <ModelProvidersPage /> },
          { path: "/admin/models/new", element: <ModelProvidersPage /> },
          {
            path: "/admin/models/:providerId",
            element: <ModelProviderDetailPage />,
          },
        ],
      },
    ],
    { initialEntries: [entry] },
  );
  render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: { queries: { retry: false, gcTime: 0 } },
        })
      }
    >
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { user: userEvent.setup(), router };
}
async function fillProvider(user: ReturnType<typeof userEvent.setup>) {
  await user.type(await screen.findByLabelText(/^提供商名称/), "新连接");
  await user.type(
    screen.getByLabelText(/^服务地址/),
    "https://api.example.test",
  );
  await user.type(screen.getByLabelText(/^API Key/), "secret-only-in-memory");
}

it("uses server totals and real server-side filters without exposing future menus", async () => {
  const { user, router } = setup("/admin/models?page=99");
  await screen.findByText("第 2 / 2 页");
  await waitFor(() =>
    expect(new URLSearchParams(router.state.location.search).get("page")).toBe(
      "2",
    ),
  );
  await user.type(
    screen.getByRole("textbox", { name: "搜索提供商" }),
    "DeepSeek{Enter}",
  );
  await waitFor(() =>
    expect(router.state.location.search).toContain("q=DeepSeek"),
  );
  expect(mocked.mock.calls.some(([path]) => path.includes("q=DeepSeek"))).toBe(
    true,
  );
  expect(screen.getByRole("link", { name: "新建" })).toHaveAttribute(
    "href",
    `/admin/models/new${router.state.location.search}`,
  );
});

it("focuses required errors before making a create request", async () => {
  const { user } = setup("/admin/models/new");
  await user.click(await screen.findByRole("button", { name: "创建提供商" }));
  await waitFor(() =>
    expect(screen.getByLabelText(/^提供商名称/)).toHaveFocus(),
  );
  expect(screen.getByText("请输入提供商名称")).toBeVisible();
  expect(
    mocked.mock.calls.some(([, options]) => options?.method === "POST"),
  ).toBe(false);
});

it("protects custom URLs and resets authentication when the creation type changes", async () => {
  override = async (path) =>
    path.endsWith("/provider-types")
      ? response({
          items: [
            ...catalog,
            {
              ...catalog[0],
              provider_type: "ollama",
              name: "Ollama",
              auth_methods: ["none", "api_key"],
              default_base_url: "http://localhost:11434/v1",
              default_icon_key: "ollama",
            },
          ],
          icons: [],
        })
      : undefined;
  const { user } = setup("/admin/models/new");
  const dialog = await screen.findByRole("dialog", { name: "新建提供商" });
  const form = within(dialog);
  const address = form.getByLabelText(/^服务地址/);
  expect(address).toHaveValue("https://api.deepseek.com");
  await user.type(form.getByLabelText(/^API Key/), "discard-on-type-change");
  await user.click(form.getByRole("combobox", { name: /提供商类型/ }));
  await user.click(await screen.findByRole("option", { name: "Ollama" }));
  expect(address).toHaveValue("http://localhost:11434/v1");
  expect(form.queryByLabelText(/^API Key/)).not.toBeInTheDocument();
  await user.clear(address);
  await user.type(address, "https://gateway.example/v1");
  await user.click(form.getByRole("combobox", { name: /提供商类型/ }));
  await user.click(await screen.findByRole("option", { name: "DeepSeek" }));
  expect(address).toHaveValue("https://gateway.example/v1");
  expect(form.getByLabelText(/^API Key/)).toHaveValue("");
  await user.click(form.getByRole("button", { name: "使用默认地址" }));
  expect(address).toHaveValue("https://api.deepseek.com");
});

it("saves explicit icons and two-state capabilities without changing other declarations", async () => {
  let saved: unknown;
  override = async (path, options) => {
    if (path.endsWith("/definitions/12") && options.method === "PATCH") {
      saved = options.body;
      return response({ ...model, ...(options.body as object) }, '"model-v2"');
    }
  };
  const { user } = setup("/admin/models/3");
  await user.click(await screen.findByRole("button", { name: "工具模型" }));
  await user.click(await screen.findByRole("button", { name: "选择模型图标" }));
  await user.click(screen.getByRole("button", { name: "Qwen" }));
  expect(screen.getByRole("switch", { name: "文本输入" })).toBeChecked();
  expect(screen.getByRole("switch", { name: "图像输入" })).not.toBeChecked();
  await user.click(screen.getByRole("switch", { name: "图像输入" }));
  await user.click(screen.getByRole("button", { name: "保存修改" }));
  await waitFor(() =>
    expect(saved).toMatchObject({
      icon_key: "qwen",
      declared_capabilities: {
        text_input: "supported",
        image_input: "supported",
        tool_calling: "supported",
        streaming: "unsupported",
        thinking: "unsupported",
      },
    }),
  );
  expect(
    mocked.mock.calls.some(([path]) =>
      /operations|diagnostics|command-receipts/.test(path),
    ),
  ).toBe(false);
});

it("opens advanced connection settings and focuses a rejected field", async () => {
  override = async (path, options) => {
    if (path.endsWith("/providers/3") && options.method === "PATCH")
      throw new ApiError("VALIDATION_FAILED", "配置校验失败", 422, [
        { field: "config.request_timeout_seconds", code: "invalid_value" },
      ]);
    return undefined;
  };
  const { user } = setup("/admin/models/3");
  await user.click(
    await screen.findByRole("button", { name: "研发模型服务的操作" }),
  );
  await user.click(await screen.findByRole("menuitem", { name: "连接设置" }));
  const name = await screen.findByLabelText(/^提供商名称/);
  await user.type(name, " 新配置");
  expect(
    screen.getByText("高级连接配置").closest("details"),
  ).not.toHaveAttribute("open");
  await user.click(screen.getByRole("button", { name: "保存修改" }));
  await waitFor(() => expect(screen.getByLabelText(/^请求超时/)).toHaveFocus());
  expect(screen.getByText("高级连接配置").closest("details")).toHaveAttribute(
    "open",
  );
  expect(name).toHaveValue("研发模型服务 新配置");
});

it("keeps unknown writes for readback without replay or idempotency keys", async () => {
  override = async (path, options) => {
    if (path === "/admin/models/providers" && options.method === "POST")
      throw new ApiError(
        "NETWORK_ERROR",
        "网络连接中断",
        0,
        [],
        undefined,
        undefined,
        true,
      );
  };
  const { user } = setup("/admin/models/new");
  await fillProvider(user);
  await user.click(screen.getByRole("button", { name: "创建提供商" }));
  await screen.findByText("提交结果未确认");
  expect(screen.getByLabelText(/^提供商名称/)).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "刷新核对" }));
  await screen.findByRole("button", { name: "已核对，继续编辑" });
  expect(
    mocked.mock.calls.filter(([, o]) => o?.method === "POST"),
  ).toHaveLength(1);
  expect(
    mocked.mock.calls.some(
      ([p, o]) => p.includes("command-receipts") || o?.idempotencyKey,
    ),
  ).toBe(false);
  await user.click(screen.getByRole("button", { name: "已核对，继续编辑" }));
  expect(screen.getByLabelText(/^API Key/)).toHaveValue(
    "secret-only-in-memory",
  );
  expect(screen.getByLabelText(/^提供商名称/)).toBeEnabled();
});

it("preserves a conflicting provider draft until the user explicitly accepts a new version", async () => {
  let changed = false;
  override = async (path, options) => {
    if (path.endsWith("/providers/3") && options.method === "PATCH") {
      changed = true;
      throw new ApiError("VERSION_CONFLICT", "配置已更新", 412);
    }
    if (path.endsWith("/providers/3") && changed)
      return response(
        { ...provider, name: "其他管理员的名称", version: "v2" },
        '"v2"',
      );
  };
  const { user } = setup("/admin/models/3");
  await user.click(
    await screen.findByRole("button", { name: "研发模型服务的操作" }),
  );
  await user.click(await screen.findByRole("menuitem", { name: "连接设置" }));
  const name = await screen.findByLabelText(/^提供商名称/);
  await user.clear(name);
  await user.type(name, "我的草稿");
  await user.click(screen.getByRole("button", { name: "保存修改" }));
  await screen.findByText("需要核对服务器上的最新配置");
  expect(name).toHaveValue("我的草稿");
  await user.click(screen.getByRole("button", { name: "读取最新配置" }));
  await screen.findByRole("button", { name: "采用最新配置" });
  expect(name).toHaveValue("我的草稿");
  await user.click(
    screen.getByRole("button", { name: "保留草稿，以最新版本继续编辑" }),
  );
  expect(name).toHaveValue("我的草稿");
  expect(screen.getByRole("button", { name: "保存修改" })).toBeEnabled();
});

it("discovery requires a manual model create and leaves capability switches off", async () => {
  const { user } = setup("/admin/models/3");
  await user.click(await screen.findByRole("button", { name: "发现模型" }));
  await user.click(await screen.findByRole("button", { name: "获取模型" }));
  await user.click(await screen.findByRole("button", { name: "配置并添加" }));
  const dialog = screen.getByRole("dialog", { name: "添加模型" });
  expect(within(dialog).getByLabelText(/^模型 ID/)).toHaveValue("remote-new");
  expect(within(dialog).getByLabelText(/^模型名称/)).toHaveValue(
    "发现的新模型",
  );
  expect(
    within(dialog).getByRole("switch", { name: "工具调用" }),
  ).not.toBeChecked();
  expect(
    mocked.mock.calls.some(
      ([path, options]) =>
        path === "/admin/models/definitions" && options?.method === "POST",
    ),
  ).toBe(false);
  await user.click(within(dialog).getByRole("combobox", { name: /调用协议/ }));
  expect(
    await screen.findByRole("option", { name: /该适配器尚未开放/ }),
  ).toHaveAttribute("aria-disabled", "true");
});

it("edits model defaults without dropping registered advanced parameters or immutable identity", async () => {
  let body: unknown;
  override = async (path, options) => {
    if (path.endsWith("/definitions/12") && !options.method)
      return response(
        {
          ...model,
          default_parameters: { ...model.default_parameters, stop: ["\n\n"] },
        },
        '"model-v1"',
      );
    if (path.endsWith("/definitions/12") && options.method === "PATCH") {
      body = options.body;
      return response({ ...model, ...(options.body as object) }, '"model-v2"');
    }
  };
  const { user } = setup("/admin/models/3");
  await user.click(await screen.findByRole("button", { name: "工具模型" }));
  const name = await screen.findByLabelText(/^模型名称/);
  await waitFor(() =>
    expect(screen.getByRole("dialog").contains(document.activeElement)).toBe(
      true,
    ),
  );
  expect(screen.getByLabelText(/^模型 ID/)).toHaveAttribute("readonly");
  expect(screen.getByRole("combobox", { name: /调用协议/ })).toBeDisabled();
  await user.clear(name);
  await user.type(name, "更新模型名称");
  await user.click(screen.getByRole("button", { name: "保存修改" }));
  await waitFor(() => expect(body).toBeDefined());
  expect(body).toMatchObject({
    name: "更新模型名称",
    default_parameters: {
      temperature: 0.6,
      stop: ["\n\n"],
    },
    thinking_levels: [],
    thinking_mapping: {},
  });
  expect(body).not.toHaveProperty("provider_id");
  expect(body).not.toHaveProperty("model_id");
  expect(body).not.toHaveProperty("protocol");
});

it("protects an edited drawer and restores focus after explicitly discarding changes", async () => {
  const { user } = setup("/admin/models/3");
  const trigger = await screen.findByRole("button", {
    name: "研发模型服务的操作",
  });
  await user.click(trigger);
  await user.click(await screen.findByRole("menuitem", { name: "连接设置" }));
  await user.type(await screen.findByLabelText(/^提供商名称/), "尚未保存");
  await user.click(screen.getByRole("button", { name: "取消" }));
  await screen.findByText("放弃未保存的修改？");
  expect(screen.getByLabelText(/^提供商名称/)).toHaveValue(
    "研发模型服务尚未保存",
  );
  await user.click(screen.getByRole("button", { name: "放弃修改" }));
  await waitFor(() => expect(trigger).toHaveFocus());
  expect(
    mocked.mock.calls.some(([, options]) => options?.method === "PATCH"),
  ).toBe(false);
});

it("cancels a transient test when its panel closes and never polls operations", async () => {
  let signal: AbortSignal | undefined;
  override = async (path, options) => {
    if (path.endsWith("/test")) {
      signal = options.signal;
      return new Promise(() => {});
    }
  };
  const { user } = setup("/admin/models/3");
  await user.click(
    await screen.findByRole("button", { name: "工具模型的操作" }),
  );
  await user.click(await screen.findByRole("menuitem", { name: "测试" }));
  await user.click(await screen.findByRole("button", { name: "开始测试" }));
  await screen.findByText("测试中");
  await user.click(screen.getAllByRole("button", { name: "关闭" })[0]);
  await waitFor(() => expect(signal?.aborted).toBe(true));
  expect(
    mocked.mock.calls.some(
      ([p]) => p.includes("/operations/") || p.endsWith("/diagnostics"),
    ),
  ).toBe(false);
});

it("keeps parameter drafts across tabs and reveals the first invalid section", async () => {
  const { user } = setup("/admin/models/3");
  await user.click(
    await screen.findByRole("button", { name: "工具模型的操作" }),
  );
  await user.click(await screen.findByRole("menuitem", { name: "编辑" }));
  await screen.findByLabelText(/^模型名称/);
  await user.click(screen.getByRole("tab", { name: "生成参数" }));
  const advanced = screen.getByLabelText("高级参数（JSON）");
  await user.clear(advanced);
  await user.type(advanced, "invalid");
  await user.click(screen.getByRole("tab", { name: "基本配置" }));
  await user.click(screen.getByRole("button", { name: "保存修改" }));
  await waitFor(() =>
    expect(screen.getByRole("tab", { name: "生成参数" })).toHaveAttribute(
      "aria-selected",
      "true",
    ),
  );
  expect(advanced).toHaveValue("invalid");
  await waitFor(() => expect(advanced).toHaveFocus());
  expect(
    mocked.mock.calls.some(([, options]) => options?.method === "PATCH"),
  ).toBe(false);
});

it("adds selected discovered models one at a time with explicit limits", async () => {
  const discoveredModels = [
    { model_id: "new-a", display_name: "A" },
    { model_id: "new-b", display_name: "B" },
    { model_id: model.model_id, display_name: model.name },
  ];
  const created: Record<string, unknown>[] = [];
  override = async (path, options) => {
    if (path.endsWith("/model-discovery"))
      return response({ models: discoveredModels, truncated: false });
    if (path.endsWith("/definitions") && options.method === "POST") {
      created.push(options.body as Record<string, unknown>);
      return response({
        ...model,
        ...(options.body as object),
        id: String(created.length + 20),
      });
    }
  };
  const { user } = setup("/admin/models/3");
  await user.click(await screen.findByRole("button", { name: "发现模型" }));
  await user.click(await screen.findByRole("button", { name: "获取模型" }));
  await waitFor(() =>
    expect(screen.getByRole("checkbox", { name: "选择 new-a" })).toBeEnabled(),
  );
  expect(
    screen.getByRole("checkbox", { name: `选择 ${model.model_id}` }),
  ).toBeDisabled();
  await user.click(screen.getByRole("checkbox", { name: "选择 new-a" }));
  await user.click(screen.getByRole("checkbox", { name: "选择 new-b" }));
  await user.click(screen.getByRole("button", { name: "配置所选 2 个" }));
  for (const id of ["new-a", "new-b"]) {
    const dialog = await screen.findByRole("dialog", { name: "添加模型" });
    await waitFor(() =>
      expect(within(dialog).getByLabelText(/^模型 ID/)).toHaveValue(id),
    );
    await user.type(
      within(dialog).getByRole("textbox", { name: /上下文窗口/ }),
      "128000",
    );
    await user.type(
      within(dialog).getByRole("textbox", { name: /模型输出上限/ }),
      "8192",
    );
    await user.click(within(dialog).getByRole("button", { name: "添加模型" }));
  }
  await waitFor(() => expect(created).toHaveLength(2));
  expect(created.map((item) => item.model_id)).toEqual(["new-a", "new-b"]);
  expect(created[0]).toMatchObject({
    context_window: 128000,
    max_output_tokens: 8192,
    declared_capabilities: { tool_calling: "unsupported" },
  });
});

it("selects unified thinking levels without editable keys or duplicate generation controls", async () => {
  let body: unknown;
  override = async (path, options) => {
    if (path.endsWith("/definitions/12") && options.method === "PATCH") {
      body = options.body;
      return response({ ...model, ...(options.body as object) }, '"model-v2"');
    }
  };
  const { user } = setup("/admin/models/3");
  await user.click(await screen.findByRole("button", { name: "工具模型" }));
  await screen.findByLabelText(/^模型名称/);
  await user.click(screen.getByRole("tab", { name: "思考档位" }));
  expect(screen.getByText(/未选择档位时，不发送思考参数/)).toBeVisible();
  expect(screen.queryByLabelText("选项键")).not.toBeInTheDocument();
  expect(screen.queryByLabelText("档位映射（JSON）")).not.toBeInTheDocument();
  await user.click(screen.getByRole("checkbox", { name: /关闭/ }));
  await user.click(screen.getByRole("checkbox", { name: /^高/ }));
  await user.click(screen.getByRole("button", { name: "保存修改" }));
  await waitFor(() =>
    expect(body).toMatchObject({
      thinking_levels: ["none", "high"],
      thinking_mapping: {},
      declared_capabilities: { thinking: "supported" },
    }),
  );
  expect(body).not.toHaveProperty("thinking_options");
});

it("keeps custom thinking drafts and focuses a missing mapping before saving", async () => {
  let body: unknown;
  const customType = {
    ...catalog[0],
    provider_type: "custom",
    name: "自定义",
    protocols: [
      {
        ...catalog[0].protocols[0],
        parameter_schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            temperature: { type: "number" },
            reasoning_effort: { type: "string", enum: ["none", "high"] },
          },
        },
      },
    ],
  };
  override = async (path, options) => {
    if (path.endsWith("/provider-types"))
      return response({ items: [customType], icons: [] });
    if (path.endsWith("/providers/3") && !options.method)
      return response({ ...provider, provider_type: "custom" });
    if (path.endsWith("/definitions/12") && options.method === "PATCH") {
      body = options.body;
      return response({ ...model, ...(options.body as object) }, '"model-v2"');
    }
  };
  const { user } = setup("/admin/models/3");
  await user.click(await screen.findByRole("button", { name: "工具模型" }));
  await screen.findByLabelText(/^模型名称/);
  await user.click(screen.getByRole("tab", { name: "思考档位" }));
  await user.click(screen.getByRole("checkbox", { name: /关闭/ }));
  await user.click(screen.getByRole("button", { name: "保存修改" }));
  expect(body).toBeUndefined();
  const mapping = screen.getByRole("textbox", { name: /档位映射/ });
  expect(mapping).toBeVisible();
  expect(screen.getByRole("checkbox", { name: /关闭/ })).toBeChecked();
  await user.click(
    screen.getByRole("button", { name: "填入所选档位的协议示例" }),
  );
  await user.click(screen.getByRole("button", { name: "保存修改" }));
  await waitFor(() =>
    expect(body).toMatchObject({
      thinking_levels: ["none"],
      thinking_mapping: { none: { reasoning_effort: "none" } },
    }),
  );
});
