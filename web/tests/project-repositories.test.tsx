import { ProjectRepositories } from "@/features/repositories/repositories";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, expect, it, vi } from "vitest";
import { ApiError, request } from "@/api/client";
import { AdminProjectRepositories } from "@/areas/console/pages/projects/project-repositories";
import type { Resource } from "@/types/collaboration";
import type { ProjectRepository } from "@/types/integrations";

vi.mock("@/api/client", async (original) => ({
  ...(await original<typeof import("@/api/client")>()),
  request: vi.fn(),
}));

const mockedRequest = vi.mocked(request);
const project: Resource = {
  id: "7",
  code: "delivery",
  name: "交付平台",
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
  direct_role: "",
  is_member: false,
  member_count: 1,
  status: "active",
  etag: '"project-v1"',
  membership_etag: '"members-v1"',
  can_manage: true,
};

function repository(id: string, path: string): ProjectRepository {
  return {
    id,
    labels: [],
    repo_id: `remote-${id}`,
    name: path.split("/").at(-1) ?? path,
    namespace_path: "group",
    full_path: path,
    default_branch: "main",
    remote_archived: false,
    web_url: null,
    http_clone_url: null,
    ssh_clone_url: null,
    connection_id: "3",
    connection_name: "GitLab",
    service_type: "gitlab",
    connection_enabled: true,
    last_synced_at: "2026-11-02T00:00:00Z",
    etag: `"repository-${id}-v1"`,
  };
}

beforeEach(() => {
  mockedRequest.mockReset();
  mockedRequest.mockImplementation(async (path) => {
    if (path === "/projects/7/repository-labels")
      return {
        data: { items: [], mutation_version: '"labels-v1"' },
        etag: "",
        status: 200,
      };
    if (path === "/admin/projects/7/repository-connections")
      return { data: [], etag: "", status: 200 };
    if (path.startsWith("/projects/7/repositories?")) {
      const params = new URLSearchParams(path.split("?")[1]);
      const page = Number(params.get("page"));
      const items =
        page === 2
          ? [repository("3", "group/worker"), repository("4", "group/docs")]
          : [repository("1", "group/api"), repository("2", "group/web")];
      return {
        data: { items, total: 40, page, page_size: 20 },
        etag: "",
        collectionEtag: '"repositories-v1"',
        status: 200,
      };
    }
    throw new Error(`Unexpected request ${path}`);
  });
});

it("selects the current page from the table header and clears selection on pagination", async () => {
  render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: { queries: { retry: false, gcTime: 0 } },
        })
      }
    >
      <AdminProjectRepositories project={project} />
    </QueryClientProvider>,
  );
  const user = userEvent.setup();
  expect(
    await screen.findByRole("table", { name: "交付平台 Git 仓库" }),
  ).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "批量操作" }));

  const selectAll = screen.getByRole("checkbox", {
    name: "选择本页全部仓库",
  });
  const first = screen.getByRole("checkbox", { name: "选择 group/api" });
  const second = screen.getByRole("checkbox", { name: "选择 group/web" });
  expect(selectAll).not.toBeChecked();
  await user.click(selectAll);
  expect(first).toBeChecked();
  expect(second).toBeChecked();
  expect(screen.getByText("已选择 2 项")).toBeInTheDocument();

  await user.click(first);
  expect(selectAll).not.toBeChecked();
  expect(selectAll).toBePartiallyChecked();
  await user.click(selectAll);
  expect(first).toBeChecked();
  expect(second).toBeChecked();

  await user.click(screen.getByRole("button", { name: "下一页" }));
  expect(await screen.findByText("group/worker")).toBeInTheDocument();
  await waitFor(() =>
    expect(
      mockedRequest.mock.calls.some(
        ([path]) =>
          path.startsWith("/projects/7/repositories?") &&
          path.includes("page=2"),
      ),
    ).toBe(true),
  );
  const nextPageSelectAll = screen.getByRole("checkbox", {
    name: "选择本页全部仓库",
  });
  expect(nextPageSelectAll).not.toBeChecked();
  expect(nextPageSelectAll).not.toBePartiallyChecked();
  expect(screen.getByText("已选择 0 项")).toBeInTheDocument();
});

