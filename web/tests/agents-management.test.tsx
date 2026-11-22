import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryRouter, Outlet, RouterProvider } from "react-router";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { ApiError, request, type RequestOptions } from "@/api/client";
import { NavigationGuardProvider } from "@/components/navigation-guard";
import { ThemeProvider } from "@/app/theme";
import { AgentRuntimeProvider } from "@/features/agents/data/agent-runtime";
import {
  AgentCreatePage,
  AgentDetailPage,
  AgentsPage,
} from "@/areas/console/pages/agents/agents-page";
import { WebAccessSettingsPage } from "@/areas/console/pages/agents/web-access-page";
import {
  SkillDetailPage,
  SkillsPage,
  SkillUploadPage,
} from "@/areas/console/pages/agents/skills-page";
import type { AgentDefinition } from "@/types/agents";
import type { Skill, SkillUpload } from "@/types/agent-resources";

vi.mock("@/api/client", async (original) => ({
  ...(await original<typeof import("@/api/client")>()),
  request: vi.fn(),
}));
vi.mock("@/app/auth", () => ({
  useSession: () => ({ user: { id: "1", role: "admin" } }),
}));
const mocked = vi.mocked(request);
const response = (data: unknown, etag = '"version-1"') => ({
  data,
  etag,
  status: 200,
});
const agent: AgentDefinition = {
  id: "4",
  code: "agent-4",
  name: "服务核查",
  description: "权限明确的核查助手",
  agent_type: "service",
  enabled: false,
  system_prompt: "先核验再行动",
  default_model_binding_id: null,
  runtime_policy: {
    max_steps: 60,
    max_model_calls: 120,
    max_model_retries: 5,
    max_tool_calls: 200,
    max_children: 4,
    max_parallel_tools: 4,
    run_timeout_seconds: 2700,
    queue_timeout_seconds: 1800,
    question_timeout_seconds: 120,
    approval_timeout_seconds: 180,
    max_input_tokens: 1000000,
    max_output_tokens: 100000,
  },
  scope_kind: "platform",
  scope_id: null,
  robot_user_id: "9",
  pool_capacity: 1,
  deleted_at: null,
  version: "version-1",
  created_at: "2026-11-09T00:00:00Z",
  updated_at: "2026-11-09T00:00:00Z",
};
const skill: Skill = {
  latest_version_id: null,
  id: "8",
  name: "release-review",
  title: "发布核查",
  description: "",
  enabled: true,
  version: "version-1",
  created_at: agent.created_at,
  updated_at: agent.updated_at,
};
const upload: SkillUpload = {
  operation_id: "91",
  skill_id: "8",
  uploaded_by: "1",
  filename: "review.zip",
  size_bytes: "1024",
  expires_at: "2026-12-01T00:00:00Z",
  validation_status: "passed",
  normalized_name: "release-review",
  frontmatter: { name: "release-review", description: "发布前核查" },
  manifest: { file_count: 2, total_bytes: "2048" },
  issues: [],
  published_skill_version_id: null,
};
let override:
  | ((
      path: string,
      options: RequestOptions,
    ) => Promise<ReturnType<typeof response> | undefined>)
  | undefined;
