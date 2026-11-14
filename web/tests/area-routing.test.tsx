import { appRoutes } from "@/app/router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  role: "user",
  consoleLoaded: vi.fn(),
  paths: [] as string[],
}));
vi.mock("@/areas/console/root", () => {
  state.consoleLoaded();
  return { default: () => <p>控制台模块已加载</p> };
});
vi.mock("@/app/theme", () => ({
  appearanceLabels: { light: "浅色", dark: "深色", system: "跟随系统" },
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

beforeEach(() => {
  state.role = "user";
  state.paths = [];
  localStorage.clear();
});
afterEach(() => localStorage.clear());

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

it("keeps account navigation through credential routes and legacy query links without console requests", async () => {
  const router = mount("/account?section=integrations");
  const nav = await screen.findByRole("navigation", { name: "个人中心导航" });
  expect(within(nav).getByRole("link", { name: "服务凭证" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  expect(
    within(nav)
      .getAllByRole("link")
      .filter((link) => link.getAttribute("aria-current") === "page"),
  ).toHaveLength(1);
  expect(
    await screen.findByRole("link", { name: "进入凭证管理" }),
  ).toHaveAttribute("href", "/account/integrations");
  await userEvent.click(within(nav).getByRole("link", { name: "服务凭证" }));
  expect(
    await screen.findByRole("heading", { name: "个人服务凭证" }),
  ).toBeVisible();
  expect(
    screen.queryByRole("navigation", { name: "主导航" }),
  ).not.toBeInTheDocument();
  await act(async () => {
    await router.navigate("/account/remote-hosts/999");
    await import("@/areas/account/pages/remote-hosts");
  });
  expect(await screen.findByText("主机不存在或当前账号不可见。")).toBeVisible();
  expect(
    within(screen.getByRole("navigation", { name: "个人中心导航" })).getByRole(
      "link",
      { name: "SSH 凭证" },
    ),
  ).toHaveAttribute("aria-current", "page");
  expect(state.paths.filter((path) => path.startsWith("/admin/"))).toEqual([]);
  expect(state.consoleLoaded).not.toHaveBeenCalled();
});

it("protects account edits across area changes and renders the confirmation in the source theme", async () => {
  const router = mount("/account");
  const user = userEvent.setup();
  const name = await screen.findByRole("textbox", { name: "显示名称" });
  await user.clear(name);
  await user.type(name, "未保存资料");
  await act(() => router.navigate("/projects"));
  const dialog = await screen.findByRole("dialog", { name: "离开当前页面？" });
  expect(dialog.closest("[data-portal-host]")).toHaveAttribute(
    "data-area",
    "account",
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
  expect(
    document.querySelector('[data-portal-host][data-area="account"]'),
  ).toBeNull();
});
