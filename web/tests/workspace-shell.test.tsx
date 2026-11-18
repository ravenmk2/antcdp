import type { Resource, Shortcuts } from "@/types/collaboration";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, expect, it, vi } from "vitest";
import { AppShell } from "./fixtures/area-shell";

vi.mock("@/api/client", async (original) => ({
  ...(await original<typeof import("@/api/client")>()),
  request: vi.fn(async () => ({ data: [], status: 200, etag: "" })),
}));
const identity = vi.hoisted(() => ({ role: "admin" }));
beforeEach(() => {
  identity.role = "admin";
  localStorage.clear();
});
vi.mock("@/app/auth", () => ({
  useSession: () => ({
    user: {
      id: "1",
      username: "founder",
      display_name: "创始人",
      role: identity.role,
      is_founder: true,
    },
  }),
  useAuth: () => ({ settings: { site_name: "AntCDP" } }),
}));
vi.mock("@/app/theme", async (original) => ({
  ...(await original<typeof import("@/app/theme")>()),
  useTheme: () => ({
    appearance: "light",
    resolved: "light",
    setAppearance: vi.fn(),
    cycle: vi.fn(),
  }),
}));

const project: Resource = {
  id: "7",
  code: "delivery",
  name: "交付平台",
  summary: "项目交付协作",
  description: "## 项目目标",
  icon_key: null,
  icon_file_id: null,
  created_by_user_id: "1",
  version: "1",
  membership_version: "1",
  ended_at: null,
  created_at: "2026-11-01T00:00:00Z",
  updated_at: "2026-11-02T00:00:00Z",
  direct_role: "admin",
  is_member: true,
  member_count: 12,
  status: "active",
  etag: '"project-7-v1"',
  membership_etag: '"project-members-7-v1"',
  can_manage: true,
};
const team: Resource = {
  ...project,
  id: "11",
  code: "platform",
  name: "平台团队",
  etag: '"team-11-v1"',
};
const shortcuts: Shortcuts = {
  projects: {
    items: [
      {
        id: "7",
        code: "delivery",
        name: "交付平台",
        icon_key: null,
        icon_file_id: null,
        status: "active",
        sort_order: 1,
      },
    ],
    version: "1",
    etag: '"sidebar-projects-1-v1"',
  },
  teams: { items: [], version: "1", etag: '"sidebar-teams-1-v1"' },
};

vi.mock("@/hooks/use-api", () => ({
  useApiQuery: (_key: unknown, path: string) => {
    if (path === "/agents/sessions/31")
      return {
        data: {
          data: {
            configuration: { id: "31", agent_id: "9", title: "发布方案核对" },
          },
        },
      };
    if (path === "/agents/9/summary")
      return {
        data: { data: { id: "9", name: "交付助手", favorited: false } },
      };
    if (path === "/projects/7")
      return {
        data: { data: { ...project, can_manage: identity.role === "admin" } },
      };
    if (path === "/teams/11") return { data: { data: team } };
    if (path === "/me/sidebar-shortcuts")
      return { data: { data: shortcuts }, refetch: vi.fn() };
    if (path.startsWith("/agents/sessions?"))
      return {
        data: {
          data: [
            {
              id: "31",
              title: "版本问题排查",
              pinned: false,
              active_run_status: "running",
            },
          ],
          pagination: { total: 1 },
        },
      };
    return {};
  },
}));

function mount(route: string) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={[route]}>
        <AppShell />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function mainLink(_role: "link", options: { name: string }) {
  return within(screen.getAllByRole("complementary")[0]!).getByRole(
    "link",
    options,
  );
}

it("shows project navigation in a collapsible secondary rail and highlights its primary menu", async () => {
  const user = userEvent.setup();
  const { container } = mount("/projects/7?tab=description");
  const sidebar = screen.getByRole("complementary", { name: "项目导航" });
  expect(
    within(sidebar).getByRole("button", { name: /切换项目/ }),
  ).toBeVisible();
  expect(
    within(sidebar).getByRole("link", { name: "项目介绍" }),
  ).toHaveAttribute("aria-current", "page");
  expect(mainLink("link", { name: "项目" })).toHaveAttribute(
    "aria-current",
    "page",
  );

  expect(screen.queryByText("关注项目")).not.toBeInTheDocument();
  expect(
    container.querySelectorAll('.sidebar [aria-current="page"]'),
  ).toHaveLength(1);
  await user.click(screen.getByRole("button", { name: "收起项目侧栏" }));
  expect(screen.queryByRole("complementary", { name: "项目导航" })).toBeNull();
});