beforeEach(() => {
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  override = undefined;
  mocked.mockReset();
  mocked.mockImplementation(async (path, options = {}) => {
    const result = await override?.(path, options);
    if (result) return result;
    if (path.startsWith("/admin/agents/definitions?"))
      return { ...response([]), pagination: { total: 0 } };
    if (path.startsWith("/admin/robots?"))
      return response([
        {
          id: "9",
          username: "review_bot",
          display_name: "审查机器人",
          status: "active",
          managed_agent_id: null,
        },
      ]);
    if (path.endsWith("/definitions/4")) return response(agent);
    if (path.endsWith("/activation-check"))
      throw new ApiError("VALIDATION_FAILED", "请检查输入内容", 422, [
        { field: "enabled", code: "default_model_required" },
      ]);
    if (path.endsWith("/model-bindings"))
      return response({
        items: [],
        default_model_binding_id: null,
        version: "version-1",
      });
    if (path.endsWith("/mcp-bindings") || path.endsWith("/skill-bindings"))
      return response({ items: [], version: "version-1" });
    if (path.endsWith("/tool-bindings"))
      return response({
        items: [
          {
            id: "7",
            tool_key: "test_tool",
            policy: "deny",
            parameter_constraints: {},
          },
        ],
        version: "version-1",
      });
    if (path.includes("/tool-catalog?"))
      return {
        ...response([
          {
            tool_key: "test_tool",
            name: "检查工具",
            description: "只做检查",
            source: { kind: "builtin" },
            execution_class: "read_only",
            supported_policies: ["allow", "confirm", "deny"],
            requires_sandbox: false,
            parameter_constraints_schema: {},
            input_schema_fingerprint: "hash",
            availability: { available: true, reason: null },
          },
        ]),
        pagination: { total: 1 },
      };
    if (path.endsWith("/skills/8")) return response(skill);
    if (path.startsWith("/admin/agents/skills?"))
      return { ...response([skill]), pagination: { total: 1 } };
    if (path.endsWith("/skills/uploads/91")) return response(upload);
    if (path.endsWith("/capabilities"))
      return response({
        limits: { skill_zip_bytes: 10485760 },
        features: { skills: true },
      });
    throw new Error(`Unexpected ${options.method ?? "GET"} ${path}`);
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
function mount(entry: string) {
  const router = createMemoryRouter(
    [
      {
        element: (
          <NavigationGuardProvider>
            <AgentRuntimeProvider>
              <Outlet />
            </AgentRuntimeProvider>
          </NavigationGuardProvider>
        ),
        children: [
          { path: "/admin/skills", element: <SkillsPage /> },
          { path: "/admin/skills/:skillId", element: <SkillDetailPage /> },
          { path: "/admin/skills/new", element: <SkillUploadPage /> },
          { path: "/admin/agents", element: <AgentsPage /> },
          { path: "/admin/agents/new", element: <AgentCreatePage /> },
          { path: "/admin/agents/:agentId", element: <AgentDetailPage /> },
          {
            path: "/admin/web-access/settings",
            element: <WebAccessSettingsPage />,
          },
          {
            path: "/admin/skills/:skillId/upload",
            element: <SkillUploadPage />,
          },
          {
            path: "/admin/skills/:skillId/versions/:versionId",
            element: <div>已发布的版本</div>,
          },
        ],
      },
    ],
    { initialEntries: [entry] },
  );
  const cache = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={cache}>
      <ThemeProvider>
        <RouterProvider router={router} />
      </ThemeProvider>
    </QueryClientProvider>,
  );
  return { router, cache, user: userEvent.setup() };
}
it.each(["chat", "service"] as const)(
  "retains the %s create payload and original key after an unknown result",
  async (agentType) => {
    let first: RequestOptions | undefined;
    override = async (path, options) => {
      if (path === "/admin/agents/definitions" && options.method === "POST") {
        if (!first) {
          first = options;
          throw new ApiError(
            "NETWORK_ERROR",
            "网络响应未知",
            0,
            [],
            undefined,
            undefined,
            true,
          );
        }
        expect(options.idempotencyKey).toBe(first.idempotencyKey);
        expect(options.body).toEqual(first.body);
        return response(agent);
      }
    };
    const { user, router } = mount("/admin/agents/new");
    await user.type(screen.getByRole("textbox", { name: "编码" }), "reviewer");
    if (agentType === "service") {
      const drawer = screen.getByRole("dialog", { name: "新建助手" });
      await user.click(within(drawer).getByRole("radio", { name: /服务型/ }));
      expect(
        within(drawer).queryByRole("textbox", { name: "欢迎语" }),
      ).not.toBeInTheDocument();
      await user.click(screen.getByRole("combobox", { name: "执行机器人" }));
      await user.click(
        await screen.findByRole("option", { name: "审查机器人 (review_bot)" }),
      );
    } else {
      await user.type(
        screen.getByRole("textbox", { name: "欢迎语" }),
        "欢迎开启对话",
      );
    }
    await user.type(
      screen.getByRole("textbox", { name: "助手名称" }),
      "核查助手",
    );
    await user.click(screen.getByRole("button", { name: "创建并配置" }));
    expect(await screen.findByText("提交结果尚未确认")).toBeVisible();
    expect(screen.getByRole("textbox", { name: "助手名称" })).toHaveValue(
      "核查助手",
    );
    await user.click(screen.getByRole("button", { name: "重试原请求" }));
    await waitFor(() =>
      expect(router.state.location.pathname).toBe("/admin/agents/4"),
    );
    expect(first?.body).toMatchObject({
      enabled: false,
      code: "reviewer",
      robot_user_id: agentType === "service" ? "9" : null,
      name: "核查助手",
      agent_type: agentType,
      scope_kind: "platform",
    });
    if (agentType === "chat")
      expect(first?.body).toHaveProperty("greeting", "欢迎开启对话");
  },
);
it("combines type and keyboard search filters and clears them from the empty state", async () => {
  const { router, user } = mount("/admin/agents?page=2");
  await user.click(screen.getByRole("button", { name: "服务型" }));
  expect(screen.getByRole("button", { name: "服务型" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await user.type(
    screen.getByRole("textbox", { name: "搜索助手" }),
    "核查{Enter}",
  );
  const query = new URLSearchParams(router.state.location.search);
  expect(query.get("agent_type")).toBe("service");
  expect(query.get("q")).toBe("核查");
  expect(query.get("page")).toBe("1");
  await user.click(await screen.findByRole("button", { name: "重置筛选条件" }));
  expect(screen.getByRole("textbox", { name: "搜索助手" })).toHaveValue("");
  expect(screen.getByRole("button", { name: "全部助手" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect(await screen.findByText("尚未创建助手")).toBeVisible();
});

it("closes the create drawer after one discard confirmation without a second navigation prompt", async () => {
  const { user, router } = mount("/admin/agents/new");
  await user.type(
    screen.getByRole("textbox", { name: "助手名称" }),
    "未保存助手",
  );
  await user.click(screen.getByRole("button", { name: /^取消$/ }));
  expect(
    await screen.findByRole("heading", { name: "放弃未保存的修改？" }),
  ).toBeVisible();
  await user.click(screen.getByRole("button", { name: /^放弃修改$/ }));
  await waitFor(() =>
    expect(router.state.location.pathname).toBe("/admin/agents"),
  );
  expect(
    screen.queryByRole("heading", { name: "离开当前页面？" }),
  ).not.toBeInTheDocument();
  expect(
    mocked.mock.calls.some(([, options]) => options?.method === "POST"),
  ).toBe(false);
});
it("keeps editing after saving and protects subsequent unsaved changes", async () => {
  let current = agent;
  override = async (path, options) => {
    if (path.endsWith("/definitions/4")) {
      if (options.method === "PATCH")
        current = { ...current, ...(options.body as object) };
      return response(current);
    }
  };
  const { user, router } = mount("/admin/agents/4?tab=basic");
  await screen.findByRole("heading", { name: "基本信息" });
  expect(
    screen.queryByRole("textbox", { name: "助手名称" }),
  ).not.toBeInTheDocument();
  await user.click(screen.getByRole("link", { name: "编辑配置" }));
  const name = await screen.findByRole("textbox", { name: "助手名称" });
  await user.clear(name);
  await user.type(name, "已更新的助手");
  await user.click(screen.getByRole("button", { name: "保存本分区" }));
  expect(
    await screen.findByRole("heading", { name: "已更新的助手" }),
  ).toBeVisible();
  expect(router.state.location.search).toBe("?tab=basic&view=edit");
  expect(name).toHaveValue("已更新的助手");
  expect(screen.getByRole("button", { name: "保存本分区" })).toBeDisabled();
  await user.type(name, "草稿");
  await user.click(screen.getByRole("link", { name: "退出编辑" }));
  expect(
    await screen.findByRole("dialog", { name: "离开当前页面？" }),
  ).toBeVisible();
  await user.click(screen.getByRole("button", { name: "取消" }));
  expect(name).toHaveValue("已更新的助手草稿");
  await user.click(screen.getByRole("button", { name: "取消修改" }));
  await user.click(screen.getByRole("link", { name: "退出编辑" }));
  await waitFor(() => expect(router.state.location.search).toBe("?tab=basic"));
  expect(
    screen.queryByRole("textbox", { name: "助手名称" }),
  ).not.toBeInTheDocument();
});

it("opens the overview with actionable blockers and optional capabilities", async () => {
  const { user, router } = mount("/admin/agents/4");
  expect(
    await screen.findByRole("heading", { name: "配置检查" }),
  ).toBeVisible();
  expect(await screen.findByText("当前阻塞项")).toBeVisible();
  expect(await screen.findAllByText("未绑定 · 可选")).toHaveLength(2);
  expect(screen.getByRole("link", { name: "概览" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await user.click(screen.getByRole("link", { name: "去配置模型" }));
  await waitFor(() =>
    expect(router.state.location.search).toBe("?tab=models&view=edit"),
  );
  expect(await screen.findByRole("button", { name: "添加模型" })).toBeVisible();
});

it("keeps prompt editing within the settings navigation", async () => {
  override = async (path, options) =>
    path.endsWith("/definitions/4") && options.method === "PATCH"
      ? response({ ...agent, ...(options.body as object) })
      : undefined;
  const { user, router } = mount("/admin/agents/4?tab=prompt&view=edit");
  const prompt = await screen.findByRole("textbox", { name: "系统提示" });
  await user.type(prompt, "，使用中文");
  await user.click(screen.getByRole("button", { name: "保存本分区" }));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "保存本分区" })).toBeDisabled(),
  );
  expect(prompt).toHaveValue("先核验再行动，使用中文");
  expect(router.state.location.search).toBe("?tab=prompt&view=edit");
  await user.click(screen.getByRole("link", { name: "执行预算" }));
  expect(
    await screen.findByRole("spinbutton", { name: "最大推理步数" }),
  ).toBeVisible();
});

it("keeps the skill search when returning from version selection and only binds the chosen version", async () => {
  override = async (path, options) => {
    if (path.startsWith("/admin/agents/skills?"))
      return response([{ ...skill, latest_version_id: "91" }]);
    if (path.startsWith("/admin/agents/skills/8/versions?"))
      return response([
        { id: "90", version_label: "v1", change_note: "稳定版本" },
      ]);
    if (path.endsWith("/versions/90"))
      return response({ id: "90", version_label: "v1" });
    if (path.endsWith("/skill-bindings") && options.method === "PUT")
      return response({ ...(options.body as object), version: "2" });
  };
  const { user } = mount("/admin/agents/4?tab=skills&view=edit");
  await user.click(await screen.findByRole("button", { name: "添加技能" }));
  const picker = await screen.findByRole("dialog", { name: "选择技能" });
  const search = within(picker).getByRole("textbox");
  await user.type(search, "发布");
  await user.click(await within(picker).findByRole("button", { name: "选择" }));
  const versions = await screen.findByRole("dialog", { name: "选择固定版本" });
  expect(screen.getAllByRole("dialog")).toHaveLength(1);
  await user.click(
    within(versions).getByRole("button", { name: "返回技能列表" }),
  );
  expect(search).toHaveValue("发布");
  await user.click(await within(picker).findByRole("button", { name: "选择" }));
  await user.click(
    await within(versions).findByRole("button", { name: "选择" }),
  );
  await user.click(await screen.findByRole("button", { name: "保存本分区" }));
  await waitFor(() =>
    expect(
      mocked.mock.calls.some(
        ([path, options]) =>
          path.endsWith("/skill-bindings") &&
          options?.method === "PUT" &&
          (options.body as { items: { skill_version_id: string }[] }).items[0]
            ?.skill_version_id === "90",
      ),
    ).toBe(true),
  );
});
it("does not offer activation while the check fails", async () => {
  const { user } = mount("/admin/agents/4?tab=basic");
  await user.click(await screen.findByRole("link", { name: "检查并启用" }));
  const dialog = await screen.findByRole("dialog", { name: "启用前检查" });
  expect(await within(dialog).findByText("当前阻塞项")).toBeVisible();
  expect(
    within(dialog).queryByRole("button", { name: "确认启用" }),
  ).not.toBeInTheDocument();
  expect(
    mocked.mock.calls.some(([, options]) => options?.method === "PATCH"),
  ).toBe(false);
});

it("activates only on confirmation using the checked version", async () => {
  override = async (path, options) => {
    if (path.endsWith("/activation-check"))
      return response(
        { ...agent, default_model_binding_id: "9" },
        '"checked-version"',
      );
    if (path.endsWith("/definitions/4") && options.method === "PATCH") {
      expect(options.body).toEqual({ enabled: true });
      expect(options.etag).toBe('"checked-version"');
      return response({ ...agent, enabled: true });
    }
  };
  const { user } = mount("/admin/agents/4?tab=overview&action=enable");
  const confirm = await screen.findByRole("button", { name: "确认启用" });
  expect(
    mocked.mock.calls.some(([, options]) => options?.method === "PATCH"),
  ).toBe(false);
  await user.click(confirm);
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  expect(
    mocked.mock.calls.filter(([, options]) => options?.method === "PATCH"),
  ).toHaveLength(1);
});
it("shows the entire catalog even without bindings and enables a tool from its row", async () => {
  override = async (path, options) => {
    if (path.endsWith("/tool-bindings"))
      return response({
        items:
          options.method === "PUT"
            ? (options.body as { items: unknown[] }).items
            : [],
        version: "1",
      });
  };
  const { user } = mount("/admin/agents/4?tab=tools");
  const toggle = await screen.findByRole("switch", { name: "启用检查工具" });
  expect(toggle).not.toBeChecked();
  expect(screen.queryByRole("button", { name: "添加工具" })).toBeNull();
  await user.click(toggle);
  expect(toggle).toBeChecked();
  expect(screen.queryByRole("dialog")).toBeNull();
  await user.click(screen.getByRole("button", { name: "保存本分区" }));
  await waitFor(() =>
    expect(
      mocked.mock.calls.find(
        ([path, opts]) =>
          path.endsWith("/tool-bindings") && opts?.method === "PUT",
      )?.[1]?.body,
    ).toEqual({
      items: [
        { tool_key: "test_tool", policy: "allow", parameter_constraints: {} },
      ],
    }),
  );
  expect(
    mocked.mock.calls.some(([path]) => path.endsWith("/mcp-bindings")),
  ).toBe(false);
  await user.click(screen.getByRole("link", { name: "MCP 服务" }));
  expect(await screen.findByText("尚未绑定 MCP 服务")).toBeVisible();
});
it("shows runtime values without editable inputs until editing is requested", async () => {
  const { user } = mount("/admin/agents/4?tab=runtime");
  expect(await screen.findByText("最大推理步数")).toBeVisible();
  expect(screen.queryByRole("spinbutton")).toBeNull();
  expect(screen.queryByRole("button", { name: "保存本分区" })).toBeNull();
  await user.click(screen.getByRole("link", { name: "编辑配置" }));
  expect(
    await screen.findByRole("spinbutton", { name: "最大推理步数" }),
  ).toHaveValue(60);
  expect(
    screen.queryByRole("spinbutton", { name: "审批期限（秒）" }),
  ).toBeNull();
});
it("saves unlimited model retries and displays it as a setting", async () => {
  let saved = agent;
  override = async (path, options) => {
    if (!path.endsWith("/definitions/4")) return;
    if (options.method === "PATCH") {
      const body = options.body as Pick<AgentDefinition, "runtime_policy">;
      saved = { ...agent, runtime_policy: body.runtime_policy };
    }
    return response(saved, saved === agent ? '"version-1"' : '"version-2"');
  };
  const { user } = mount("/admin/agents/4?tab=runtime&view=edit");
  const retry = await screen.findByRole("spinbutton", {
    name: "模型 API 自动重试次数",
  });
  expect(retry).toHaveValue(5);
  const unlimited = screen.getByRole("switch", { name: "不限次数" });
  expect(unlimited).not.toBeChecked();
  await user.click(unlimited);
  expect(unlimited).toBeChecked();
  expect(retry).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "保存本分区" }));
  await waitFor(() =>
    expect(saved.runtime_policy).toEqual({
      ...agent.runtime_policy,
      max_model_retries: -1,
    }),
  );
});
it.each(["mcp", "skills"])(
  "renders bound %s resources as readable links and states before editing",
  async (tab) => {
    override = async (path) => {
      if (path.endsWith("/mcp-bindings"))
        return response({
          items: [{ mcp_server_id: "12", enabled: true }],
          version: "1",
        });
      if (path.endsWith("/mcp-servers/12"))
        return response({
          name: "资料检索服务",
          config: { url: "https://example.com/mcp" },
        });
      if (path.endsWith("/skill-bindings"))
        return response({
          items: [{ skill_id: "8", skill_version_id: "2", enabled: true }],
          version: "1",
        });
      if (path.endsWith("/skills/8/versions/2"))
        return response({ version_label: "1.0.0" });
    };
    const { user } = mount(`/admin/agents/4?tab=${tab}`);
    expect(
      await screen.findByRole("link", {
        name: tab === "mcp" ? "资料检索服务" : "发布核查",
      }),
    ).toBeVisible();
    expect(screen.queryByRole("switch")).toBeNull();
    expect(screen.queryByRole("button", { name: "移除" })).toBeNull();
    await user.click(screen.getByRole("link", { name: "编辑配置" }));
    expect(await screen.findByRole("switch")).toBeChecked();
    expect(screen.getByRole("button", { name: "移除" })).toBeVisible();
  },
);
it("reads service identity permissions without exposing grant controls", async () => {
  override = async (path) => {
    if (path.startsWith("/admin/robots/9/grants/projects?"))
      return response({
        items: [
          {
            id: "10",
            name: "产品研发",
            code: "product",
            direct_role: "admin",
            is_member: true,
            membership_version: "1",
          },
        ],
        total: 1,
      });
  };
  const { user } = mount("/admin/agents/4?tab=resources");
  expect(await screen.findByText("产品研发")).toBeVisible();
  expect(
    screen.queryByRole("combobox", { name: "产品研发 的直接权限" }),
  ).toBeNull();
  expect(screen.queryByRole("button", { name: /^保存$/ })).toBeNull();
  await user.click(screen.getByRole("link", { name: "编辑配置" }));
  expect(
    await screen.findByRole("combobox", { name: "产品研发 的直接权限" }),
  ).toBeVisible();
});
it("reads service cloud capacity and network rules without editable fields", async () => {
  override = async (path) => {
    if (path.endsWith("/cloud-computer-spec"))
      return response({
        agent_id: "4",
        version: "1",
        config_version: "1",
        spec_id: "1",
        spec: {
          id: "1",
          name: "测试规格",
          config_version: "1",
          version: "1",
          image: "registry.example.com/runtime:1.0.0",
          cpu_millicores: 2000,
          memory_mib: 4096,
          network: {
            default_action: "deny",
            preset_ids: [],
            allow_targets: ["example.com"],
            deny_targets: [],
          },
        },
      });
  };
  mount("/admin/agents/4?tab=computer");
  expect(
    await screen.findByText("registry.example.com/runtime:1.0.0"),
  ).toBeVisible();
  expect(screen.getByText("example.com")).toBeVisible();
  expect(screen.queryByRole("spinbutton")).toBeNull();
  expect(screen.queryByRole("button", { name: "保存创建配置" })).toBeNull();
});
it("protects a dirty configuration when switching tabs and preserves drafts on a version conflict", async () => {
  override = async (path, options) => {
    if (path.endsWith("/definitions/4") && options.method === "PATCH")
      throw new ApiError("ETAG_MISMATCH", "配置已修改", 412);
  };
  const { user } = mount("/admin/agents/4?view=edit");
  const name = await screen.findByRole("textbox", { name: "助手名称" });
  await user.clear(name);
  await user.type(name, "保留我的草稿");
  await user.click(screen.getByRole("link", { name: "内置工具" }));
  expect(
    await screen.findByRole("dialog", { name: "离开当前页面？" }),
  ).toBeVisible();
  await user.click(screen.getByRole("button", { name: "取消" }));
  expect(name).toHaveValue("保留我的草稿");
  await user.click(screen.getByRole("button", { name: "保存本分区" }));
  expect(await screen.findByText("需要核对最新配置")).toBeVisible();
  expect(name).toHaveValue("保留我的草稿");
});
it("retains a dirty draft and original edit version when background data refreshes", async () => {
  const { user, cache } = mount("/admin/agents/4?view=edit");
  const name = await screen.findByRole("textbox", { name: "助手名称" });
  await user.clear(name);
  await user.type(name, "正在编辑的草稿");
  act(() =>
    cache.setQueryData(
      ["agents", "definition", "4"],
      response({ ...agent, name: "另一管理员的新名称", version: "v2" }, '"v2"'),
    ),
  );
  expect(screen.getByRole("textbox", { name: "助手名称" })).toHaveValue(
    "正在编辑的草稿",
  );
  await user.click(screen.getByRole("button", { name: "保存本分区" }));
  await waitFor(() =>
    expect(
      mocked.mock.calls.some(([, options]) => options?.method === "PATCH"),
    ).toBe(true),
  );
  expect(
    mocked.mock.calls.find(([, options]) => options?.method === "PATCH")?.[1]
      ?.etag,
  ).toBe('"version-1"');
});
it("adopts a refreshed version in a pristine editor before the next save", async () => {
  const { user, cache } = mount("/admin/agents/4?view=edit");
  await screen.findByRole("textbox", { name: "助手名称" });
  act(() =>
    cache.setQueryData(
      ["agents", "definition", "4"],
      response({ ...agent, name: "最新名称", version: "v2" }, '"v2"'),
    ),
  );
  const name = screen.getByRole("textbox", { name: "助手名称" });
  await waitFor(() => expect(name).toHaveValue("最新名称"));
  await user.type(name, "更新");
  await user.click(screen.getByRole("button", { name: "保存本分区" }));
  await waitFor(() =>
    expect(
      mocked.mock.calls.find(([, options]) => options?.method === "PATCH")?.[1]
        ?.etag,
    ).toBe('"v2"'),
  );
});
it("does not offer human confirmation for a service identity", async () => {
  const { user } = mount("/admin/agents/4?tab=tools&view=edit");
  await user.click(await screen.findByRole("switch", { name: "启用检查工具" }));
  expect(screen.getByText("允许")).toBeVisible();
  expect(
    screen.queryByRole("combobox", { name: "检查工具的执行策略" }),
  ).toBeNull();
  expect(screen.queryByText("每次确认")).toBeNull();
});
it("restores a chat tool's draft policy and constraints when toggled back on", async () => {
  override = async (path) => {
    if (path.endsWith("/definitions/4"))
      return response({ ...agent, agent_type: "chat", robot_user_id: null });
    if (path.endsWith("/tool-bindings"))
      return response({
        items: [
          {
            tool_key: "test_tool",
            policy: "allow",
            parameter_constraints: { limit: 3 },
          },
        ],
        version: "1",
      });
  };
  const { user } = mount("/admin/agents/4?tab=tools");
  const toggle = await screen.findByRole("switch", { name: "启用检查工具" });
  await user.click(
    screen.getByRole("combobox", { name: "检查工具的执行策略" }),
  );
  await user.click(await screen.findByRole("option", { name: "每次确认" }));
  await user.click(toggle);
  await user.click(toggle);
  expect(
    screen.getByRole("combobox", { name: "检查工具的执行策略" }),
  ).toHaveTextContent("每次确认");
  await user.click(screen.getByRole("button", { name: "检查工具" }));
  expect(screen.getByRole("textbox", { name: "参数限制（JSON）" })).toHaveValue(
    JSON.stringify({ limit: 3 }, null, 2),
  );
  await user.click(screen.getByRole("button", { name: "取消修改" }));
  expect(
    screen.getByRole("combobox", { name: "检查工具的执行策略" }),
  ).toHaveTextContent("允许");
  expect(screen.getByRole("button", { name: "保存本分区" })).toBeDisabled();
});
it("filters bound tools without dropping hidden bindings or pending edits on save", async () => {
  const items = [
    { tool_key: "test_tool", policy: "deny", parameter_constraints: {} },
    {
      tool_key: "legacy_tool",
      policy: "deny",
      parameter_constraints: { limit: 3 },
    },
  ];
  override = async (path, options) => {
    if (path.endsWith("/tool-bindings"))
      return response({
        items:
          options.method === "PUT"
            ? (options.body as { items: unknown[] }).items
            : items,
        version: "version-1",
      });
  };
  const { user } = mount("/admin/agents/4?tab=tools&view=edit");
  const toggle = await screen.findByRole("switch", { name: "启用检查工具" });
  const search = screen.getByRole("textbox", { name: "搜索工具" });
  await user.type(search, "TEST_TOOL");
  expect(screen.queryByRole("button", { name: "legacy_tool" })).toBeNull();
  await user.click(toggle);
  await user.click(screen.getByRole("button", { name: /^未启用/ }));
  expect(screen.getByText("没有符合条件的工具")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "清除筛选" }));
  expect(screen.getByRole("button", { name: "legacy_tool" })).toBeVisible();
  expect(screen.getByRole("switch", { name: "启用检查工具" })).toBeChecked();
  await user.type(search, "没有匹配项");
  await user.click(screen.getByRole("button", { name: "保存本分区" }));
  await waitFor(() =>
    expect(
      mocked.mock.calls.some(
        ([path, options]) =>
          path.endsWith("/tool-bindings") && options?.method === "PUT",
      ),
    ).toBe(true),
  );
  expect(
    mocked.mock.calls.find(
      ([path, options]) =>
        path.endsWith("/tool-bindings") && options?.method === "PUT",
    )?.[1]?.body,
  ).toEqual({
    items: [{ ...items[0], policy: "allow" }, items[1]],
  });
});
it("keeps search and fetch routes independent, with no automatic provider fallback", async () => {
  const settings = {
    search: { routes: [], max_results: 5 },
    fetch: {
      routes: [],
      max_bytes: 2097152,
      timeout_seconds: 20,
      max_redirects: 3,
      allowed_internal_hosts: [],
    },
    version: "version-1",
  };
  override = async (path, options) => {
    if (path.endsWith("/settings/state"))
      return response({
        search: { available: false, reason: "not_configured", routes: [] },
        fetch: { available: false, reason: "not_configured", routes: [] },
      });
    if (path.endsWith("/settings")) {
      if (options.method === "PUT") {
        expect(options.body).toEqual({
          search: settings.search,
          fetch: {
            ...settings.fetch,
            routes: [{ kind: "builtin", id: "http" }],
          },
        });
        expect(options.etag).toBe('"version-1"');
        return response(
          { ...(options.body as object), version: "version-2" },
          '"version-2"',
        );
      }
      return response(settings);
    }
  };
  const { user } = mount("/admin/web-access/settings");
  await user.click(await screen.findByRole("button", { name: "配置网页读取" }));
  await user.click(
    await screen.findByRole("button", { name: "添加内置 HTTP 读取" }),
  );
  await user.click(screen.getByRole("button", { name: "保存配置" }));
  await waitFor(() =>
    expect(
      mocked.mock.calls.some(
        ([path, options]) =>
          path.endsWith("/settings") && options?.method === "PUT",
      ),
    ).toBe(true),
  );
});
it("requires an explicit publication after validation, carrying the skill ETag", async () => {
  override = async (path, options) => {
    if (path.endsWith("/skills/8/versions") && options.method === "POST") {
      expect(options.body).toEqual({
        upload_operation_id: "91",
        version_label: "1.0.0",
        change_note: "",
      });
      expect(options.etag).toBe('"version-1"');
      expect(options.idempotencyKey).toBeTruthy();
      return response({ skill_id: "8", id: "92" });
    }
  };
  const { user, router } = mount("/admin/skills/8/upload?upload=91");
  expect(await screen.findByText("校验通过")).toBeVisible();
  expect(
    mocked.mock.calls.some(([, options]) => options?.method === "POST"),
  ).toBe(false);
  await user.clear(screen.getByLabelText("版本号"));
  await user.type(screen.getByLabelText("版本号"), "1.0.0");
  await user.click(screen.getByRole("button", { name: "发布版本" }));
  await waitFor(() =>
    expect(router.state.location.pathname).toBe("/admin/skills/8/versions/92"),
  );
});

it("creates from parsed ZIP metadata, retaining edited fields and the original request on retry", async () => {
  let first: RequestOptions | undefined;
  override = async (path, options) => {
    if (path.endsWith("/skills/uploads/91"))
      return response({ ...upload, skill_id: null });
    if (path.endsWith("/skills/from-upload") && options.method === "POST") {
      if (!first) {
        first = options;
        throw new ApiError(
          "NETWORK_ERROR",
          "响应未知",
          0,
          [],
          undefined,
          undefined,
          true,
        );
      }
      expect(options.idempotencyKey).toBe(first.idempotencyKey);
      expect(options.body).toEqual(first.body);
      return response({ skill_id: "8", id: "92" });
    }
  };
  const { user, router } = mount("/admin/skills/new?upload=91");
  const title = await screen.findByRole("textbox", { name: "展示名称" });
  expect(title).toHaveValue("release-review");
  expect(screen.getByRole("textbox", { name: "技能名称" })).toHaveAttribute(
    "readonly",
  );
  expect(screen.getByRole("textbox", { name: "描述" })).toHaveValue(
    "发布前核查",
  );
  expect(screen.getByLabelText("版本号")).toHaveValue("0.1.0");
  await user.clear(title);
  await user.type(title, "上线检查");
  await user.click(screen.getByRole("button", { name: "创建并发布" }));
  expect(await screen.findByText("提交结果尚未确认")).toBeVisible();
  expect(title).toHaveValue("上线检查");
  expect(title).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "重试原请求" }));
  await waitFor(() =>
    expect(router.state.location.pathname).toBe("/admin/skills/8/versions/92"),
  );
  expect(first?.body).toEqual({
    upload_operation_id: "91",
    title: "上线检查",
    description: "发布前核查",
    version_label: "0.1.0",
    change_note: "",
  });
});

