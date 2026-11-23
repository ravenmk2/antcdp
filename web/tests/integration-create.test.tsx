import { ApiError, request, type RequestOptions } from "@/api/client";
import { IntegrationsPage as ProjectIntegrationsPage } from "@/areas/workspace/pages/integrations";
import { IntegrationsPage as SystemIntegrationsPage } from "@/areas/console/pages/integrations";
import { NavigationGuardProvider } from "@/components/navigation-guard";
import { serviceProviders } from "@/domain/service-providers";
import type { ServiceConnection } from "@/types/integrations";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, Outlet, RouterProvider } from "react-router";
import { beforeEach, expect, it, vi } from "vitest";

vi.mock("@/api/client", async (original) => ({
  ...(await original<typeof import("@/api/client")>()),
  request: vi.fn(),
}));
vi.mock("@/app/auth", () => ({ useAuth: () => ({ settings: {} }) }));
const mocked = vi.mocked(request);
const response = (data: unknown) => ({ data, etag: '"v1"', status: 200 });
let connections: ServiceConnection[];
let connectionFailure: ApiError | undefined;
let deferred: Promise<void> | undefined;
beforeEach(() => {
  connections = [];
  connectionFailure = undefined;
  deferred = undefined;
  mocked.mockImplementation(async (path, options: RequestOptions = {}) => {
    if (path === "/projects/7")
      return response({
        id: "7",
        name: "测试项目",
        status: "active",
        can_manage: true,
      });
    if (path === "/service-types")
      return response({
        items: serviceProviders.map((p) => ({
          service_type: p.type,
          name: p.name,
          credentials: true,
          auth_methods: p.methods.map((m) => m.value),
          connection_test: true,
          webhook: { supported: false, verification_methods: [] },
          operations: [],
        })),
      });
    if (
      [
        "/service-connections",
        "/admin/service-connections",
        "/projects/7/service-connections",
      ].includes(path)
    )
      return response({ items: [...connections] });
    if (path.endsWith("/credentials")) return response({ items: [] });
    if (path.endsWith("/preferred")) return response({ credential_id: null });
    if (
      [
        "/admin/service-connections/gitlab",
        "/projects/7/service-connections/gitlab",
      ].includes(path) &&
      options.method === "POST"
    ) {
      await deferred;
      if (connectionFailure) throw connectionFailure;
      const connection = {
        ...(options.body as object),
        service_type: "gitlab",
        ownership_type: path.startsWith("/projects/") ? "project" : "platform",
        project_id: path.startsWith("/projects/") ? "7" : null,
        id: "1",
      } as ServiceConnection;
      connections.push(connection);
      return response(connection);
    }
    if (path.endsWith("/diagnostics")) return response({ latest: null });
    if (path.endsWith("/1")) return response(connections[0]);
    throw new Error(`Unexpected request ${path}`);
  });
});
function setup(entry = "/admin/integrations?create=1&q=kept") {
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
            path: "/projects/:projectId/integrations/:connectionId?",
            element: <ProjectIntegrationsPage />,
          },
          {
            path: "/admin/integrations/:connectionId?",
            element: <SystemIntegrationsPage />,
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
async function fill(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("radio", { name: /GitLab/ }));
  await user.click(screen.getByRole("button", { name: "下一步" }));
  await user.type(await screen.findByLabelText(/^连接名称/), "集成测试");
  await user.type(
    await screen.findByLabelText(/^GitLab 实例地址/),
    "https://gitlab.example.test",
  );
  await waitFor(() => {
    expect(screen.getByLabelText(/^连接名称/)).toHaveValue("集成测试");
    expect(screen.getByLabelText(/^GitLab 实例地址/)).toHaveValue(
      "https://gitlab.example.test",
    );
  });
}
const writes = (suffix: string) =>
  mocked.mock.calls.filter(
    ([url, options]) => url.endsWith(suffix) && options?.method === "POST",
  );
it("closes an untouched legacy drawer without confirmation and keeps filters", async () => {
  const { user, router } = setup("/admin/integrations/new?q=kept");
  const drawer = await screen.findByRole("dialog", { name: "添加服务连接" });
  await user.click(within(drawer).getByRole("button", { name: "取消" }));
  await waitFor(() => expect(drawer).not.toBeInTheDocument());
  expect(router.state.location.pathname).toBe("/admin/integrations");
  expect(router.state.location.search).toBe("?q=kept");
});

