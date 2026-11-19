import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryRouter, RouterProvider } from "react-router";
import { expect, it, vi } from "vitest";
import { ProjectEventsPage } from "@/areas/workspace/pages/events";
import { ProjectJobsPage } from "@/areas/workspace/pages/jobs";
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
vi.mock("@/features/repositories/repositories", () => ({
  ProjectRepositories: () => <section>仓库列表内容</section>,
}));
vi.mock("@/features/collaboration/members", async (original) => ({
  ...(await original<typeof import("@/features/collaboration/members")>()),
  MembersPanel: ({ kind }: { kind: string }) => (
    <section>{kind === "teams" ? "团队成员内容" : "成员管理内容"}</section>
  ),
}));
vi.mock("@/features/jobs/page", () => ({
  JobsPage: () => <section>作业列表内容</section>,
}));
vi.mock("@/features/events/page", () => ({
  EventsPage: () => <section>事件列表内容</section>,
}));
vi.mock("@/features/dingtalk/page", () => ({
  DingTalkPage: () => <section>机器人列表内容</section>,
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
  description: "## 项目目标\n\n详细说明项目的目标、实施计划和协作约定。",
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
      "/projects/7/teams": [team, deliveryTeam],
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
      { path: "/projects/:projectId/events", element: <ProjectEventsPage /> },
      {
        path: "/projects/:projectId/jobs/:jobId?",
        element: <ProjectJobsPage />,
      },
      {
        path: "/projects/:projectId/jobs/:jobId/runs/:runId",
        element: <ProjectJobsPage />,
      },
      {
        path: "/projects/:projectId/dingtalk/:robotId?",
        element: <ProjectJobsPage robots />,
      },
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

it("uses workspace breadcrumbs to return from a run to its job and then to the job list", async () => {
  const { router, user } = mountProject("/projects/7/jobs/9/runs/4");
  const crumbs = within(screen.getByRole("navigation", { name: "当前位置" }));
  expect(crumbs.getByText("运行 #4")).toHaveAttribute("aria-current", "page");
  await user.click(crumbs.getByRole("link", { name: "作业详情" }));
  expect(router.state.location.pathname).toBe("/projects/7/jobs/9");
  await user.click(crumbs.getByRole("link", { name: "项目作业" }));
  expect(router.state.location.pathname).toBe("/projects/7/jobs");
});

it.each([
  ["", "项目资源", true],
  ["?tab=unknown", "项目资源", true],
  ["?tab=releases", "项目资源", true],
  ["?tab=repositories", "仓库列表内容", false],
  ["?tab=description", /详细说明项目的目标/, false],
  ["?tab=members", "成员管理内容", false],
  ["?tab=teams", "平台团队", false],
  ["?tab=branch-model", "项目资源", true],
  ["?tab=settings&section=unknown", "项目资料", false],
  ["/jobs", "作业列表内容", false],
  ["/events", "事件列表内容", false],
  ["/dingtalk", "机器人列表内容", false],
] as const)(
  "keeps the project heading on the overview when opening %s",
  (suffix, content, overview) => {
    mountProject(`/projects/7${suffix}`);
    const main = within(screen.getByRole("main"));
    expect(main.getByText(content)).toBeVisible();
    const projectHeading = main.queryByRole("heading", {
      name: project.name,
    });
    if (overview) {
      expect(projectHeading).toBeVisible();
      expect(main.getByText("对象操作")).toBeVisible();
    } else {
      expect(projectHeading).not.toBeInTheDocument();
      expect(main.queryByText("对象操作")).not.toBeInTheDocument();
    }
    expect(
      screen.getByRole("button", { name: `切换项目，当前 ${project.name}` }),
    ).toBeVisible();
  },
);

it("redirects removed delivery tabs to the project overview", async () => {
  const { router } = mountProject(
    "/projects/7?tab=variants&return_to=%2Fprojects",
  );
  expect(
    await screen.findByRole("heading", { name: "项目资源" }),
  ).toBeVisible();
  expect(router.state.location.pathname).toBe("/projects/7");
  expect(router.state.location.search).toBe("");
});

it("opens the full description from the overview and shows the repository heading", async () => {
  const { router, user } = mountProject("/projects/7");
  const main = within(screen.getByRole("main"));
  expect(main.queryByText(/详细说明项目的目标/)).not.toBeInTheDocument();
  await user.click(main.getByRole("link", { name: "查看完整介绍" }));
  expect(router.state.location.search).toBe("?tab=description");
  expect(main.getByRole("heading", { name: "项目介绍" })).toBeVisible();
  expect(main.getByText(/详细说明项目的目标/)).toBeVisible();

  await user.click(screen.getByRole("link", { name: "Git 仓库" }));
  expect(await screen.findByText("仓库列表内容")).toBeVisible();
  expect(main.getByRole("heading", { name: "Git 仓库" })).toBeVisible();
  expect(router.state.location.search).toBe("?tab=repositories");
  expect(
    screen.queryByRole("link", { name: "产品分支" }),
  ).not.toBeInTheDocument();
});

it("names participating teams consistently and keeps the team controls available", async () => {
  const { user } = mountProject("/projects/7");
  const rail = within(screen.getByRole("complementary", { name: "项目导航" }));
  await user.click(rail.getByRole("link", { name: "参与团队" }));
  expect(
    within(screen.getByRole("navigation", { name: "当前位置" })).getByText(
      "参与团队",
    ),
  ).toHaveAttribute("aria-current", "page");
  const main = within(screen.getByRole("main"));
  expect(main.getByRole("heading", { name: "参与团队" })).toBeVisible();
  let table = within(main.getByRole("table", { name: "参与团队" }));
  expect(table.getByText("交付团队")).toBeVisible();
  await user.type(
    main.getByRole("textbox", { name: "搜索参与团队" }),
    "platform{Enter}",
  );
  expect(table.getByText("平台团队")).toBeVisible();
  expect(table.queryByText("交付团队")).not.toBeInTheDocument();
  await user.click(main.getByRole("button", { name: "重置筛选" }));
  table = within(main.getByRole("table", { name: "参与团队" }));
  expect(table.getByText("交付团队")).toBeVisible();
  expect(main.getByRole("button", { name: "授权团队" })).toBeVisible();

  await user.click(table.getByRole("button", { name: "平台团队的操作" }));
  await user.click(await screen.findByRole("menuitem", { name: "撤销授权" }));
  expect(
    await screen.findByRole("dialog", { name: "撤销团队授权" }),
  ).toBeVisible();
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
  expect(main.getByRole("heading", { name: "团队成员" })).toBeVisible();
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
  expect(main.getByRole("heading", { name: "参与项目" })).toBeVisible();
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