it("increments from the latest published version and permits a manual override", async () => {
  override = async (path) =>
    path.endsWith("/skills/8")
      ? response({ ...skill, latest_version_label: "1.2.3" })
      : undefined;
  const { user } = mount("/admin/skills/8/upload?upload=91");
  const label = await screen.findByLabelText("版本号");
  expect(label).toHaveValue("1.2.4");
  await user.click(screen.getByRole("button", { name: /主版本 \+1/ }));
  expect(label).toHaveValue("2.0.0");
  await user.click(screen.getByRole("button", { name: /次版本 \+1/ }));
  expect(label).toHaveValue("1.3.0");
  await user.click(screen.getByRole("button", { name: /修订版本 \+1/ }));
  expect(label).toHaveValue("1.2.4");
  await user.clear(label);
  await user.type(label, "release-2026");
  expect(label).toHaveValue("release-2026");
});

it("requires manual input for legacy version labels", async () => {
  override = async (path) =>
    path.endsWith("/skills/8")
      ? response({ ...skill, latest_version_label: "v1" })
      : undefined;
  mount("/admin/skills/8/upload?upload=91");
  expect(await screen.findByLabelText("版本号")).toHaveValue("");
  expect(screen.getByRole("button", { name: /主版本 \+1/ })).toBeDisabled();
});