it("blocks duplicate writes and editing while pending", async () => {
  let resolve!: () => void;
  deferred = new Promise<void>((done) => {
    resolve = done;
  });
  const { user } = setup();
  await fill(user);
  await user.dblClick(screen.getByRole("button", { name: "创建连接" }));
  expect(writes("/gitlab")).toHaveLength(1);
  expect(screen.getByLabelText(/^连接名称/)).toBeDisabled();
  expect(screen.getByRole("button", { name: "取消" })).toBeDisabled();
  resolve();
  await waitFor(() =>
    expect(
      screen.queryByRole("dialog", { name: "添加服务连接" }),
    ).not.toBeInTheDocument(),
  );
});
it("keeps an absent uncertain result locked, then reconciles a persisted connection without replay", async () => {
  const { user } = setup();
  await fill(user);
  connectionFailure = new ApiError(
    "NETWORK_ERROR",
    "响应丢失",
    0,
    [],
    undefined,
    undefined,
    true,
  );
  await user.click(screen.getByRole("button", { name: "创建连接" }));
  await user.click(await screen.findByRole("button", { name: "核实创建结果" }));
  await screen.findByText(/暂未查到连接/);
  expect(screen.getByLabelText(/^连接名称/)).toBeDisabled();
  connections.push({
    ...(writes("/gitlab")[0][1]?.body as object),
    service_type: "gitlab",
    ownership_type: "platform",
    project_id: null,
    id: "1",
  } as ServiceConnection);
  await user.click(screen.getByRole("button", { name: "核实创建结果" }));
  await screen.findByText(/已找到此编码的连接/);
  expect(writes("/gitlab")).toHaveLength(1);
  await user.click(screen.getByRole("button", { name: "进入连接详情" }));
  await waitFor(() =>
    expect(
      screen.queryByRole("dialog", { name: "添加服务连接" }),
    ).not.toBeInTheDocument(),
  );
});

it("preserves drafts on back and confirms clearing type-specific configuration", async () => {
  const { user } = setup();
  await fill(user);
  await user.click(screen.getByRole("button", { name: "上一步" }));
  await user.click(screen.getByRole("radio", { name: /GitLab/ }));
  await user.click(screen.getByRole("button", { name: "下一步" }));
  expect(screen.getByLabelText(/^GitLab 实例地址/)).toHaveValue(
    "https://gitlab.example.test",
  );
  await user.click(screen.getByRole("button", { name: "上一步" }));
  await user.click(screen.getByRole("radio", { name: /MySQL/ }));
  await screen.findByRole("dialog", { name: "更换服务类型？" });
  await user.click(screen.getByRole("button", { name: "更换类型" }));
  await user.click(screen.getByRole("button", { name: "下一步" }));
  expect(screen.getByLabelText(/^连接名称/)).toHaveValue("集成测试");
  expect(screen.getByRole("textbox", { name: /^主机/ })).toHaveValue("");
});

it("returns a connection error from final submission to the second step and focuses its code", async () => {
  const { user } = setup();
  await fill(user);
  connectionFailure = new ApiError(
    "CONNECTION_CODE_CONFLICT",
    "编码已存在",
    409,
  );
  await user.click(screen.getByRole("button", { name: "创建连接" }));
  await waitFor(() => expect(screen.getByLabelText(/^连接编码/)).toHaveFocus());
  expect(screen.getByLabelText(/^连接名称/)).toBeVisible();
  expect(
    screen.queryByLabelText("同时添加访问凭证（可选）"),
  ).not.toBeInTheDocument();
});

it("does not let a pending step-focus callback overwrite active input", async () => {
  const { user } = setup();
  await user.click(await screen.findByRole("radio", { name: /GitLab/ }));
  const frames: FrameRequestCallback[] = [];
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    frames.push(callback);
    return frames.length;
  });
  await user.click(screen.getByRole("button", { name: "下一步" }));
  const name = await screen.findByLabelText(/^连接名称/);
  name.focus();
  await user.keyboard("集");
  for (const callback of frames.splice(0)) callback(0);
  await user.keyboard("成测试");
  expect(name).toHaveValue("集成测试");
});

it("creates a project connection when a shared platform connection already has the same code", async () => {
  connections = [
    {
      id: "shared",
      name: "共享 GitLab",
      code: "same-code",
      ownership_type: "platform",
      project_id: null,
      service_type: "gitlab",
      enabled: true,
      description: "",
    },
  ];
  const { user, router } = setup("/projects/7/integrations?create=1");
  await fill(user);
  await user.type(screen.getByLabelText(/^连接编码/), "same-code");
  await user.click(screen.getByRole("button", { name: "创建连接" }));
  await waitFor(() =>
    expect(router.state.location.pathname).toBe("/projects/7/integrations/1"),
  );
  expect(
    mocked.mock.calls.some(
      ([path, options]) =>
        path === "/projects/7/service-connections/gitlab" &&
        options?.method === "POST",
    ),
  ).toBe(true);
});
