import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { Shell } from "@/app/Shell";
import type { Identity } from "@/app/identity";
import type { Resource } from "@/shared/collaboration";
import {
  projectRouteContext,
  projectSection,
} from "@/features/collaboration/ProjectNavigation";
import { useQuery } from "@/lib/use-query";
import { request } from "@/lib/api";
import {
  PinButton,
  ShortcutsProvider,
} from "@/features/collaboration/Shortcuts";

vi.mock("@/app/appearance", () => ({
  useAppearance: () => ({ appearance: "light", setAppearance: vi.fn() }),
}));
vi.mock("@/lib/use-query", () => ({ useQuery: vi.fn() }));
vi.mock("@/lib/api", async (original) => ({
  ...(await original<object>()),
  request: vi.fn(),
}));
const project = {
  id: "7",
  name: "跨团队交付项目",
  code: "delivery",
  is_member: true,
  can_manage: true,
  status: "active",
  direct_role: "admin",
  etag: "p1",
} as Resource;
const other = { ...project, id: "8", name: "客户平台", code: "customer" };
const identity = {
  session: {
    user: { id: "1", username: "raven", display_name: "Raven", role: "admin" },
  },
  settings: { site_name: "AntCDP", timezone: "Asia/Shanghai" },
} as Identity;
let followed: Resource[];
function result(data: unknown) {
  return {
    data,
    response: undefined,
    loading: false,
    error: "",
    refresh: vi.fn(),
  };
}
beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  followed = [project];
  vi.mocked(useQuery).mockImplementation((path) =>
    result(
      path === "/me/sidebar-shortcuts"
        ? {
            projects: { items: followed, etag: "s1" },
            teams: { items: [], etag: "t1" },
          }
        : { items: [project, other], total: 2, page: 1, page_size: 20 },
    ),
  );
  vi.mocked(request).mockImplementation(async (path, options) => {
    if (options?.method === "PUT") {
      followed = [];
      return { data: {}, etag: "s2" } as Awaited<ReturnType<typeof request>>;
    }
    return {
      data: {
        projects: { items: followed, etag: "s1" },
        teams: { items: [], etag: "t1" },
      },
      etag: "",
    } as Awaited<ReturnType<typeof request>>;
  });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function show(path: string, member = true) {
  const selected = {
    ...project,
    is_member: member,
    direct_role: member ? project.direct_role : null,
  };
  const data = /\/projects\/7$/.test(path.split("?")[0]!)
    ? { resource: selected }
    : {
        project: selected,
        selected: { name: "GitLab" },
        host: { name: "构建机" },
        variant: { name: "标准版" },
      };
  const router = createMemoryRouter(
    [
      {
        path: "/",
        loader: () => identity,
        Component: Shell,
        children: [
          { path: "*", loader: () => data, element: <h1>工作内容</h1> },
        ],
      },
    ],
    { initialEntries: [path] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

it.each([
  ["/projects/7", "概览"],
  ["/admin/projects/7?tab=members", "设置"],
  ["/projects/7/variants?variant=2&vview=releases&release=4", "发布"],
  ["/projects/7/integrations/3", "设置"],
  ["/projects/7/remote-hosts/3", "设置"],
])("uses one project header across %s", async (path, active) => {
  show(path!);
  const navigation = await screen.findByRole("navigation", {
    name: "项目导航",
  });
  expect(screen.getAllByRole("navigation", { name: "项目导航" })).toHaveLength(
    1,
  );
  expect(
    within(navigation)
      .getAllByRole("link")
      .map((link) => link.textContent),
  ).toEqual(["概览", "发布", "变体", "仓库", "介绍", "设置"]);
  expect(
    within(navigation)
      .getByRole("link", { name: active })
      .getAttribute("aria-current"),
  ).toBe("page");
  const sidebar = document.getElementById("desktop-sidebar")!;
  const toggle = screen.getByRole("button", { name: "收起侧栏" });
  expect(sidebar.contains(toggle)).toBe(true);
  await userEvent.setup().click(toggle);
  expect(
    sidebar.contains(screen.getByRole("button", { name: "展开侧栏" })),
  ).toBe(true);
  expect(screen.queryByRole("heading", { name: project.name })).toBeNull();
});

it.each([
  ["/projects/7", true, "mine", "/projects"],
  ["/admin/projects/7", true, "all", "/admin/projects"],
  ["/admin/projects/7", false, "all", "/admin/projects"],
  ["/projects/7/integrations/3", true, "mine", "/projects"],
  ["/projects/7/integrations/3", false, "all", "/admin/projects"],
])(
  "searches only the permitted project scope from %s",
  async (path, member, scope, allProjects) => {
    show(path as string, member as boolean);
    const trigger = await screen.findByRole("button", {
      name: `切换项目，当前 ${project.name}`,
    });
    expect(
      vi
        .mocked(useQuery)
        .mock.calls.some(([url]) => url?.startsWith("/projects?")),
    ).toBe(false);
    const user = userEvent.setup();
    await user.click(trigger);
    const dialog = screen.getByRole("dialog", { name: "切换项目" });
    expect(
      within(dialog)
        .getByRole("link", { name: "所有项目" })
        .getAttribute("href"),
    ).toBe(allProjects);
    expect(useQuery).toHaveBeenLastCalledWith(
      `/projects?scope=${scope}&status=all&page=1&page_size=20&q=`,
    );
    await user.type(
      within(dialog).getByRole("textbox", { name: "搜索项目" }),
      "客户",
    );
    await user.click(within(dialog).getByRole("button", { name: "搜索" }));
    expect(useQuery).toHaveBeenLastCalledWith(
      `/projects?scope=${scope}&status=all&page=1&page_size=20&q=%E5%AE%A2%E6%88%B7`,
    );
    expect(
      within(dialog)
        .getByRole("link", { name: "切换到 客户平台，customer" })
        .getAttribute("href"),
    ).toBe(allProjects + "/8");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(trigger);
  },
);

it("unfollows a project through the existing versioned preference API without losing project access", async () => {
  show("/projects/7");
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "项目更多操作" }));
  await user.click(screen.getByRole("menuitem", { name: "取消关注" }));
  await waitFor(() =>
    expect(request).toHaveBeenCalledWith("/me/sidebar-shortcuts/projects", {
      method: "PUT",
      etag: "s1",
      body: { ids: [] },
    }),
  );
  expect(
    await screen.findByRole("button", { name: "暂无关注项目，选择项目" }),
  ).toBeTruthy();
  expect(screen.getByRole("navigation", { name: "项目导航" })).toBeTruthy();
  expect(screen.getByRole("link", { name: "我的项目" })).toBeTruthy();
});

