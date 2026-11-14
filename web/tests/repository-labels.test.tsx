import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, expect, it, vi } from "vitest";
import { ApiError, request } from "@/api/client";
import {
  RepositoryLabelManager,
  RepositoryLabelPicker,
} from "@/features/repositories/labels";
import type { ProjectRepository } from "@/types/integrations";

vi.mock("@/api/client", async (original) => ({
  ...(await original<typeof import("@/api/client")>()),
  request: vi.fn(),
}));
const mock = vi.mocked(request);
const label = {
  id: "10",
  code: "backend",
  name: "后端服务",
  color: "#3B82F6",
  repository_count: 1,
};
const repo: ProjectRepository = {
  id: "2",
  repo_id: "42",
  name: "api",
  namespace_path: "org",
  full_path: "org/api",
  default_branch: "main",
  remote_archived: false,
  web_url: null,
  http_clone_url: null,
  ssh_clone_url: null,
  connection_id: "3",
  connection_name: "GitLab",
  service_type: "gitlab",
  connection_enabled: false,
  last_synced_at: "2026-11-01T00:00:00Z",
  etag: '"repo-v1"',
  labels: [label],
};
function mount(
  content: React.ReactNode,
  client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  }),
) {
  return render(
    <QueryClientProvider client={client}>{content}</QueryClientProvider>,
  );
}
beforeEach(() => {
  mock.mockReset();
  mock.mockImplementation(async (path, options) => {
    if (options?.method) return { data: {}, etag: "", status: 200 };
    if (path.endsWith("/repository-labels"))
      return {
        data: { items: [label], mutation_version: '"labels-v1"' },
        etag: "",
        status: 200,
      };
    if (path.endsWith("/repositories/2"))
      return { data: repo, etag: repo.etag, status: 200 };
    throw new Error(`Unexpected request ${path}`);
  });
});

it("creates a label with code, name and color and the dictionary version", async () => {
  const saved = vi.fn(async () => {});
  const user = userEvent.setup();
  mount(
    <RepositoryLabelManager projectId="7" onClose={vi.fn()} onSaved={saved} />,
  );
  await screen.findByText("后端服务");
  await user.click(screen.getByRole("button", { name: "新建标签" }));
  const dialog = screen.getByRole("dialog", { name: "新建仓库标签" });
  await user.type(within(dialog).getByLabelText("编码"), "deployment");
  await user.type(within(dialog).getByLabelText("名称"), "部署配置");
  await user.click(
    within(dialog).getByRole("button", { name: "选择颜色 #10B981" }),
  );
  await user.click(within(dialog).getByRole("button", { name: "保存" }));
  await waitFor(() => expect(saved).toHaveBeenCalled());
  expect(mock).toHaveBeenCalledWith(
    "/projects/7/repository-labels",
    expect.objectContaining({
      method: "POST",
      etag: '"labels-v1"',
      body: { code: "deployment", name: "部署配置", color: "#10B981" },
    }),
  );
});

it("edits display metadata without sending the immutable code", async () => {
  const user = userEvent.setup();
  mount(
    <RepositoryLabelManager
      projectId="7"
      onClose={vi.fn()}
      onSaved={vi.fn(async () => {})}
    />,
  );
  await user.click(
    await screen.findByRole("button", { name: "编辑标签 后端服务" }),
  );
  const dialog = screen.getByRole("dialog", { name: "编辑仓库标签" });
  expect(within(dialog).getByLabelText("编码")).toHaveAttribute("readonly");
  await user.clear(within(dialog).getByLabelText("名称"));
  await user.type(within(dialog).getByLabelText("名称"), "服务端");
  await user.click(within(dialog).getByRole("button", { name: "保存" }));
  await waitFor(() =>
    expect(mock).toHaveBeenCalledWith(
      "/projects/7/repository-labels/10",
      expect.objectContaining({
        method: "PATCH",
        body: { name: "服务端", color: "#3B82F6" },
      }),
    ),
  );
});

it("clears a repository's labels locally even when its connection is disabled", async () => {
  const user = userEvent.setup();
  const close = vi.fn();
  mount(
    <RepositoryLabelPicker
      projectId="7"
      repository={repo}
      onClose={close}
      onSaved={vi.fn(async () => {})}
    />,
  );
  const selected = await screen.findByRole("checkbox", { name: /后端服务/ });
  expect(selected).toBeChecked();
  await user.click(selected);
  await user.click(screen.getByRole("button", { name: "保存" }));
  await waitFor(() => expect(close).toHaveBeenCalled());
  expect(mock).toHaveBeenCalledWith(
    "/projects/7/repositories/2/labels",
    expect.objectContaining({
      method: "PUT",
      etag: '"repo-v1"',
      body: { label_ids: [] },
    }),
  );
});

