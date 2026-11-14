import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryRouter, RouterProvider } from "react-router";
import { beforeEach, expect, it, vi } from "vitest";
import { ApiError, request, type RequestOptions } from "@/api/client";
import { AdminProjectDetail } from "@/areas/console/pages/project-detail";
import type { Resource } from "@/types/collaboration";

vi.mock("@/app/auth", () => ({
  useAuth: () => ({ settings: { timezone: "Asia/Shanghai" } }),
}));
vi.mock("@/api/client", async (original) => ({
  ...(await original<typeof import("@/api/client")>()),
  request: vi.fn(),
}));
vi.mock("@/areas/console/pages/projects/project-information", () => ({
  ProjectInformation: ({ project }: { project: Resource }) => (
    <section aria-label="项目介绍内容">{project.description}</section>
  ),
}));
vi.mock("@/areas/console/pages/projects/project-members", () => ({
  ProjectMembers: () => <section>成员列表内容</section>,
}));
vi.mock("@/areas/console/pages/projects/project-teams", () => ({
  ProjectTeams: () => <section>团队授权内容</section>,
}));
vi.mock("@/areas/console/pages/projects/project-repositories", () => ({
  AdminProjectRepositories: () => <section>仓库列表内容</section>,
}));
vi.mock("@/areas/console/pages/projects/project-profile-editor", () => ({
  ProjectProfileEditor: () => (
    <div role="dialog" aria-label="编辑项目">
      基本资料与项目介绍分开编辑
    </div>
  ),
}));

let project: Resource;
let lifecycleError: ApiError | undefined;
const mockedRequest = vi.mocked(request);
beforeEach(() => {
  project = {
    id: "7",
    code: "delivery-platform",
    name: "交付平台",
    summary: "统一管理项目交付与发布",
    description: "## 项目目标\n完善交付协作。",
    icon_key: null,
    icon_file_id: null,
    created_by_user_id: "1",
    version: "1",
    membership_version: "1",
    ended_at: null,
    created_at: "2026-11-01T00:00:00Z",
    updated_at: "2026-11-02T00:00:00Z",
    direct_role: "",
    is_member: false,
    member_count: 12,
    status: "active",
    etag: '"project-7-v1"',
    membership_etag: '"project-members-7-v1"',
    can_manage: true,
  };
  lifecycleError = undefined;
  mockedRequest.mockReset();
  mockedRequest.mockImplementation(
    async (path, options: RequestOptions = {}) => {
      if (path === "/projects/7" && !options.method)
        return {
          data: structuredClone(project),
          etag: project.etag,
          status: 200,
        };
      if (path === "/projects/7/archive" || path === "/projects/7/restore") {
        if (lifecycleError) throw lifecycleError;
        return { data: undefined, etag: "", status: 204 };
      }
      throw new Error(`Unexpected request ${path}`);
    },
  );
});

function mount(entry = "/admin/projects/7") {
  const router = createMemoryRouter(
    [
      {
        path: "/admin/projects/:projectId",
        element: <AdminProjectDetail />,
      },
    ],
    { initialEntries: [entry] },
  );
  render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: {
            queries: { retry: false, gcTime: 0 },
            mutations: { retry: false },
          },
        })
      }
    >
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { router, user: userEvent.setup() };
}

it("uses a compact project header and separates profile editing from the description", async () => {
  const { user } = mount();
  expect(
    await screen.findByRole("heading", { name: /交付平台/ }),
  ).toBeVisible();
  expect(screen.getByText("统一管理项目交付与发布")).toBeVisible();
  expect(screen.getByRole("button", { name: "复制项目编码" })).toBeVisible();
  expect(screen.getByText(/创建于/)).toBeVisible();
  expect(screen.getByText(/最近更新/)).toBeVisible();
  expect(screen.getByRole("tab", { name: "项目介绍" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  expect(screen.getByRole("tab", { name: "成员管理" })).toBeInTheDocument();
  expect(screen.getByLabelText("项目介绍内容")).toHaveTextContent("项目目标");
  expect(
    screen.queryByRole("button", { name: "编辑资料" }),
  ).not.toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "交付平台的操作" }));
  await user.click(await screen.findByRole("menuitem", { name: "编辑资料" }));
  expect(
    await screen.findByRole("dialog", { name: "编辑项目" }),
  ).toHaveTextContent("基本资料与项目介绍分开编辑");
});

