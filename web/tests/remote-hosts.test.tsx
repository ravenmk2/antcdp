import { ApiError, request, type RequestOptions } from "@/api/client";
import { RemoteHostsPage as AccountRemoteHostsPage } from "@/areas/account/pages/remote-hosts";
import { RemoteHostsPage as SystemRemoteHostsPage } from "@/areas/console/pages/remote-hosts";
import { RemoteHostsPage as ProjectRemoteHostsPage } from "@/areas/workspace/pages/remote-hosts";
import { NavigationGuardProvider } from "@/components/navigation-guard";
import type { ServiceConnection } from "@/types/integrations";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, Outlet, RouterProvider } from "react-router";
import { beforeEach, expect, it, vi } from "vitest";

vi.mock("@/api/client", async (original) => ({
  ...(await original<typeof import("@/api/client")>()),
  request: vi.fn(),
}));
vi.mock("@/app/auth", () => ({ useAuth: () => ({ settings: {} }) }));

const initialHost: ServiceConnection = {
  id: "h1",
  name: "测试主机",
  code: "test-host",
  service_type: "ssh",
  description: "测试说明",
  enabled: true,
  config: {
    host: "host.example.test",
    port: 22,
    host_keys: [],
    custom_ca_pem: null,
  },
};
let hosts: ServiceConnection[];
let credentialFailure: ApiError | undefined;
let patchFailure: ApiError | undefined;
let deleteFailure: ApiError | undefined;
let pendingCreate: Promise<void> | undefined;
const mockedRequest = vi.mocked(request);
const response = (data: unknown) => ({ data, etag: '"v1"', status: 200 });

beforeEach(() => {
  hosts = [structuredClone(initialHost)];
  credentialFailure = undefined;
  patchFailure = undefined;
  deleteFailure = undefined;
  pendingCreate = undefined;
  mockedRequest.mockImplementation(
    async (path, options: RequestOptions = {}) => {
      if (path === "/remote-hosts") return response({ items: hosts });
      if (path === "/projects/7")
        return response({ id: "7", name: "交付平台", status: "active" });
      if (path === "/admin/remote-hosts" && options.method === "POST") {
        await pendingCreate;
        const host = { ...initialHost, ...(options.body as object), id: "h2" };
        hosts = [...hosts, host];
        return response(host);
      }
      if (path.endsWith("/credentials") && options.method === "POST") {
        if (credentialFailure) throw credentialFailure;
        return response({ id: "c1" });
      }
      if (path.endsWith("/credentials"))
        return response({ items: [], mutation_version: "1" });
      if (path.endsWith("/fallback-credential"))
        return response({ credential_id: null });
      if (path.endsWith("/diagnostics")) return response({ latest: null });
      const host = hosts.find((item) => path.endsWith(`/${item.id}`));
      if (host) {
        if (options.method === "DELETE" && deleteFailure) throw deleteFailure;
        if (options.method === "PATCH") {
          if (patchFailure) throw patchFailure;
          Object.assign(host, options.body);
        }
        return response({ ...host });
      }
      throw new Error(`Unexpected request ${path}`);
    },
  );
});

function setup(entry = "/admin/remote-hosts") {
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
            path: "/admin/projects/:projectId/remote-hosts/:hostId?",
            element: <SystemRemoteHostsPage project />,
          },
          {
            path: "/admin/remote-hosts/:hostId?",
            element: <SystemRemoteHostsPage />,
          },
          {
            path: "/account/remote-hosts/:hostId?",
            element: <AccountRemoteHostsPage />,
          },
          {
            path: "/projects/:projectId/remote-hosts/:hostId?",
            element: <ProjectRemoteHostsPage />,
          },
          { path: "/elsewhere", element: <p>其他页面</p> },
        ],
      },
    ],
    { initialEntries: [entry] },
  );
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { user: userEvent.setup(), router };
}

const writes = (path: string) =>
  mockedRequest.mock.calls.filter(
    ([url, options]) => url === path && options?.method === "POST",
  );

async function fillHost(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/^主机名称/), "新主机");
  await user.type(screen.getByLabelText(/^主机名 \/ IP/), "new.example.test");
  await user.click(screen.getByRole("button", { name: "下一步" }));
}

async function fillCredential(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/^凭证名称/), "系统登录");
  await user.type(screen.getByLabelText(/^登录用户名/), "tester");
  await user.type(screen.getByLabelText(/^密码/), "test-password");
}