it("opens editing from the card menu and protects unsaved changes on drawer close", async () => {
  const { user } = mount("/admin/skills");
  expect(await screen.findByRole("list", { name: "技能列表" })).toBeVisible();
  expect(
    screen.getByRole("heading", { name: "技能库", level: 1 }),
  ).toBeVisible();
  expect(screen.queryByText("暂无描述")).not.toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "查看 发布核查 的说明" }),
  ).toBeVisible();
  await user.click(screen.getByRole("button", { name: "发布核查更多操作" }));
  await user.click(await screen.findByRole("menuitem", { name: "编辑信息" }));
  const title = await screen.findByRole("textbox", { name: "展示名称" });
  const drawer = screen.getByRole("dialog", { name: "编辑技能信息" });
  await user.type(title, "草稿");
  await user.click(within(drawer).getByRole("button", { name: "取消" }));
  expect(
    await screen.findByRole("dialog", { name: "放弃未保存的修改？" }),
  ).toBeVisible();
  await user.click(screen.getByRole("button", { name: "放弃修改" }));
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  expect(
    screen.getByRole("button", { name: "发布核查更多操作" }),
  ).toHaveFocus();
  expect(
    mocked.mock.calls.some(([, options]) => options?.method === "PATCH"),
  ).toBe(false);
});

