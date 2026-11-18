import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryRouter, RouterProvider } from "react-router";
import { expect, it, vi } from "vitest";
import { WorkspaceProjectDetail } from "@/areas/workspace/pages/workspace-project-detail";
import { Shell } from "@/areas/workspace/shell/shell";
import { WorkspaceTeamDetail } from "@/areas/workspace/pages/workspace-team-detail";
import type { Resource, Shortcuts } from "@/types/collaboration";

vi.mock("@/app/theme", async (original) => ({
  ...(await original<typeof import("@/app/theme")>()),
  useTheme: () => ({
    resolved: "light",
    appearance: "light",
    setAppearance: vi.fn(),
  }),
}));
vi.mock("@/app/auth", () => ({
  useSession: () => ({
    user: {
      id: "1",
      username: "founder",
      display_name: "创始人",
      role: "admin",
    },
  }),
  useAuth: () => ({ settings: { timezone: "Asia/Shanghai" } }),
}));
vi.mock("@/areas/workspace/pages/project-overview", () => ({
  ProjectOverview: () => <section>项目总览内容</section>,
}));
vi.mock("@/features/repositories/repositories", () => ({
  ProjectRepositories: () => <section>仓库列表内容</section>,
}));
vi.mock("@/areas/workspace/pages/project-description", () => ({
  ProjectDescription: () => <section>项目介绍内容</section>,
}));
vi.mock("@/features/collaboration/members", () => ({
  MembersPanel: ({ kind }: { kind: string }) => (
    <section>{kind === "teams" ? "团队成员内容" : "成员管理内容"}</section>
  ),
  ProjectTeams: () => <section>团队授权内容</section>,
}));
vi.mock("@/areas/workspace/pages/workspace-resource-actions", () => ({
  WorkspaceResourceActions: () => <div>对象操作</div>,
}));
vi.mock("@/components/markdown", () => ({
  MarkdownView: ({ source }: { source: string }) => <article>{source}</article>,
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
  description: "团队协作约定",
  etag: '"team-11-v1"',
};
const deliveryTeam: Resource = {
  ...team,
  id: "12",
  code: "delivery-team",
  name: "交付团队",
  description: "团队交付流程",
  etag: '"team-12-v1"',
};
const shortcuts: Shortcuts = {
  projects: { items: [], version: "1", etag: '"projects-v1"' },
  teams: { items: [], version: "1", etag: '"teams-v1"' },
};

vi.mock("@/hooks/use-api", () => ({
  useApiQuery: (_key: unknown, path: string) => {
    if (path.startsWith("/projects?"))
      return {
        data: { data: { items: [project], total: 1 } },
        isPending: false,
      };
    if (path.startsWith("/teams?")) {
      const params = new URLSearchParams(path.slice("/teams?".length));
      const items =
        params.get("scope") === "mine"
          ? [team, deliveryTeam].filter((item) =>
              item.name.includes(params.get("q") ?? ""),
            )
          : [];
      return {
        data: { data: { items, total: items.length } },
        isPending: false,
      };
    }
    const responses: Record<string, Resource | Resource[] | Shortcuts> = {
      "/projects/7": project,
      "/teams/11": team,
      "/teams/12": deliveryTeam,
      "/teams/11/projects": [project],
      "/me/sidebar-shortcuts": shortcuts,
    };
    const data = responses[path] ?? [];
    return {
      data: { data },
      isPending: false,
      isFetching: false,
      refetch: vi.fn(async () => ({ data: { data } })),
    };
  },
}));

function mount(
  routes: { path: string; element: React.ReactNode }[],
  entry: string,
) {
  const router = createMemoryRouter(
    [{ element: <Shell />, children: routes }],
    { initialEntries: [entry] },
  );
  render(
    <QueryClientProvider client={new QueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { router, user: userEvent.setup() };
}

function mountProject(entry: string) {
  return mount(
    [
      { path: "/projects/:projectId", element: <WorkspaceProjectDetail /> },
      {
        path: "/projects/:projectId/integrations",
        element: <section>连接目录</section>,
      },
      {
        path: "/projects/:projectId/remote-hosts",
        element: <section>主机目录</section>,
      },
      {
        path: "/projects/:projectId/variants",
        element: <section>产品分支页面</section>,
      },
    ],
    entry,
  );
}

it.each([
  ["", "项目总览内容"],
  ["?tab=unknown", "项目总览内容"],
  ["?tab=releases", "项目总览内容"],
  ["?tab=repositories", "仓库列表内容"],
  ["?tab=description", "项目介绍内容"],
  ["?tab=members", "成员管理内容"],
  ["?tab=teams", "团队授权内容"],
  ["?tab=branch-model", "项目总览内容"],
  ["?tab=settings&section=unknown", "项目资料"],
])("renders workspace project content for %s", (search, content) => {
  mountProject(`/projects/7${search}`);
  expect(screen.getByText(content)).toBeVisible();
});

it("redirects removed delivery tabs to the project overview", async () => {
  const { router } = mountProject(
    "/projects/7?tab=variants&return_to=%2Fprojects",
  );
  expect(await screen.findByText("项目总览内容")).toBeVisible();
  expect(router.state.location.pathname).toBe("/projects/7");
  expect(router.state.location.search).toBe("");
});

it("opens existing project content routes from the secondary navigation", async () => {
  const { router, user } = mountProject("/projects/7");
  await user.click(screen.getByRole("link", { name: "项目介绍" }));
  expect(router.state.location.search).toBe("?tab=description");
  expect(await screen.findByText("项目介绍内容")).toBeVisible();

  await user.click(screen.getByRole("link", { name: "Git 仓库" }));
  expect(await screen.findByText("仓库列表内容")).toBeVisible();
  expect(router.state.location.search).toBe("?tab=repositories");
  expect(
    screen.queryByRole("link", { name: "产品分支" }),
  ).not.toBeInTheDocument();
});

it("keeps project credential links in the workspace", async () => {
  const { user } = mountProject(
    "/projects/7?tab=settings&section=integrations",
  );
  expect(await screen.findByText("连接目录")).toBeVisible();
  const rail = within(screen.getByRole("complementary", { name: "项目导航" }));
  expect(rail.getByRole("link", { name: "服务连接" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await user.click(rail.getByRole("link", { name: "SSH 凭证" }));
  expect(await screen.findByText("主机目录")).toBeVisible();
  expect(rail.getByRole("link", { name: "SSH 凭证" })).toHaveAttribute(
    "aria-current",
    "page",
  );
});

it("shows team information on the introduction and opens the participating projects list", async () => {
  const { user } = mount(
    [{ path: "/teams/:teamId", element: <WorkspaceTeamDetail /> }],
    "/teams/11?tab=unknown",
  );
  const main = within(screen.getByRole("main"));
  expect(main.getByRole("heading", { name: /平台团队/ })).toBeVisible();
  expect(main.getByText("对象操作")).toBeVisible();
  expect(screen.getByText("团队协作约定")).toBeVisible();
  const rail = within(screen.getByRole("complementary", { name: "团队导航" }));
  expect(rail.getByRole("link", { name: "团队介绍" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  expect(rail.getByRole("link", { name: "团队成员" })).toBeInTheDocument();

  await user.click(rail.getByRole("link", { name: /团队成员/ }));
  expect(screen.getByText("团队成员内容")).toBeVisible();
  expect(
    main.queryByRole("heading", { name: /平台团队/ }),
  ).not.toBeInTheDocument();
  expect(main.queryByText("对象操作")).not.toBeInTheDocument();
  await user.click(rail.getByRole("link", { name: "参与项目" }));
  expect(
    main.queryByRole("heading", { name: /平台团队/ }),
  ).not.toBeInTheDocument();
  expect(
    within(screen.getByRole("navigation", { name: "当前位置" })).getByText(
      "参与项目",
    ),
  ).toHaveAttribute("aria-current", "page");
  const table = within(main.getByRole("table", { name: "参与项目" }));
  expect(table.getByRole("link", { name: /交付平台/ })).toHaveAttribute(
    "href",
    "/projects/7",
  );

  await user.type(
    main.getByRole("textbox", { name: "搜索参与项目" }),
    "不存在{Enter}",
  );
  expect(main.getByText("没有匹配的项目")).toBeVisible();
  await user.click(main.getByRole("button", { name: "重置筛选" }));
  expect(main.getByRole("table", { name: "参与项目" })).toBeVisible();
});

it("searches the user's teams and switches to the selected team introduction", async () => {
  const { router, user } = mount(
    [{ path: "/teams/:teamId", element: <WorkspaceTeamDetail /> }],
    "/teams/11?tab=members",
  );
  await user.click(
    screen.getByRole("button", { name: "切换团队，当前 平台团队" }),
  );
  const menu = within(await screen.findByRole("menu"));
  expect(menu.getByRole("menuitem", { name: /平台团队/ })).toHaveAttribute(
    "aria-current",
    "true",
  );

  await user.type(
    menu.getByRole("textbox", { name: "搜索我的团队" }),
    "交付{Enter}",
  );
  expect(
    menu.queryByRole("menuitem", { name: /平台团队/ }),
  ).not.toBeInTheDocument();
  await user.click(menu.getByRole("menuitem", { name: /交付团队/ }));
  expect(router.state.location.pathname).toBe("/teams/12");
  expect(router.state.location.search).toBe("");
  expect(screen.getByText("团队交付流程")).toBeVisible();
  expect(
    screen.getByRole("button", { name: "切换团队，当前 交付团队" }),
  ).toBeVisible();
});