it("opens a Sheet over the filtered list, validates/focuses fields, and confirms footer cancellation", async () => {
  const { user, router } = setup("/admin/remote-hosts?q=测试&status=enabled");
  const trigger = await screen.findByRole("button", { name: "添加主机" });
  await user.click(trigger);
  const dialog = await screen.findByRole("dialog", { name: "添加 SSH 主机" });
  expect(dialog).toHaveAttribute("data-slot", "sheet-content");
  expect(screen.getByText("测试主机")).toBeInTheDocument();
  expect(screen.queryByText("测试说明")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "下一步" }));
  await waitFor(() => expect(screen.getByLabelText(/^主机名称/)).toHaveFocus());
  await user.type(screen.getByLabelText(/^主机名称/), "未保存");
  await user.click(within(dialog).getByRole("button", { name: "取消" }));
  const confirm = await screen.findByRole("dialog", {
    name: "放弃未保存的修改？",
  });
  await user.click(within(confirm).getByRole("button", { name: "取消" }));
  expect(screen.getByLabelText(/^主机名称/)).toHaveValue("未保存");
  await user.click(within(dialog).getByRole("button", { name: "取消" }));
  await user.click(screen.getByRole("button", { name: "放弃修改" }));
  await waitFor(() => expect(dialog).not.toBeInTheDocument());
  expect(new URLSearchParams(router.state.location.search).get("q")).toBe(
    "测试",
  );
  expect(new URLSearchParams(router.state.location.search).get("status")).toBe(
    "enabled",
  );
  expect(new URLSearchParams(router.state.location.search).has("create")).toBe(
    false,
  );
  await waitFor(() => expect(trigger).toHaveFocus());
  expect(writes("/admin/remote-hosts")).toHaveLength(0);
});

it("supports the legacy new route and creates only a host without requiring credentials", async () => {
  const { user, router } = setup("/admin/remote-hosts/new");
  await screen.findByRole("dialog", { name: "添加 SSH 主机" });
  expect(await screen.findByText("测试主机")).toHaveAttribute(
    "href",
    "/admin/remote-hosts/h1",
  );
  await fillHost(user);
  await user.click(screen.getByRole("button", { name: "仅创建主机" }));
  await waitFor(() =>
    expect(router.state.location.pathname).toBe("/admin/remote-hosts/h2"),
  );
  expect(await screen.findByRole("button", { name: "编辑配置" })).toBeVisible();
  expect(writes("/admin/remote-hosts")).toHaveLength(1);
  expect(writes("/admin/remote-hosts/h2/credentials")).toHaveLength(0);
});

it("validates credentials before creating and retries only the credential after a known failure", async () => {
  credentialFailure = new ApiError("INVALID_INPUT", "凭证无效", 422);
  const { user, router } = setup("/admin/remote-hosts?create=1");
  await screen.findByRole("dialog", { name: "添加 SSH 主机" });
  await fillHost(user);
  await user.click(screen.getByRole("button", { name: "创建主机和凭证" }));
  await waitFor(() => expect(screen.getByLabelText(/^凭证名称/)).toHaveFocus());
  expect(writes("/admin/remote-hosts")).toHaveLength(0);
  await fillCredential(user);
  await user.click(screen.getByRole("button", { name: "创建主机和凭证" }));
  const retry = await screen.findByRole("button", { name: "重试创建凭证" });
  await waitFor(() => expect(retry).toBeEnabled());
  credentialFailure = undefined;
  await user.click(retry);
  await waitFor(() =>
    expect(router.state.location.pathname).toBe("/admin/remote-hosts/h2"),
  );
  expect(writes("/admin/remote-hosts")).toHaveLength(1);
  expect(writes("/admin/remote-hosts/h2/credentials")).toHaveLength(2);
  expect(writes("/admin/remote-hosts/h2/credentials")[1]?.[1]?.etag).toBe(
    '"v1"',
  );
});

it("blocks credential replay after an unknown result while allowing inspection of the created host", async () => {
  credentialFailure = new ApiError(
    "NETWORK_ERROR",
    "结果未知，请核实",
    0,
    [],
    undefined,
    undefined,
    true,
  );
  const { user, router } = setup("/admin/remote-hosts?create=1");
  await screen.findByRole("dialog", { name: "添加 SSH 主机" });
  await fillHost(user);
  await fillCredential(user);
  await user.click(screen.getByRole("button", { name: "创建主机和凭证" }));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "重试创建凭证" })).toBeDisabled(),
  );
  await user.click(screen.getByRole("button", { name: "进入主机详情" }));
  await waitFor(() =>
    expect(router.state.location.pathname).toBe("/admin/remote-hosts/h2"),
  );
  expect(writes("/admin/remote-hosts/h2/credentials")).toHaveLength(1);
});