it.each([
  ["", "项目介绍", "项目目标"],
  ["?tab=unknown", "项目介绍", "项目目标"],
  ["?tab=settings", "项目介绍", "项目目标"],
  ["?tab=settings&section=profile", "项目介绍", "项目目标"],
  ["?tab=members", "成员管理", "成员列表内容"],
  ["?tab=settings&section=members", "成员管理", "成员列表内容"],
  ["?tab=teams", "团队授权", "团队授权内容"],
  ["?tab=settings&section=teams", "团队授权", "团队授权内容"],
  ["?tab=variants", "项目介绍", "项目目标"],
  ["?tab=releases", "项目介绍", "项目目标"],
  ["?tab=repositories", "Git 仓库", "仓库列表内容"],
  ["?tab=settings&section=branch-model", "项目介绍", "项目目标"],
  ["?tab=settings&section=unknown", "项目设置", "项目服务凭证"],
])(
  "normalizes %s without a blank content area",
  async (search, tab, content) => {
    mount(`/admin/projects/7${search}`);
    expect(
      await screen.findByRole("tab", {
        name: tab === "成员管理" ? /成员管理/ : tab,
      }),
    ).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText(new RegExp(content))).toBeVisible();
  },
);

it("keeps credential management inside the console project context", async () => {
  const { user } = mount("/admin/projects/7?tab=settings&section=integrations");
  const link = await screen.findByRole("link", { name: "管理服务凭证" });
  expect(link).toHaveAttribute("href", "/admin/projects/7/integrations");

  await user.click(screen.getByRole("button", { name: "SSH 凭证" }));
  expect(
    await screen.findByRole("link", { name: "管理 SSH 凭证" }),
  ).toHaveAttribute("href", "/admin/projects/7/remote-hosts");
});

it("clears stale settings parameters when changing the primary task", async () => {
  const { router, user } = mount(
    "/admin/projects/7?tab=settings&section=integrations",
  );
  await user.click(await screen.findByRole("tab", { name: /成员管理/ }));
  await screen.findByText("成员列表内容");
  expect(router.state.location.search).toBe("?tab=members");

  await user.click(screen.getByRole("tab", { name: "项目介绍" }));
  await screen.findByLabelText("项目介绍内容");
  expect(router.state.location.search).toBe("");
});

it("retains lifecycle confirmation and uses the project version", async () => {
  const { user } = mount();
  await user.click(
    await screen.findByRole("button", { name: "交付平台的操作" }),
  );
  await user.click(await screen.findByRole("menuitem", { name: "归档项目" }));
  const dialog = await screen.findByRole("dialog", { name: "归档项目" });
  expect(dialog).toHaveTextContent("归档后项目资料与仓库标签只读");
  await user.click(screen.getByRole("button", { name: "确认归档" }));
  await waitFor(() =>
    expect(mockedRequest).toHaveBeenCalledWith("/projects/7/archive", {
      method: "POST",
      etag: project.etag,
      body: {},
    }),
  );
  await waitFor(() => expect(dialog).not.toBeInTheDocument());
});

it("blocks an uncertain lifecycle replay and recovers through a read", async () => {
  lifecycleError = new ApiError(
    "NETWORK_ERROR",
    "结果未知",
    0,
    [],
    undefined,
    undefined,
    true,
  );
  const { user } = mount();
  await user.click(
    await screen.findByRole("button", { name: "交付平台的操作" }),
  );
  await user.click(await screen.findByRole("menuitem", { name: "归档项目" }));
  await user.click(await screen.findByRole("button", { name: "确认归档" }));
  const confirm = await screen.findByRole("button", { name: "确认归档" });
  await waitFor(() => expect(confirm).toBeDisabled());
  await user.click(confirm);
  expect(
    mockedRequest.mock.calls.filter(([path]) => path === "/projects/7/archive"),
  ).toHaveLength(1);

  lifecycleError = undefined;
  await user.click(screen.getByRole("button", { name: "重新读取项目状态" }));
  await waitFor(() =>
    expect(
      screen.queryByRole("dialog", { name: "归档项目" }),
    ).not.toBeInTheDocument(),
  );
});

it("offers restore instead of archive for an archived project", async () => {
  project.status = "archived";
  project.can_manage = false;
  const { user } = mount();
  await user.click(
    await screen.findByRole("button", { name: "交付平台的操作" }),
  );
  expect(
    await screen.findByRole("menuitem", { name: "编辑资料" }),
  ).toHaveAttribute("aria-disabled", "true");
  expect(
    await screen.findByRole("menuitem", { name: "恢复项目" }),
  ).toBeVisible();
  expect(
    screen.queryByRole("menuitem", { name: "归档项目" }),
  ).not.toBeInTheDocument();
});