it("resolves credential console fallback only for system administrators and keeps old tabs", () => {
  const nonmember = { ...project, is_member: false };
  expect(
    projectRouteContext(
      "/projects/7/remote-hosts",
      { project: nonmember },
      true,
    )?.admin,
  ).toBe(true);
  expect(
    projectRouteContext(
      "/projects/7/remote-hosts",
      { project: nonmember },
      false,
    )?.admin,
  ).toBe(false);
  expect(
    projectRouteContext("/projects/7", { resource: other }, true),
  ).toBeNull();
  for (const tab of ["members", "teams", "branch-model"])
    expect(projectSection("/projects/7", "?tab=" + tab)).toBe("settings");
});

it("does not offer personal follow or leave actions for administrator-only access", async () => {
  show("/projects/7/remote-hosts/3", false);
  await userEvent
    .setup()
    .click(await screen.findByRole("button", { name: "项目更多操作" }));
  expect(screen.queryByRole("menuitem", { name: /关注/ })).toBeNull();
  expect(screen.queryByRole("menuitem", { name: "退出项目" })).toBeNull();
  expect(screen.getByRole("menuitem", { name: "刷新项目" })).toBeTruthy();
});

it("retains team pin wording and writes the separate team preference group", async () => {
  const team = { ...project, id: "11", name: "交付团队" };
  const router = createMemoryRouter([
    {
      path: "/",
      element: (
        <ShortcutsProvider>
          <PinButton kind="teams" resource={team} />
        </ShortcutsProvider>
      ),
    },
  ]);
  render(<RouterProvider router={router} />);
  expect(screen.queryByRole("button", { name: /关注/ })).toBeNull();
  await userEvent
    .setup()
    .click(screen.getByRole("button", { name: "固定到首页" }));
  await waitFor(() =>
    expect(request).toHaveBeenCalledWith("/me/sidebar-shortcuts/teams", {
      method: "PUT",
      etag: "t1",
      body: { ids: ["11"] },
    }),
  );
  expect(
    vi
      .mocked(request)
      .mock.calls.some(
        ([path, options]) =>
          path === "/me/sidebar-shortcuts/projects" &&
          options?.method === "PUT",
      ),
  ).toBe(false);
});