it("retains configuration and key drafts across icon tabs and guards leaving the host", async () => {
  const { user, router } = setup("/admin/remote-hosts/h1");
  await user.click(await screen.findByRole("button", { name: "编辑配置" }));
  await user.clear(screen.getByLabelText(/^主机名称/));
  await user.type(screen.getByLabelText(/^主机名称/), "配置草稿");
  const keys = screen.getByRole("tab", { name: "主机公钥" });
  expect(keys.querySelector("svg")).not.toBeNull();
  await user.click(keys);
  await user.type(
    screen.getByLabelText("公钥", { exact: true }),
    "ssh-ed25519 draft",
  );
  await user.click(screen.getByRole("tab", { name: "主机配置" }));
  expect(screen.getByLabelText(/^主机名称/)).toHaveValue("配置草稿");
  await user.click(screen.getByRole("tab", { name: "主机公钥" }));
  expect(screen.getByLabelText("公钥", { exact: true })).toHaveValue(
    "ssh-ed25519 draft",
  );
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  await act(async () => {
    await router.navigate("/elsewhere");
  });
  const confirm = await screen.findByRole("dialog", { name: "离开当前页面？" });
  await user.click(within(confirm).getByRole("button", { name: "取消" }));
  expect(router.state.location.pathname).toBe("/admin/remote-hosts/h1");
  await act(async () => {
    await router.navigate("/elsewhere");
  });
  await user.click(screen.getByRole("button", { name: "放弃修改并离开" }));
  expect(await screen.findByText("其他页面")).toBeVisible();
});

it("groups lifecycle actions in a menu, retains delete confirmation, and preserves conflict drafts", async () => {
  patchFailure = new ApiError("VERSION_CONFLICT", "版本冲突，请重新加载", 412);
  const { user } = setup("/admin/remote-hosts/h1");
  const trigger = await screen.findByRole("button", { name: "主机的操作" });
  expect(
    screen.queryByRole("button", { name: "删除主机" }),
  ).not.toBeInTheDocument();
  await user.click(trigger);
  expect(
    (await screen.findAllByRole("menuitem")).map((item) => item.textContent),
  ).toEqual(["停用主机", "删除主机"]);
  await user.click(await screen.findByRole("menuitem", { name: "删除主机" }));
  const confirm = await screen.findByRole("dialog", { name: "删除远程主机" });
  expect(within(confirm).getByText(/删除前须清空全部归属凭证/)).toBeVisible();
  await user.click(within(confirm).getByRole("button", { name: "取消" }));
  await waitFor(() => expect(trigger).toHaveFocus());
  await user.click(screen.getByRole("button", { name: "编辑配置" }));
  await user.type(screen.getByLabelText(/^主机名称/), "修改");
  await user.click(screen.getByRole("button", { name: "保存配置" }));
  expect(await screen.findByText(/版本冲突，请重新加载/)).toBeVisible();
  expect(screen.getByLabelText(/^主机名称/)).toHaveValue("测试主机修改");
  expect(
    mockedRequest.mock.calls.find(
      ([, options]) => options?.method === "PATCH",
    )?.[1]?.etag,
  ).toBe('"v1"');
  expect(
    mockedRequest.mock.calls.some(
      ([, options]) => options?.method === "DELETE",
    ),
  ).toBe(false);
});

