import type { Resource, Shortcuts } from "@/types/collaboration";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, expect, it, vi } from "vitest";
import { AppShell } from "./fixtures/area-shell";

const identity = vi.hoisted(() => ({ role: "admin" }));
beforeEach(() => {
  identity.role = "admin";
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
    if (path === "/projects/7") return { data: { data: project } };
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
  return within(screen.getByRole("complementary")).getByRole("link", options);
}

it("keeps project tasks in page content and only the switcher in the sidebar", () => {
  const { container } = mount("/projects/7?tab=description");
  const sidebar = screen.getByRole("complementary");
  expect(screen.getByRole("button", { name: /切换项目/ })).toBeInTheDocument();
  expect(within(sidebar).queryByRole("link", { name: "项目介绍" })).toBeNull();
  expect(mainLink("link", { name: "我的项目" })).toHaveAttribute(
    "data-section-active",
    "true",
  );
  expect(mainLink("link", { name: "我的项目" })).not.toHaveAttribute(
    "aria-current",
  );
  expect(screen.queryByText("关注项目")).not.toBeInTheDocument();
  expect(
    container.querySelectorAll('.sidebar [aria-current="page"]'),
  ).toHaveLength(0);
});

it("uses conversation history outside project context and keeps project navigation contextual", () => {
  mount("/home");
  expect(screen.getByText("会话历史")).toBeVisible();
  expect(screen.getByRole("link", { name: "版本问题排查" })).toHaveAttribute(
    "href",
    "/agents/sessions/31",
  );
  expect(
    screen.queryByRole("link", { name: "交付平台" }),
  ).not.toBeInTheDocument();
  expect(mainLink("link", { name: "新建对话" })).toBeVisible();
});

it("does not restore project task links on product branch routes", () => {
  mount("/projects/7/variants/41?tab=releases");
  const sidebar = screen.getByRole("complementary");
  expect(screen.getByRole("button", { name: /切换项目/ })).toBeInTheDocument();
  expect(within(sidebar).queryByRole("link", { name: "产品分支" })).toBeNull();
  expect(within(sidebar).queryByRole("link", { name: "发布管理" })).toBeNull();
});

it("keeps credential details inside project settings and breadcrumbs", () => {
  mount("/projects/7/integrations/9");
  const sidebar = screen.getByRole("complementary");
  expect(screen.getByRole("button", { name: /切换项目/ })).toBeInTheDocument();
  expect(within(sidebar).queryByRole("link", { name: "项目设置" })).toBeNull();
  const navigation = screen.getByRole("navigation", { name: "当前位置" });
  expect(
    within(navigation).getByRole("link", { name: "项目服务凭证" }),
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
  expect(within(navigation).getByText("成员管理")).toHaveAttribute(
    "aria-current",
    "page",
  );
  expect(mainLink("link", { name: "我的团队" })).toHaveAttribute(
    "data-section-active",
    "true",
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

it("keeps only implemented topbar actions and real administrator creation links", async () => {
  const user = userEvent.setup();
  mount("/home");
  expect(
    screen.queryByRole("button", { name: /消息/ }),
  ).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "快速创建" }));
  expect(
    await screen.findByRole("menuitem", { name: "创建项目" }),
  ).toHaveAttribute("href", "/admin/projects?create=1");
  expect(
    await screen.findByRole("menuitem", { name: "创建团队" }),
  ).toHaveAttribute("href", "/admin/teams?create=1");
});

it("omits an empty creation menu for a member outside a project", () => {
  identity.role = "user";
  mount("/home");
  expect(
    screen.queryByRole("button", { name: "快速创建" }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: "新建对话" })).toBeVisible();
});
