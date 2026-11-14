import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryRouter, RouterProvider } from "react-router";
import { expect, it, vi } from "vitest";
import { WorkspaceProjectDetail } from "@/areas/workspace/pages/workspace-project-detail";
import { WorkspaceTeamDetail } from "@/areas/workspace/pages/workspace-team-detail";
import type { Resource, Shortcuts } from "@/types/collaboration";

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
const shortcuts: Shortcuts = {
  projects: { items: [], version: "1", etag: '"projects-v1"' },
  teams: { items: [], version: "1", etag: '"teams-v1"' },
};

vi.mock("@/hooks/use-api", () => ({
  useApiQuery: (_key: unknown, path: string) => {
    const data =
      path === "/projects/7"
        ? project
        : path === "/teams/11"
          ? team
          : path === "/teams/11/projects"
            ? [project]
            : path === "/me/sidebar-shortcuts"
              ? shortcuts
              : [];
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
  const router = createMemoryRouter(routes, { initialEntries: [entry] });
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

it("uses shared project tabs with the existing content routes", async () => {
  const { router, user } = mountProject("/projects/7");
  await user.click(screen.getByRole("tab", { name: "项目介绍" }));
  expect(router.state.location.search).toBe("?tab=description");
  expect(await screen.findByText("项目介绍内容")).toBeVisible();

  await user.click(screen.getByRole("tab", { name: "Git 仓库" }));
  expect(await screen.findByText("仓库列表内容")).toBeVisible();
  expect(router.state.location.search).toBe("?tab=repositories");
  expect(
    screen.queryByRole("tab", { name: "产品分支" }),
  ).not.toBeInTheDocument();
});

it("keeps project credential links in the workspace", async () => {
  const { user } = mountProject(
    "/projects/7?tab=settings&section=integrations",
  );
  expect(screen.getByRole("link", { name: "管理服务凭证" })).toHaveAttribute(
    "href",
    "/projects/7/integrations",
  );
  await user.click(screen.getByRole("button", { name: "SSH 凭证" }));
  expect(screen.getByRole("link", { name: "管理 SSH 凭证" })).toHaveAttribute(
    "href",
    "/projects/7/remote-hosts",
  );
});

it("renders team information and preserves member and project navigation", async () => {
  const { user } = mount(
    [{ path: "/teams/:teamId", element: <WorkspaceTeamDetail /> }],
    "/teams/11?tab=unknown",
  );
  expect(screen.getByRole("heading", { name: /平台团队/ })).toBeVisible();
  expect(screen.getByText("团队协作约定")).toBeVisible();
  expect(screen.getByRole("tab", { name: "团队介绍" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  expect(screen.getByRole("tab", { name: "成员管理" })).toBeInTheDocument();

  await user.click(screen.getByRole("tab", { name: /成员管理/ }));
  expect(screen.getByText("团队成员内容")).toBeVisible();
  await user.click(screen.getByRole("tab", { name: "关联项目" }));
  expect(screen.getByRole("link", { name: /交付平台/ })).toHaveAttribute(
    "href",
    "/projects/7",
  );
});