it("keeps personal access scoped to credentials even for an invalid management tab", async () => {
  setup("/account/remote-hosts/h1?tab=config");
  expect(await screen.findByRole("tab", { name: "访问凭证" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  expect(
    screen.queryByRole("button", { name: "主机的操作" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("tab", { name: "主机配置" }),
  ).not.toBeInTheDocument();
  await waitFor(() =>
    expect(
      mockedRequest.mock.calls.some(
        ([path]) => path === "/me/remote-hosts/h1/credentials",
      ),
    ).toBe(true),
  );
  expect(
    mockedRequest.mock.calls.some(([path]) => path.startsWith("/admin/")),
  ).toBe(false);
});

it("prevents duplicate creation and closing the drawer while a request is pending", async () => {
  let complete!: () => void;
  pendingCreate = new Promise<void>((resolve) => {
    complete = resolve;
  });
  const { user, router } = setup("/admin/remote-hosts?create=1");
  const dialog = await screen.findByRole("dialog", { name: "添加 SSH 主机" });
  await fillHost(user);
  const submit = screen.getByRole("button", { name: "仅创建主机" });
  await user.click(submit);
  await waitFor(() => expect(submit).toBeDisabled());
  await user.click(submit);
  expect(within(dialog).getByRole("button", { name: "关闭" })).toBeDisabled();
  expect(within(dialog).getByRole("button", { name: "取消" })).toBeDisabled();
  await user.keyboard("{Escape}");
  expect(dialog).toBeInTheDocument();
  expect(writes("/admin/remote-hosts")).toHaveLength(1);
  await act(async () => {
    complete();
  });
  await waitFor(() =>
    expect(router.state.location.pathname).toBe("/admin/remote-hosts/h2"),
  );
});

it("does not repeat a deletion whose result is unknown", async () => {
  deleteFailure = new ApiError(
    "NETWORK_ERROR",
    "删除结果未知，请刷新核实",
    0,
    [],
    undefined,
    undefined,
    true,
  );
  const { user } = setup("/admin/remote-hosts/h1");
  await user.click(await screen.findByRole("button", { name: "主机的操作" }));
  await user.click(await screen.findByRole("menuitem", { name: "删除主机" }));
  const dialog = await screen.findByRole("dialog", { name: "删除远程主机" });
  const remove = within(dialog).getByRole("button", { name: "删除主机" });
  await user.click(remove);
  await waitFor(() =>
    expect(within(dialog).getByText(/删除结果未知/)).toBeVisible(),
  );
  expect(remove).toBeDisabled();
  await user.click(remove);
  expect(
    mockedRequest.mock.calls.filter(
      ([, options]) => options?.method === "DELETE",
    ),
  ).toHaveLength(1);
});

it("keeps long descriptions out of table cells and exposes the full text in a keyboard-accessible popover", async () => {
  hosts[0]!.description = "第一行说明\n" + "长说明内容".repeat(150);
  const { user } = setup();
  const trigger = await screen.findByRole("button", {
    name: "查看 测试主机 的说明",
  });
  const table = screen.getByRole("table", { name: "远程主机" });
  expect(
    within(table)
      .getAllByRole("columnheader")
      .map((cell) => cell.textContent),
  ).toEqual(["主机", "协议", "状态", "操作"]);
  expect(table.textContent).not.toContain("第一行说明");
  await user.hover(trigger);
  expect(await screen.findByRole("tooltip")).toHaveTextContent("第一行说明");
  await user.click(trigger);
  const dialog = await screen.findByRole("dialog", {
    name: "测试主机 · 主机说明",
  });
  expect(within(dialog).getByLabelText("说明全文").textContent).toBe(
    hosts[0]!.description,
  );
  expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  expect(
    within(dialog).getByRole("button", { name: "复制主机说明" }),
  ).toBeVisible();
  await user.keyboard("{Escape}");
  await waitFor(() => expect(trigger).toHaveFocus());
  await user.keyboard("{Enter}");
  expect(
    await screen.findByRole("dialog", { name: "测试主机 · 主机说明" }),
  ).toBeVisible();
});

it("edits multiline host descriptions and keeps the code readonly and out of the update payload", async () => {
  const { user } = setup("/admin/remote-hosts/h1");
  await user.click(await screen.findByRole("button", { name: "编辑配置" }));
  expect(screen.getByLabelText("主机编码")).toHaveAttribute("readonly");
  const description = screen.getByLabelText("说明");
  expect(description.tagName).toBe("TEXTAREA");
  await user.clear(description);
  await user.type(description, "第一行{Enter}第二行");
  await user.click(screen.getByRole("button", { name: "保存配置" }));
  await screen.findByRole("button", { name: "编辑配置" });
  const update = mockedRequest.mock.calls.find(
    ([, options]) => options?.method === "PATCH",
  )?.[1]?.body;
  expect(update).toMatchObject({ description: "第一行\n第二行" });
  expect(update).not.toHaveProperty("code");
});

it("keeps console project host details scoped to project credentials", async () => {
  setup("/admin/projects/7/remote-hosts/h1?tab=config");
  expect(await screen.findByRole("tab", { name: "访问凭证" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  expect(
    screen.queryByRole("button", { name: "主机的操作" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("tab", { name: "主机配置" }),
  ).not.toBeInTheDocument();
  await waitFor(() =>
    expect(
      mockedRequest.mock.calls.some(
        ([path]) => path === "/projects/7/remote-hosts/h1/credentials",
      ),
    ).toBe(true),
  );
  expect(
    mockedRequest.mock.calls.some(([path]) => path.startsWith("/admin/")),
  ).toBe(false);
});

it("uses nested console project host links without offering host creation", async () => {
  setup("/admin/projects/7/remote-hosts");
  expect(
    await screen.findByRole("heading", { name: "项目 SSH 凭证" }),
  ).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "添加主机" }),
  ).not.toBeInTheDocument();
  const link = await screen.findByRole("link", { name: "测试主机" });
  expect(link.getAttribute("href")).toContain(
    "/admin/projects/7/remote-hosts/h1",
  );
});