it("keeps page sizes on complete grid rows when the desktop width changes", async () => {
  let width = 1328;
  const original = HTMLElement.prototype.getBoundingClientRect;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      return this.classList.contains("skill-grid-area")
        ? {
            width,
            top: 160,
            height: 500,
            left: 0,
            right: width,
            bottom: 660,
            x: 0,
            y: 160,
            toJSON: () => ({}),
          }
        : original.call(this);
    },
  );
  vi.stubGlobal("innerHeight", 900);
  const { user } = mount("/admin/skills");
  await screen.findByRole("list", { name: "技能列表" });
  await waitFor(() =>
    expect(
      mocked.mock.calls.some(
        ([path]) =>
          path.includes("skills?") &&
          new URLSearchParams(path.split("?")[1]).get("page_size") === "16",
      ),
    ).toBe(true),
  );
  width = 1000;
  fireEvent(window, new Event("resize"));
  await waitFor(() =>
    expect(
      mocked.mock.calls.some(
        ([path]) =>
          path.includes("skills?") &&
          new URLSearchParams(path.split("?")[1]).get("page_size") === "12",
      ),
    ).toBe(true),
  );
  await waitFor(() =>
    expect(screen.getByRole("combobox", { name: "每页条数" })).toBeEnabled(),
  );
  await user.click(screen.getByRole("combobox", { name: "每页条数" }));
  for (const option of await screen.findAllByRole("option"))
    expect(Number(option.textContent) % 3).toBe(0);
});

