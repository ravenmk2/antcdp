import { ApiError, request, type RequestOptions } from "@/api/client";
import { IntegrationsPage as AccountIntegrationsPage } from "@/areas/account/pages/integrations";
import { IntegrationsPage as SystemIntegrationsPage } from "@/areas/console/pages/integrations";
import { IntegrationsPage as ProjectIntegrationsPage } from "@/areas/workspace/pages/integrations";
import { NavigationGuardProvider } from "@/components/navigation-guard";
import { defaultConfig, serviceProviders } from "@/domain/service-providers";
import type { Diagnostic, ServiceConnection } from "@/types/integrations";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, Outlet, RouterProvider } from "react-router";
import { beforeEach, expect, it, vi } from "vitest";

vi.mock("@/api/client", async (original) => ({
  ...(await original<typeof import("@/api/client")>()),
  request: vi.fn(),
}));
vi.mock("@/app/auth", () => ({
  useAuth: () => ({ settings: { timezone: "Asia/Shanghai" } }),
}));
const mocked = vi.mocked(request);
let connection: ServiceConnection;
let version: number;
let failure: ApiError | undefined;
let persistBeforeFailure: boolean;
let diagnostic: Diagnostic;
let webhookEnabled: boolean;
let webhookSecret: boolean;
let pendingWrite: Promise<void> | undefined;
const response = (data: unknown) => ({
  data: structuredClone(data),
  etag: `"v${version}"`,
  status: 200,
});
beforeEach(() => {
  version = 1;
  failure = undefined;
  persistBeforeFailure = false;
  webhookEnabled = true;
  webhookSecret = true;
  pendingWrite = undefined;
  diagnostic = {
    id: "diag-1",
    kind: "connection_check",
    outdated: false,
    status: "succeeded",
    started_at: "2026-11-07T01:00:00Z",
    finished_at: "2026-11-07T01:00:01Z",
    summary: {},
  };
  mocked.mockImplementation(async (path, options: RequestOptions = {}) => {
    if (path === "/service-types")
      return response({
        items: serviceProviders.map((p) => ({
          service_type: p.type,
          name: p.name,
          credentials: true,
          connection_test: true,
          auth_methods: p.methods.map((m) => m.value),
          webhook: {
            supported: p.type === "gitlab",
            verification_methods: ["secret_token", "signing_token"],
          },
          operations: [],
        })),
      });
    if (path === "/service-connections")
      return response({ items: [connection] });
    if (path === "/projects/7")
      return response({ id: "7", name: "交付平台", status: "active" });
    if (path.endsWith("/webhook/receiver"))
      return response({
        receive_url: "https://app.example.test/api/v1/webhooks/gitlab/1",
      });
    if (path.endsWith("/webhook/diagnostics"))
      return response({ latest: null });
    if (path.endsWith("/webhook/verification/generate"))
      return response({
        webhook: {},
        secret: { token: "generated-test-token" },
      });
    if (path.endsWith("/webhook/verification")) return response({});
    if (path.endsWith("/webhook"))
      return response({
        connection_id: "1",
        enabled: webhookEnabled,
        has_secret: webhookSecret,
        verification_method: "secret_token",
        version: "1",
        updated_at: null,
      });
    if (path.endsWith("/credentials"))
      return response({ items: [], mutation_version: "1" });
    if (path.endsWith("/fallback-credential"))
      return response({ credential_id: null });
    if (path.endsWith("/diagnostics")) return response({ latest: diagnostic });
    if (path.endsWith("/test")) {
      diagnostic.outdated = false;
      return response(diagnostic);
    }
    if (path.endsWith("/1")) {
      if (options.method === "PATCH") {
        await pendingWrite;
        if (!failure || persistBeforeFailure) {
          Object.assign(connection, options.body);
          version++;
          diagnostic.outdated = true;
        }
        if (failure) throw failure;
      }
      return response(connection);
    }
    throw new Error(`Unexpected request ${path}`);
  });
});
function setup(
  type = "gitlab",
  suffix = "",
  scope = "admin",
  enabled = true,
  entry?: string,
) {
  const provider = serviceProviders.find((p) => p.type === type)!;
  const config = {
    ...defaultConfig(provider),
    base_url: "https://service.example.test",
    host: "db.example.test",
    database: "antcdp",
  };
  connection = {
    id: "1",
    code: `${type}-main`,
    name: `${provider.name} 实例`,
    description: "第一行说明\n第二行说明",
    enabled,
    service_type: type,
    config: provider.configBody(
      config,
    ) as unknown as ServiceConnection["config"],
  };
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  const router = createMemoryRouter(
    [
      {
        element: (
          <NavigationGuardProvider>
            <Outlet />
          </NavigationGuardProvider>
        ),
        children: [
          {
            path: "/admin/projects/:projectId/integrations/:connectionId?",
            element: <SystemIntegrationsPage project />,
          },
          {
            path: "/admin/integrations/:connectionId?",
            element: <SystemIntegrationsPage />,
          },
          {
            path: "/account/integrations/:connectionId?",
            element: <AccountIntegrationsPage />,
          },
          {
            path: "/projects/:projectId/integrations/:connectionId?",
            element: <ProjectIntegrationsPage />,
          },
          { path: "/elsewhere", element: <p>其他页面</p> },
        ],
      },
    ],
    { initialEntries: [entry ?? `/${scope}/integrations/1${suffix}`] },
  );
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { user: userEvent.setup(), router, client, provider };
}
const patches = () =>
  mocked.mock.calls.filter(([, options]) => options?.method === "PATCH");
