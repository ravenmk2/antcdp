import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, expect, it, vi } from "vitest";
import { request, type RequestOptions } from "@/api/client";
import { ProjectMembers } from "@/areas/console/pages/projects/project-members";
import { MembersPanel } from "@/features/collaboration/members";
import type { Member, Resource, ResourceKind } from "@/types/collaboration";

vi.mock("@/api/client", async (original) => ({
  ...(await original<typeof import("@/api/client")>()),
  request: vi.fn(),
}));

const mockedRequest = vi.mocked(request);
let role: "member" | "admin";

function resource(kind: ResourceKind, canManage = true): Resource {
  const team = kind === "teams";
  return {
    id: team ? "9" : "7",
    code: team ? "platform" : "delivery",
    name: team ? "平台团队" : "交付平台",
    summary: "",
    description: "",
    icon_key: null,
    icon_file_id: null,
    created_by_user_id: "1",
    version: "1",
    membership_version: "1",
    ended_at: null,
    created_at: "2026-11-01T00:00:00Z",
    updated_at: "2026-11-01T00:00:00Z",
    direct_role: "admin",
    is_member: true,
    member_count: 1,
    status: "active",
    etag: `"${kind}-v1"`,
    membership_etag: '"members-v1"',
    can_manage: canManage,
  };
}

function member(): Member {
  return {
    user_id: "21",
    username: "member",
    display_name: "张三",
    account_status: "active",
    direct_role: role,
    effective_role: role,
    sources: [{ type: "direct" }],
  };
}

function response(data: unknown) {
  return {
    data: structuredClone(data),
    etag: '"resource-v1"',
    collectionEtag: '"collection-v1"',
    status: 200,
  };
}

beforeEach(() => {
  role = "member";
  mockedRequest.mockReset();
  mockedRequest.mockImplementation(
    async (path, options: RequestOptions = {}) => {
      const kind = path.startsWith("/teams/") ? "teams" : "projects";
      const id = kind === "teams" ? "9" : "7";
      if (path === `/${kind}/${id}/members/${member().user_id}`) {
        if (options.method === "PATCH") {
          role = (options.body as { role: "member" | "admin" }).role;
          return response(member());
        }
      }
      if (path.startsWith(`/${kind}/${id}/members?`))
        return response({
          items: [member()],
          total: 1,
          page: 1,
          page_size: 20,
          membership_etag: '"members-v1"',
        });
      throw new Error(`Unexpected request ${path}`);
    },
  );
});

function mount(element: React.ReactNode) {
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
      {element}
    </QueryClientProvider>,
  );
  return userEvent.setup();
}

it("keeps project roles read-only and confirms promotion before writing", async () => {
  const user = mount(<ProjectMembers project={resource("projects")} />);
  expect(
    await screen.findByRole("table", { name: "交付平台成员" }),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("combobox", { name: /调整.*直接角色/ }),
  ).not.toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "张三的操作" }));
  await user.click(await screen.findByRole("menuitem", { name: "更改角色" }));
  const administrator = await screen.findByRole("menuitem", {
    name: "项目管理员",
  });
  administrator.focus();
  await user.keyboard("{Enter}");
  expect(
    await screen.findByRole("dialog", { name: "提升为项目管理员" }),
  ).toHaveTextContent("交付平台");
  expect(
    mockedRequest.mock.calls.filter(
      ([, options]) => options?.method === "PATCH",
    ),
  ).toHaveLength(0);

  await user.click(screen.getByRole("button", { name: "确认提升" }));
  await waitFor(() =>
    expect(mockedRequest).toHaveBeenCalledWith("/projects/7/members/21", {
      method: "PATCH",
      etag: '"members-v1"',
      body: { role: "admin" },
    }),
  );
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
});

it("changes a team administrator to a member without a promotion dialog", async () => {
  role = "admin";
  const user = mount(
    <MembersPanel kind="teams" resource={resource("teams")} />,
  );
  expect(
    await screen.findByRole("table", { name: "平台团队成员" }),
  ).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "张三的操作" }));
  await user.click(await screen.findByRole("menuitem", { name: "更改角色" }));
  const memberRole = await screen.findByRole("menuitem", { name: "团队成员" });
  memberRole.focus();
  await user.keyboard("{Enter}");

  await waitFor(() =>
    expect(mockedRequest).toHaveBeenCalledWith("/teams/9/members/21", {
      method: "PATCH",
      etag: '"members-v1"',
      body: { role: "member" },
    }),
  );
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it("does not expose role actions to read-only users", async () => {
  mount(<ProjectMembers project={resource("projects", false)} />);
  expect(
    await screen.findByRole("table", { name: "交付平台成员" }),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "张三的操作" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("combobox", { name: /调整.*角色/ }),
  ).not.toBeInTheDocument();
});
