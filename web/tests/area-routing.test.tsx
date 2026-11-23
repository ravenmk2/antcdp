import { appRoutes } from "@/app/router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  role: "user",
  consoleLoaded: vi.fn(),
  paths: [] as string[],
}));
vi.mock("@/areas/console/root", () => {
  state.consoleLoaded();
  return { default: () => <p>控制台模块已加载</p> };
});
vi.mock("@/app/theme", async (original) => ({
  ...(await original<typeof import("@/app/theme")>()),
  useTheme: () => ({
    appearance: "light",
    resolved: "light",
    cycle: vi.fn(),
    setAppearance: vi.fn(),
  }),
}));
vi.mock("@/hooks/use-api", () => ({
  useApiQuery: (
    _key: unknown,
    path: string,
    options?: { enabled?: boolean },
  ) => {
    if (options?.enabled !== false) state.paths.push(path);
    const data =
      path === "/setup/status"
        ? { state: "ready" }
        : path === "/public/settings"
          ? { site_name: "AntCDP", timezone: "Asia/Shanghai" }
          : path === "/auth/session"
            ? {
                user: {
                  id: "1",
                  username: "reviewer",
                  display_name: "测试用户",
                  role: state.role,
                  avatar: null,
                  version: "1",
                },
                require_password_change: false,
              }
            : { items: [] };
    return {
      data: { data },
      isPending: false,
      isFetching: false,
      isError: false,
      refetch: vi.fn(),
    };
  },
}));

beforeAll(async () => {
  await Promise.all([
    import("@/areas/workspace/root"),
    import("@/areas/workspace/pages/account-page"),
    import("@/areas/workspace/pages/integrations"),
    import("@/areas/workspace/pages/remote-hosts"),
  ]);
});

beforeEach(() => {
  state.role = "user";
  state.paths = [];
  localStorage.clear();
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
});
afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
});

function mount(path: string) {
  const router = createMemoryRouter(appRoutes, { initialEntries: [path] });
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

it("rejects ordinary users before loading the console, including unknown admin URLs", async () => {
  const router = mount("/admin/unknown-page");
  expect(await screen.findByText("控制台仅对系统管理员开放。")).toBeVisible();
  expect(state.consoleLoaded).not.toHaveBeenCalled();
  await act(() => router.navigate("/admin/users"));
  expect(screen.getByText("控制台仅对系统管理员开放。")).toBeVisible();
  expect(state.consoleLoaded).not.toHaveBeenCalled();
  expect(state.paths.filter((path) => path.startsWith("/admin/"))).toEqual([]);
});

it("keeps workspace and personal settings navigation through credential routes and legacy query links", async () => {
  const router = mount("/account?section=integrations");
  const nav = await screen.findByRole("navigation", { name: "个人设置导航" });
  expect(
    within(nav)
      .getAllByRole("link")
      .map((link) => link.textContent),
  ).toEqual(["个人资料", "账号安全", "凭据管理", "服务连接", "远程主机"]);
  expect(within(nav).getByRole("link", { name: "服务连接" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  expect(
    within(nav)
      .getAllByRole("link")
      .filter((link) => link.getAttribute("aria-current") === "page"),
  ).toHaveLength(1);
  expect(
    await screen.findByRole("link", { name: "设置首选凭据" }),
  ).toHaveAttribute("href", "/account/integrations");
  await userEvent.click(within(nav).getByRole("link", { name: "服务连接" }));
  expect(
    await screen.findByRole("heading", { name: "个人服务连接" }),
  ).toBeVisible();
  expect(screen.getByRole("navigation", { name: "主导航" })).toBeVisible();
  await act(() => router.navigate("/account/remote-hosts/999"));
  expect(await screen.findByText("主机不存在或当前账号不可见。")).toBeVisible();
  expect(
    within(screen.getByRole("navigation", { name: "个人设置导航" })).getByRole(
      "link",
      { name: "远程主机" },
    ),
  ).toHaveAttribute("aria-current", "page");
  expect(screen.getByRole("link", { name: "返回工作区" })).toHaveAttribute(
    "href",
    "/home",
  );
  expect(state.paths.filter((path) => path.startsWith("/admin/"))).toEqual([]);
  expect(state.consoleLoaded).not.toHaveBeenCalled();
});

it("returns to the full workspace location after visiting multiple settings pages", async () => {
  const router = mount("/projects?view=recent#activity");
  const user = userEvent.setup();
  await user.click(
    await screen.findByRole("button", { name: "用户菜单，测试用户" }),
  );
  await user.click(await screen.findByRole("menuitem", { name: "个人设置" }));
  expect(
    await screen.findByRole("heading", { name: "个人资料" }),
  ).toBeVisible();
  const nav = screen.getByRole("navigation", { name: "个人设置导航" });
  await user.click(within(nav).getByRole("link", { name: "账号安全" }));
  expect(
    await screen.findByRole("heading", { name: "账号安全" }),
  ).toBeVisible();
  await user.click(within(nav).getByRole("link", { name: "服务连接" }));
  const back = await screen.findByRole("link", { name: "返回原页面" });
  expect(back).toHaveAttribute("href", "/projects?view=recent#activity");
  await user.click(back);
  expect(router.state.location).toMatchObject({
    pathname: "/projects",
    search: "?view=recent",
    hash: "#activity",
  });
  expect(screen.queryByRole("navigation", { name: "个人设置导航" })).toBeNull();
});

it("protects personal settings edits and renders the confirmation in the workspace theme", async () => {
  const router = mount("/account");
  const user = userEvent.setup();
  const name = await screen.findByRole("textbox", { name: "显示名称" });
  await user.clear(name);
  await user.type(name, "未保存资料");
  await act(() => router.navigate("/projects"));
  const dialog = await screen.findByRole("dialog", { name: "离开当前页面？" });
  expect(dialog.closest("[data-portal-host]")).toHaveAttribute(
    "data-area",
    "workspace",
  );
  await user.click(within(dialog).getByRole("button", { name: "取消" }));
  expect(router.state.location.pathname).toBe("/account");
  expect(name).toHaveValue("未保存资料");
  await act(() => router.navigate("/projects"));
  await user.click(
    await screen.findByRole("button", { name: "放弃修改并离开" }),
  );
  await waitFor(() => expect(router.state.location.pathname).toBe("/projects"));
  await screen.findByRole("navigation", { name: "主导航" });
  expect(screen.queryByRole("navigation", { name: "个人设置导航" })).toBeNull();
});