it("accepts a dropped ZIP and restores the validation step from its URL", async () => {
  override = async (path, options) => {
    if (path.endsWith("/skills/uploads") && options.method === "POST") {
      expect(options.body).toBeInstanceOf(FormData);
      expect((options.body as FormData).get("file")).toBeInstanceOf(File);
      return response({ id: "91" });
    }
    if (path.endsWith("/skills/uploads/91"))
      return response({ ...upload, skill_id: null });
  };
  const { user, router } = mount("/admin/skills?action=create");
  const drop = await screen.findByTestId("skill-dropzone");
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "选择文件" })).toBeEnabled(),
  );
  fireEvent.drop(drop, {
    dataTransfer: {
      files: [new File(["zip"], "review.zip", { type: "application/zip" })],
    },
  });
  expect(screen.getByText("review.zip")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "上传并校验" }));
  expect(await screen.findByRole("textbox", { name: "展示名称" })).toHaveValue(
    "release-review",
  );
  expect(router.state.location.search).toContain("upload=91");
  expect(router.state.location.search).toContain("action=create");
  await user.click(screen.getByRole("button", { name: "取消" }));
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
});

it("opens the latest version directly and keeps its ZIP download on the API origin", async () => {
  const version = {
    id: "92",
    skill_id: "8",
    version_label: "0.1.0",
    state: "ready",
    version: "v1",
    change_note: "首次发布",
    created_at: agent.created_at,
    archive_sha256: "abcd",
    manifest: {
      file_count: 1,
      total_bytes: "12",
      entries: [
        {
          path: "SKILL.md",
          size_bytes: "12",
          sha256: "hash",
          media_type: "text/markdown",
        },
      ],
    },
  };
  override = async (path) => {
    if (path.endsWith("/skills/8"))
      return response({
        ...skill,
        latest_version_id: "92",
        latest_version_label: "0.1.0",
      });
    if (path.includes("/skills/8/versions?"))
      return { ...response([version]), pagination: { total: 1 } };
    if (path.endsWith("/skills/8/versions/92")) return response(version);
    if (path.includes("/versions/92/content?"))
      return response({ path: "SKILL.md", text: "# Release review" });
  };
  const { user } = mount("/admin/skills/8");
  expect(await screen.findByRole("tree")).toBeVisible();
  expect(
    await screen.findByRole("heading", { name: "Release review" }),
  ).toBeVisible();
  const fileHeader = screen
    .getByRole("button", { name: "预览" })
    .closest("header")!;
  expect(
    within(fileHeader).getByRole("button", { name: "目录" }),
  ).toBeVisible();
  expect(
    within(fileHeader).getByRole("button", { name: "复制文件内容" }),
  ).toBeVisible();
  await user.click(within(fileHeader).getByRole("button", { name: "源码" }));
  expect(
    await within(fileHeader).findByRole("button", { name: "自动换行" }),
  ).toBeVisible();
  expect(screen.queryByText("Markdown 源码")).not.toBeInTheDocument();
  expect(
    within(fileHeader).queryByRole("button", { name: "目录" }),
  ).not.toBeInTheDocument();
  await user.click(within(fileHeader).getByRole("button", { name: "预览" }));
  expect(screen.getByRole("link", { name: "下载 ZIP" })).toHaveAttribute(
    "href",
    "/api/v1/admin/agents/skills/8/versions/92/archive",
  );
  expect(screen.queryByText("abcd")).not.toBeInTheDocument();
  expect(screen.queryByText("首次发布")).not.toBeInTheDocument();
  expect(screen.queryByText("暂无描述")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "查看版本信息" }));
  expect(await screen.findByText("首次发布")).toBeVisible();
  expect(await screen.findByText("abcd")).toBeVisible();
  await user.keyboard("{Escape}");
  await user.click(screen.getByRole("button", { name: "历史版本" }));
  expect(await screen.findByRole("table", { name: "历史版本" })).toBeVisible();
  expect(screen.getByRole("link", { name: "0.1.0" })).toHaveAttribute(
    "href",
    "/admin/skills/8/versions/92",
  );
});