it("blocks replay after a version conflict until current bindings are reloaded", async () => {
  const original = mock.getMockImplementation()!;
  mock.mockImplementation((path, options) => {
    if (options?.method === "PUT")
      return Promise.reject(
        new ApiError("VERSION_CONFLICT", "版本已变化", 412),
      );
    return original(path, options);
  });
  const user = userEvent.setup();
  mount(
    <RepositoryLabelPicker
      projectId="7"
      repository={repo}
      onClose={vi.fn()}
      onSaved={vi.fn(async () => {})}
    />,
  );
  await user.click(await screen.findByRole("checkbox", { name: /后端服务/ }));
  await user.click(screen.getByRole("button", { name: "保存" }));
  await screen.findByText("版本已变化");
  expect(screen.getByRole("button", { name: "保存" })).toBeDisabled();
  await user.click(
    screen.getByRole("button", { name: "重新加载并核实当前标签" }),
  );
  await waitFor(() =>
    expect(screen.getByRole("checkbox", { name: /后端服务/ })).toBeChecked(),
  );
  expect(
    mock.mock.calls.filter(([, options]) => options?.method === "PUT"),
  ).toHaveLength(1);
});

it("shows binding impact and uses a collection version before deleting a label", async () => {
  const user = userEvent.setup();
  mount(
    <RepositoryLabelManager
      projectId="7"
      onClose={vi.fn()}
      onSaved={vi.fn(async () => {})}
    />,
  );
  await user.click(
    await screen.findByRole("button", { name: "删除标签 后端服务" }),
  );
  const dialog = screen.getByRole("dialog", { name: "删除仓库标签" });
  expect(dialog).toHaveTextContent("将从 1 个仓库移除此标签");
  await user.click(within(dialog).getByRole("button", { name: "删除标签" }));
  await waitFor(() =>
    expect(mock).toHaveBeenCalledWith(
      "/projects/7/repository-labels/10",
      expect.objectContaining({ method: "DELETE", etag: '"labels-v1"' }),
    ),
  );
});

it("keeps the edit version when the repository refreshes in the background", async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  const user = userEvent.setup();
  mount(
    <RepositoryLabelPicker
      projectId="7"
      repository={repo}
      onClose={vi.fn()}
      onSaved={vi.fn(async () => {})}
    />,
    client,
  );
  await user.click(await screen.findByRole("checkbox", { name: /后端服务/ }));
  await act(async () => {
    client.setQueryData(["repository", "7", "2"], {
      data: { ...repo, etag: '"repo-v2"' },
      etag: '"repo-v2"',
      status: 200,
    });
  });
  await user.click(screen.getByRole("button", { name: "保存" }));
  await waitFor(() =>
    expect(mock).toHaveBeenCalledWith(
      "/projects/7/repositories/2/labels",
      expect.objectContaining({
        method: "PUT",
        etag: '"repo-v1"',
        body: { label_ids: [] },
      }),
    ),
  );
});

it("keeps the confirmed deletion impact and version during background refresh", async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  const user = userEvent.setup();
  mount(
    <RepositoryLabelManager
      projectId="7"
      onClose={vi.fn()}
      onSaved={vi.fn(async () => {})}
    />,
    client,
  );
  await user.click(
    await screen.findByRole("button", { name: "删除标签 后端服务" }),
  );
  await act(async () => {
    client.setQueryData(["repository-labels", "7"], {
      data: {
        items: [{ ...label, repository_count: 4 }],
        mutation_version: '"labels-v2"',
      },
      etag: "",
      status: 200,
    });
  });
  const dialog = screen.getByRole("dialog", { name: "删除仓库标签" });
  expect(dialog).toHaveTextContent("将从 1 个仓库移除此标签");
  await user.click(within(dialog).getByRole("button", { name: "删除标签" }));
  await waitFor(() =>
    expect(mock).toHaveBeenCalledWith(
      "/projects/7/repository-labels/10",
      expect.objectContaining({ method: "DELETE", etag: '"labels-v1"' }),
    ),
  );
});
