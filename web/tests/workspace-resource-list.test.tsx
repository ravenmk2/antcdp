import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import { beforeEach, expect, it, vi } from "vitest";
import { ApiError, request, type RequestOptions } from "@/api/client";
import {
  WorkspaceProjectList,
  WorkspaceTeamList,
} from "@/areas/workspace/pages/workspace-resource-list";
import type { Resource, ResourceKind, Shortcuts } from "@/types/collaboration";

vi.mock("@/app/auth", () => ({
  useSession: () => ({
    user: { id: "1", username: "founder", display_name: "创始人" },
  }),
  useAuth: () => ({ settings: { timezone: "Asia/Shanghai" } }),
}));
vi.mock("@/api/client", async (original) => ({
  ...(await original<typeof import("@/api/client")>()),
  request: vi.fn(),
}));

const project: Resource = {
  id: "7",
  code: "delivery",
  name: "交付平台",
  summary: "统一管理项目交付与发布",
  description: "",
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
const otherProject: Resource = {
  ...project,
  id: "8",
  code: "other",
  name: "其他项目",
};
const mockedRequest = vi.mocked(request);
let shortcuts: Shortcuts;
let shortcutError: ApiError | undefined;

function response<T>(data: T) {
  return { data, etag: "", status: 200 };
}

function resourceFor(kind: ResourceKind, id: string) {
  return [project, otherProject].find(
    (item) => item.id === id && (kind === "projects" || id === "11"),
  );
}

beforeEach(() => {
  localStorage.clear();
  shortcutError = undefined;
  shortcuts = {
    projects: { items: [], version: "1", etag: '"projects-v1"' },
    teams: { items: [], version: "1", etag: '"teams-v1"' },
  };
  mockedRequest.mockReset();
  mockedRequest.mockImplementation(
    async (path: string, options: RequestOptions = {}) => {
      const method = options.method ?? "GET";
      if (path === "/me/sidebar-shortcuts") return response(shortcuts);
      const shortcutMatch = path.match(
        /^\/me\/sidebar-shortcuts\/(projects|teams)$/,
      );
      if (shortcutMatch && method === "PUT") {
        if (shortcutError) {
          const error = shortcutError;
          shortcutError = undefined;
          throw error;
        }
        const kind = shortcutMatch[1] as ResourceKind;
        const ids = (options.body as { ids: string[] }).ids;
        const items = ids.flatMap((id) => {
          const resource =
            resourceFor(kind, id) ??
            (kind === "teams" && id === "11" ? team : undefined);
          return resource
            ? [
                {
                  id: resource.id,
                  code: resource.code,
                  name: resource.name,
                  icon_key: resource.icon_key,
                  icon_file_id: resource.icon_file_id,
                  status: resource.status,
                  sort_order: 1,
                },
              ]
            : [];
        });
        shortcuts = {
          ...shortcuts,
          [kind]: {
            items,
            version: String(Number(shortcuts[kind].version) + 1),
            etag: `"${kind}-v${Number(shortcuts[kind].version) + 1}"`,
          },
        };
        return response(shortcuts[kind]);
      }
      if (path.startsWith("/projects?") || path.startsWith("/teams?")) {
        const kind: ResourceKind = path.startsWith("/projects?")
          ? "projects"
          : "teams";
        const params = new URLSearchParams(path.split("?")[1]);
        const q = params.get("q") ?? "";
        const items =
          params.get("page_size") === "1"
            ? []
            : kind === "teams"
              ? [team]
              : q === "其他"
                ? [otherProject]
                : q
                  ? []
                  : [project];
        return response({
          items,
          total: items.length,
          page: 1,
          page_size: Number(params.get("page_size")),
        });
      }
      throw new Error(`Unexpected request ${method} ${path}`);
    },
  );
});

function mount(kind: ResourceKind) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/${kind}`]}>
        {kind === "projects" ? <WorkspaceProjectList /> : <WorkspaceTeamList />}
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return userEvent.setup();
}

it("renders project cards and applies the confirmed follow result", async () => {
  const user = mount("projects");
  expect(await screen.findByRole("link", { name: "交付平台" })).toBeVisible();
  expect(screen.getByText("项目管理员")).toBeVisible();
  expect(screen.getByText("12 位成员")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "关注 交付平台" }));
  expect(
    await screen.findByRole("button", { name: "取消关注 交付平台" }),
  ).toHaveAttribute("aria-pressed", "true");
  expect(mockedRequest).toHaveBeenCalledWith(
    "/me/sidebar-shortcuts/projects",
    expect.objectContaining({
      method: "PUT",
      etag: '"projects-v1"',
      body: { ids: ["7"] },
    }),
  );
});

it("renders team rows and applies the confirmed pin result", async () => {
  const user = mount("teams");
  expect(await screen.findByRole("link", { name: "平台团队" })).toBeVisible();
  expect(screen.getByText("团队管理员")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "固定 平台团队" }));
  expect(
    await screen.findByRole("button", { name: "取消固定 平台团队" }),
  ).toHaveAttribute("aria-pressed", "true");
});

it("keeps selected objects visible across candidate searches", async () => {
  const user = mount("projects");
  await screen.findByRole("link", { name: "交付平台" });
  await user.click(screen.getByRole("button", { name: "管理关注" }));
  const dialog = await screen.findByRole("dialog", { name: "管理关注项目" });
  await user.click(
    await within(dialog).findByRole("button", { name: /交付平台/ }),
  );
  expect(
    within(dialog).getByRole("button", { name: "上移 交付平台" }),
  ).toBeVisible();

  await user.type(
    within(dialog).getByRole("textbox", { name: "搜索可添加对象" }),
    "其他",
  );
  await user.click(within(dialog).getByRole("button", { name: "搜索" }));
  await user.click(
    await within(dialog).findByRole("button", { name: /其他项目/ }),
  );
  expect(
    within(dialog).getByRole("button", { name: "上移 交付平台" }),
  ).toBeVisible();
  expect(
    within(dialog).getByRole("button", { name: "上移 其他项目" }),
  ).toBeVisible();
  expect(within(dialog).getByText("已选择 · 2")).toBeVisible();
});

it("refreshes shortcut conflicts without replaying the write", async () => {
  shortcutError = new ApiError("VERSION_CONFLICT", "快捷方式已变化", 412);
  const user = mount("projects");
  await screen.findByRole("link", { name: "交付平台" });
  await user.click(screen.getByRole("button", { name: "关注 交付平台" }));
  expect(await screen.findByText("快捷方式已变化")).toBeVisible();
  expect(
    mockedRequest.mock.calls.filter(
      ([path, options]) =>
        path === "/me/sidebar-shortcuts/projects" && options?.method === "PUT",
    ),
  ).toHaveLength(1);
  await user.click(screen.getByRole("button", { name: "重新读取快捷方式" }));
  expect(screen.queryByText("快捷方式已变化")).not.toBeInTheDocument();
  expect(
    mockedRequest.mock.calls.filter(([, options]) => options?.method === "PUT"),
  ).toHaveLength(1);
});