it("keeps a fixed icon rail with six menus and no conversation sidebar on the workbench", () => {
  const { container } = mount("/home");
  expect(container.querySelector(".sidebar-navigation")).toHaveAttribute(
    "data-compact",
    "true",
  );
  for (const name of ["工作台", "对话", "智能体", "项目", "团队", "云电脑"])
    expect(mainLink("link", { name })).toBeVisible();
  expect(
    screen.queryByRole("button", { name: /展开侧栏|收起侧栏/ }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("complementary", { name: "对话导航" }),
  ).not.toBeInTheDocument();
  expect(container.querySelector(".workspace-brand img")).toHaveClass("size-7");
});

it("does not restore project task links on product branch routes", () => {
  mount("/projects/7/variants/41?tab=releases");
  const sidebar = screen.getByRole("complementary");
  expect(
    screen.queryByRole("button", { name: /切换项目/ }),
  ).not.toBeInTheDocument();
  expect(within(sidebar).queryByRole("link", { name: "产品分支" })).toBeNull();
  expect(within(sidebar).queryByRole("link", { name: "发布管理" })).toBeNull();
});

it("keeps credential details highlighted in the project rail and breadcrumbs", () => {
  mount("/projects/7/integrations/9");
  const sidebar = screen.getByRole("complementary", { name: "项目导航" });
  expect(
    within(sidebar).getByRole("link", { name: "服务连接" }),
  ).toHaveAttribute("aria-current", "page");
  const navigation = screen.getByRole("navigation", { name: "当前位置" });
  expect(
    within(navigation).getByRole("link", { name: "项目服务连接" }),
  ).toHaveAttribute("href", "/projects/7/integrations");
  expect(within(navigation).getByText("连接详情")).toHaveAttribute(
    "aria-current",
    "page",
  );
});

it("shows the real workspace team name and current team task", () => {
  document.title = "ANTCDP";
  mount("/teams/11?tab=members");
  const navigation = screen.getByRole("navigation", { name: "当前位置" });
  expect(
    within(navigation).getByRole("link", { name: "平台团队" }),
  ).toHaveAttribute("href", "/teams/11");
  expect(within(navigation).getByText("团队成员")).toHaveAttribute(
    "aria-current",
    "page",
  );
  expect(mainLink("link", { name: "团队" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  expect(document.title).toBe("ANTCDP");
});

it.each([
  ["/admin/projects/7", "项目管理"],
  ["/admin/teams/11", "团队管理"],
])("preserves console navigation at %s", (route, label) => {
  mount(route);
  const link = mainLink("link", { name: label });
  expect(link).toHaveAttribute("aria-current", "page");
  expect(link).not.toHaveAttribute("data-section-active");
  expect(
    screen.queryByRole("button", { name: /切换项目/ }),
  ).not.toBeInTheDocument();
});

it.each(["/home", "/projects/7"])(
  "keeps theme switching without a creation menu at %s",
  (route) => {
    mount(route);
    expect(
      screen.queryByRole("button", { name: /消息/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "快速创建" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /切换为(浅色|深色)主题/ }),
    ).toBeVisible();
  },
);

it("omits an empty creation menu for a member outside a project", () => {
  identity.role = "user";
  mount("/home");
  expect(
    screen.queryByRole("button", { name: "快速创建" }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: "对话" })).toBeVisible();
});

it("uses the independent agent summary and session title in conversation breadcrumbs", async () => {
  const user = userEvent.setup();
  const { container } = mount("/chats/31");
  const crumbs = screen.getByRole("navigation", { name: "当前位置" });
  expect(
    within(crumbs).getByRole("link", { name: "交付助手" }),
  ).toHaveAttribute("href", "/chats?agent=9");
  expect(within(crumbs).getByText("发布方案核对")).toHaveAttribute(
    "aria-current",
    "page",
  );
  expect(
    screen.getByRole("complementary", { name: "对话导航" }),
  ).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "收起对话侧栏" }));
  expect(
    screen.queryByRole("complementary", { name: "对话导航" }),
  ).not.toBeInTheDocument();
  expect(container.querySelector(".sidebar-navigation")).toHaveAttribute(
    "data-compact",
    "true",
  );
  await user.click(screen.getByRole("button", { name: "展开对话侧栏" }));
  expect(
    screen.getByRole("complementary", { name: "对话导航" }),
  ).toBeInTheDocument();
});

it("keeps the agent catalog independent from the conversation sidebar", () => {
  mount("/agents/catalog");
  expect(mainLink("link", { name: "智能体" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  expect(mainLink("link", { name: "对话" })).not.toHaveAttribute(
    "aria-current",
  );
  expect(
    screen.queryByRole("complementary", { name: "对话导航" }),
  ).not.toBeInTheDocument();
});

it("shows collaboration to members and reserves robot management for project managers", () => {
  identity.role = "user";
  mount("/projects/7?tab=members");
  const rail = within(screen.getByRole("complementary", { name: "项目导航" }));
  expect(rail.getByRole("link", { name: "项目成员" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  expect(rail.queryByRole("link", { name: "钉钉机器人" })).toBeNull();
});