it.each(serviceProviders.map((provider) => provider.type))(
  "renders and edits %s with its actual typed config in the shared page",
  async (type) => {
    const { user, provider } = setup(type, "?tab=unsupported");
    const heading = await screen.findByRole("heading", {
      name: new RegExp(`${provider.name} 实例`),
    });
    expect(heading.closest(".page")).not.toBeNull();
    expect(screen.getByRole("tab", { name: "连接配置" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.queryByRole("tab", { name: "Webhook 接收设置" })).toBe(
      type === "gitlab"
        ? screen.getByRole("tab", { name: "Webhook 接收设置" })
        : null,
    );
    await user.click(screen.getByRole("button", { name: "编辑配置" }));
    const drawer = await screen.findByRole("dialog", { name: "编辑连接配置" });
    const name = await within(drawer).findByLabelText(/^连接名称/);
    expect(within(drawer).getByLabelText("连接编码")).toHaveAttribute(
      "readonly",
    );
    if (provider.defaultPort)
      expect(within(drawer).getByRole("textbox", { name: "端口" })).toHaveValue(
        String(provider.defaultPort),
      );
    else
      expect(
        within(drawer).getByLabelText(
          new RegExp(provider.configFields[0].label),
        ),
      ).toHaveValue("https://service.example.test");
    await user.clear(name);
    await user.type(name, "更新后的名称");
    await user.click(within(drawer).getByRole("button", { name: "保存配置" }));
    await waitFor(() => expect(drawer).not.toBeInTheDocument());
    expect(patches()).toHaveLength(1);
    expect(patches()[0][1]?.etag).toBe('"v1"');
    expect(patches()[0][1]?.body).toMatchObject({
      name: "更新后的名称",
      config: connection.config,
    });
    await screen.findByText(/历史结果/);
  },
);
it("discards cancelled drafts and loads the current saved value on the next edit", async () => {
  const { user } = setup();
  await user.click(await screen.findByRole("button", { name: "编辑配置" }));
  const name = await screen.findByLabelText(/^连接名称/);
  await user.clear(name);
  await user.type(name, "不保存的名称");
  await user.click(screen.getByRole("button", { name: "取消" }));
  await user.click(screen.getByRole("button", { name: "放弃修改" }));
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  expect(screen.getByRole("button", { name: "编辑配置" })).toHaveFocus();
  await user.click(screen.getByRole("button", { name: "编辑配置" }));
  expect(await screen.findByLabelText(/^连接名称/)).toHaveValue("GitLab 实例");
  expect(patches()).toHaveLength(0);
});
it("keeps a draft through a version conflict and reloads the etag without replaying", async () => {
  const { user } = setup();
  await user.click(await screen.findByRole("button", { name: "编辑配置" }));
  await user.type(await screen.findByLabelText(/^连接名称/), " 草稿");
  failure = new ApiError("VERSION_CONFLICT", "版本已变化", 412);
  await user.click(screen.getByRole("button", { name: "保存配置" }));
  await screen.findByText("版本已变化");
  connection.name = "其他人保存的名称";
  version = 2;
  await user.click(screen.getByRole("button", { name: "重新加载配置" }));
  await screen.findByText(/已重新加载，草稿已保留/);
  expect(screen.getByLabelText(/^连接名称/)).toHaveValue("GitLab 实例 草稿");
  expect(patches()).toHaveLength(1);
  failure = undefined;
  await user.click(screen.getByRole("button", { name: "保存配置" }));
  await waitFor(() => expect(patches()).toHaveLength(2));
  expect(patches()[1][1]?.etag).toBe('"v2"');
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
});
it.each([false, true])(
  "reconciles an uncertain save without replay (persisted: %s)",
  async (persisted) => {
    const { user } = setup();
    await user.click(await screen.findByRole("button", { name: "编辑配置" }));
    await user.type(await screen.findByLabelText(/^连接名称/), " 新名称");
    failure = new ApiError(
      "NETWORK_ERROR",
      "结果未知",
      0,
      [],
      undefined,
      undefined,
      true,
    );
    persistBeforeFailure = persisted;
    await user.click(screen.getByRole("button", { name: "保存配置" }));
    await user.click(
      await screen.findByRole("button", { name: "核实保存结果" }),
    );
    if (persisted)
      await waitFor(() =>
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
      );
    else {
      await screen.findByText(/当前配置与本次草稿不一致/);
      expect(screen.getByRole("button", { name: "保存配置" })).toBeDisabled();
    }
    expect(patches()).toHaveLength(1);
  },
);
it("never renders admin config or webhook for a personal credential URL", async () => {
  setup("gitlab", "?tab=webhook", "account");
  await screen.findByRole("tab", { name: "访问凭证" });
  expect(
    screen.queryByRole("tab", { name: "连接配置" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("tab", { name: "Webhook 接收设置" }),
  ).not.toBeInTheDocument();
  expect(mocked.mock.calls.some(([path]) => path.startsWith("/admin"))).toBe(
    false,
  );
});
it("shows paused webhook reception and protects unpersisted secrets across tabs and navigation", async () => {
  const { user, router } = setup("gitlab", "?tab=webhook", "admin", false);
  await screen.findByText("接收暂停 · 连接已停用");
  await user.type(screen.getByLabelText(/^新验证秘密/), "draft-secret");
  await user.click(screen.getByRole("tab", { name: "连接配置" }));
  await user.click(screen.getByRole("tab", { name: "Webhook 接收设置" }));
  expect(screen.getByLabelText(/^新验证秘密/)).toHaveValue("draft-secret");
  await act(async () => {
    await router.navigate("/elsewhere");
  });
  await screen.findByRole("dialog", { name: "离开当前页面？" });
});
it("keeps generated tokens across tabs until explicitly cleared", async () => {
  const { user } = setup("gitlab", "?tab=webhook");
  await user.click(await screen.findByRole("button", { name: "生成新 Token" }));
  await screen.findByText(/将切换到 Secret Token 验证/);
  await user.click(screen.getByRole("button", { name: "确认替换" }));
  await screen.findByText("generated-test-token");
  await user.click(screen.getByRole("tab", { name: "连接配置" }));
  await user.click(screen.getByRole("tab", { name: "Webhook 接收设置" }));
  expect(screen.getByText("generated-test-token")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "我已保存，清除显示" }));
  expect(screen.queryByText("generated-test-token")).not.toBeInTheDocument();
});

it("freezes edits and prevents duplicate writes while a configuration save is pending", async () => {
  let resolve!: () => void;
  pendingWrite = new Promise<void>((done) => {
    resolve = done;
  });
  const { user } = setup();
  await user.click(await screen.findByRole("button", { name: "编辑配置" }));
  await user.type(await screen.findByLabelText(/^连接名称/), " 修改");
  await user.dblClick(screen.getByRole("button", { name: "保存配置" }));
  expect(patches()).toHaveLength(1);
  expect(screen.getByLabelText(/^连接名称/)).toBeDisabled();
  expect(screen.getByRole("button", { name: "取消" })).toBeDisabled();
  resolve();
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
});

it("validates database ports and focuses the error before writing", async () => {
  const { user } = setup("postgresql");
  await user.click(await screen.findByRole("button", { name: "编辑配置" }));
  const port = await screen.findByRole("textbox", { name: "端口" });
  await user.clear(port);
  await user.click(screen.getByRole("button", { name: "保存配置" }));
  await waitFor(() => expect(port).toHaveFocus());
  expect(patches()).toHaveLength(0);
});

it.each(serviceProviders.map((provider) => provider.type))(
  "returns from an untouched %s detail to the directory without a discard prompt",
  async (type) => {
    const { router } = setup(type);
    await screen.findByRole("button", { name: "编辑配置" });
    await act(async () => {
      await router.navigate("/admin/integrations");
    });
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/admin/integrations");
    await screen.findByRole("table", { name: "服务连接" });
  },
);

it("does not mount an unvisited webhook secret form on a read-only detail visit", async () => {
  setup();
  await screen.findByRole("button", { name: "编辑配置" });
  expect(document.querySelector('input[name="token"]')).toBeNull();
  expect(mocked.mock.calls.some(([path]) => path.endsWith("/webhook"))).toBe(
    false,
  );
});

it("allows leaving after viewing webhook settings but guards a real secret draft", async () => {
  const { user, router } = setup();
  await user.click(
    await screen.findByRole("tab", { name: "Webhook 接收设置" }),
  );
  const secret = await screen.findByLabelText("新验证秘密");
  await user.type(secret, "unsaved-secret");
  await user.click(screen.getByRole("tab", { name: "连接配置" }));
  await act(async () => {
    await router.navigate("/admin/integrations");
  });
  await screen.findByRole("button", { name: "放弃修改并离开" });
  await user.click(screen.getByRole("button", { name: "取消" }));
  await user.click(screen.getByRole("tab", { name: "Webhook 接收设置" }));
  await user.clear(screen.getByLabelText("新验证秘密"));
  await act(async () => {
    await router.navigate("/admin/integrations");
  });
  await screen.findByRole("table", { name: "服务连接" });
  expect(
    screen.queryByRole("button", { name: "放弃修改并离开" }),
  ).not.toBeInTheDocument();
});

it("keeps console project credential details out of system configuration", async () => {
  setup(
    "gitlab",
    "",
    "admin",
    true,
    "/admin/projects/7/integrations/1?tab=config",
  );
  expect(await screen.findByRole("tab", { name: "访问凭证" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  expect(
    screen.queryByRole("tab", { name: "连接配置" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("tab", { name: "Webhook 接收设置" }),
  ).not.toBeInTheDocument();
  await waitFor(() =>
    expect(
      mocked.mock.calls.some(
        ([path]) =>
          path === "/projects/7/service-connections/gitlab/1/credentials",
      ),
    ).toBe(true),
  );
  expect(mocked.mock.calls.some(([path]) => path.startsWith("/admin"))).toBe(
    false,
  );
});

it("uses nested console project links without offering system connection creation", async () => {
  setup("gitlab", "", "admin", true, "/admin/projects/7/integrations");
  expect(
    await screen.findByRole("heading", { name: "项目服务凭证" }),
  ).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "添加连接" }),
  ).not.toBeInTheDocument();
  const link = await screen.findByRole("link", { name: "GitLab 实例" });
  expect(link.getAttribute("href")).toContain(
    "/admin/projects/7/integrations/1",
  );
});