it("keeps workspace repositories read-only even for an administrator", async () => {
  const user = userEvent.setup();
  render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: { queries: { retry: false, gcTime: 0 } },
        })
      }
    >
      <ProjectRepositories project={project} />
    </QueryClientProvider>,
  );
  await screen.findByText("group/api");
  expect(
    screen.queryByRole("button", { name: "管理标签" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "关联仓库" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "批量操作" }),
  ).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "group/api的操作" }));
  expect(await screen.findByRole("menuitem", { name: "详情" })).toBeVisible();
  expect(
    screen.queryByRole("menuitem", { name: "设置标签" }),
  ).not.toBeInTheDocument();
  expect(
    mockedRequest.mock.calls.some(([path]) => path.startsWith("/admin/")),
  ).toBe(false);
});

it("clears successful batch sync selections and retains failed items", async () => {
  const original = mockedRequest.getMockImplementation()!;
  mockedRequest.mockImplementation((path, options) => {
    if (path === "/projects/7/repositories/1")
      return Promise.resolve({
        data: repository("1", "group/api"),
        etag: '"fresh-1"',
        status: 200,
      });
    if (path === "/projects/7/repositories/2")
      return Promise.resolve({
        data: repository("2", "group/web"),
        etag: '"fresh-2"',
        status: 200,
      });
    if (path === "/projects/7/repositories/1/refresh")
      return Promise.resolve({ data: {}, etag: '"saved"', status: 200 });
    if (path === "/projects/7/repositories/2/refresh")
      return Promise.reject(
        new ApiError("REMOTE_ACCESS_DENIED", "远端拒绝访问", 502),
      );
    return original(path, options);
  });
  const user = userEvent.setup();
  render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: { queries: { retry: false, gcTime: 0 } },
        })
      }
    >
      <AdminProjectRepositories project={project} />
    </QueryClientProvider>,
  );
  await screen.findByText("group/api");
  await user.click(screen.getByRole("button", { name: "批量操作" }));
  await user.click(screen.getByRole("checkbox", { name: "选择本页全部仓库" }));
  await user.click(screen.getByRole("button", { name: "同步信息" }));
  await user.click(await screen.findByRole("button", { name: "开始同步" }));
  await user.click(await screen.findByRole("button", { name: "完成" }));
  await waitFor(() =>
    expect(
      screen.getByRole("checkbox", { name: "选择 group/api" }),
    ).not.toBeChecked(),
  );
  expect(
    screen.getByRole("checkbox", { name: "选择 group/web" }),
  ).toBeChecked();
  expect(screen.getByText("已选择 1 项")).toBeVisible();
});

it("retains unknown batch results when retrying confirmed failures", async () => {
  const original = mockedRequest.getMockImplementation()!;
  let attempts = 0;
  mockedRequest.mockImplementation((path, options) => {
    if (path === "/projects/7/repositories/1")
      return Promise.resolve({
        data: repository("1", "group/api"),
        etag: '"fresh-1"',
        status: 200,
      });
    if (path === "/projects/7/repositories/2")
      return Promise.resolve({
        data: repository("2", "group/web"),
        etag: '"fresh-2"',
        status: 200,
      });
    if (path === "/projects/7/repositories/1/refresh")
      return Promise.reject(
        new ApiError(
          "REQUEST_FAILED",
          "连接中断",
          0,
          [],
          undefined,
          undefined,
          true,
        ),
      );
    if (path === "/projects/7/repositories/2/refresh")
      return ++attempts === 1
        ? Promise.reject(
            new ApiError("REMOTE_ACCESS_DENIED", "远端拒绝访问", 502),
          )
        : Promise.resolve({ data: {}, etag: '"saved"', status: 200 });
    return original(path, options);
  });
  const user = userEvent.setup();
  render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: { queries: { retry: false, gcTime: 0 } },
        })
      }
    >
      <AdminProjectRepositories project={project} />
    </QueryClientProvider>,
  );
  await screen.findByText("group/api");
  await user.click(screen.getByRole("button", { name: "批量操作" }));
  await user.click(screen.getByRole("checkbox", { name: "选择本页全部仓库" }));
  await user.click(screen.getByRole("button", { name: "同步信息" }));
  await user.click(await screen.findByRole("button", { name: "开始同步" }));
  await user.click(
    await screen.findByRole("button", { name: "重试已确认失败项" }),
  );
  await screen.findByText("成功");
  expect(screen.getByText("待核实")).toBeVisible();
  expect(
    mockedRequest.mock.calls.filter(
      ([path]) => path === "/projects/7/repositories/1/refresh",
    ),
  ).toHaveLength(1);
});
