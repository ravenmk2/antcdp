import { ApiError, request, type RequestOptions } from "@/api/client";
import {
  CloudComputerDetailPage,
  CloudSettingsPage,
} from "@/areas/console/pages/cloud-computers";
import { PersonalCloudComputerPage } from "@/areas/workspace/pages/personal-cloud-computer";
import { NavigationGuardProvider } from "@/components/navigation-guard";
import { AgentRuntimeProvider } from "@/features/agents/data/agent-runtime";
import { sandboxKeys } from "@/features/agents/sandbox/shared";
import { WorkspaceFiles } from "@/features/agents/sandbox/workspace-files";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, Outlet, RouterProvider } from "react-router";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { computer, sandboxConnection } from "./fixtures/sandbox";
vi.mock("@/api/client", async (original) => ({
  ...(await original<typeof import("@/api/client")>()),
  request: vi.fn(),
}));
vi.mock("@/app/auth", () => ({
  useSession: () => ({ user: { id: "1", role: "admin" } }),
}));
const mocked = vi.mocked(request);
const response = (data: unknown, etag = '"v1"') => ({
  data,
  etag,
  status: 200,
});
let override:
  | ((
      path: string,
      options: RequestOptions,
    ) => Promise<ReturnType<typeof response> | undefined>)
  | undefined;
beforeEach(() => {
  override = undefined;
  mocked.mockReset();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  mocked.mockImplementation(async (path, options = {}) => {
    const custom = await override?.(path, options);
    if (custom) return custom;
    if (path === "/admin/agents/sandbox-connection")
      return response(sandboxConnection);
    if (
      path === "/admin/agents/cloud-computers/9" ||
      path === "/agents/cloud-computers/9"
    )
      return response(computer);
    if (path === "/agents/cloud-computer") return response(null);
    if (path.includes("/entries?"))
      return {
        ...response([
          {
            name: "report.txt",
            path: "report.txt",
            kind: "file",
            size_bytes: "3",
            modified_at: null,
            entry_token: "observed-v1",
          },
        ]),
        pagination: { total: 1 },
      };
    throw new Error(`Unexpected ${options.method ?? "GET"} ${path}`);
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
function mount(entry: string) {
  const router = createMemoryRouter(
    [
      {
        element: (
          <NavigationGuardProvider>
            <AgentRuntimeProvider>
              <Outlet />
            </AgentRuntimeProvider>
          </NavigationGuardProvider>
        ),
        children: [
          {
            path: "/admin/cloud-computers/settings",
            element: <CloudSettingsPage />,
          },
          {
            path: "/admin/cloud-computers/:computerId",
            element: <CloudComputerDetailPage />,
          },
          { path: "/cloud-computer", element: <PersonalCloudComputerPage /> },
          { path: "/files", element: <WorkspaceFiles computerId="9" /> },
        ],
      },
    ],
    { initialEntries: [entry] },
  );
  const cache = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={cache}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { user: userEvent.setup(), cache };
}
function operation(status = "succeeded", result: unknown = {}) {
  return {
    id: "31",
    kind: "workspace_remove",
    target: { kind: "cloud_computer", id: "9" },
    status,
    created_at: computer.last_activity_at,
    started_at: computer.last_activity_at,
    finished_at: computer.last_activity_at,
    deadline_at: "2099-11-09T00:00:00Z",
    outcome: {
      certainty: status === "outcome_unknown" ? "unknown" : "known",
      reason: null,
    },
    error_code: null,
    result,
  };
}
it("limits administrators to human computer maintenance without file access", async () => {
  mount("/admin/cloud-computers/9");
  expect(
    await screen.findByRole("button", { name: "重建运行环境" }),
  ).toBeEnabled();
  expect(
    screen.queryByRole("button", { name: "打开机器人文件" }),
  ).not.toBeInTheDocument();
  expect(mocked.mock.calls.some(([path]) => path.includes("/entries"))).toBe(
    false,
  );
});
it("requires a preview and second confirmation before changing the endpoint", async () => {
  override = async (path, options) => {
    if (path.endsWith("/preview"))
      return response({
        confirmation_token: "confirmed-target",
        affected_computers: 2,
        busy_activities: 0,
        resets_storage: true,
        expires_at: "2099-01-01T00:00:00Z",
      });
    if (options.method === "PUT")
      return response(
        {
          ...sandboxConnection,
          endpoint: "https://new.example.com",
          version: "v2",
        },
        '"v2"',
      );
  };
  const { user } = mount("/admin/cloud-computers/settings");
  const endpoint = await screen.findByLabelText("服务地址");
  await user.clear(endpoint);
  await user.type(endpoint, "https://new.example.com");
  await user.click(screen.getByRole("button", { name: "检查更换影响" }));
  expect(
    await screen.findByRole("dialog", { name: "确认更换沙箱服务地址？" }),
  ).toBeVisible();
  expect(
    mocked.mock.calls.some(([, options]) => options?.method === "PUT"),
  ).toBe(false);
  await user.click(screen.getByRole("button", { name: "承担后果并更换地址" }));
  await waitFor(() =>
    expect(mocked).toHaveBeenCalledWith(
      "/admin/agents/sandbox-connection",
      expect.objectContaining({
        method: "PUT",
        etag: '"v1"',
        idempotencyKey: expect.any(String),
        body: expect.objectContaining({
          endpoint: "https://new.example.com",
          confirmation_token: "confirmed-target",
        }),
      }),
    ),
  );
});
it("disables file mutations when the directory could not be read", async () => {
  override = async (path) => {
    if (path.includes("/entries?"))
      throw new ApiError("SANDBOX_NOT_READY", "沙箱尚未就绪", 409);
    return undefined;
  };
  mount("/files");
  await screen.findByText("沙箱尚未就绪");
  await screen.findByText("活动轮次 0");
  expect(screen.getByRole("button", { name: "新建目录" })).toBeDisabled();
});
it("keeps writes unavailable while execution is unknown without hiding reads", async () => {
  override = async (path) =>
    path === "/agents/cloud-computers/9"
      ? response({
          ...computer,
          state: "unavailable",
          unknown_executions: 1,
        })
      : undefined;
  mount("/files");
  await screen.findByText("report.txt");
  await screen.findByText("待核实执行 1");
  expect(screen.getByRole("button", { name: "新建目录" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "删除" })).toBeDisabled();
  expect(screen.getByRole("link", { name: "下载" })).toHaveAttribute(
    "href",
    expect.stringContaining("disposition=attachment"),
  );
});
it("renders populated directory pagination and navigates using returned paths", async () => {
  override = async (path) => {
    if (!path.includes("/entries?")) return undefined;
    const parent = new URLSearchParams(path.split("?")[1]).get("path");
    return {
      ...response([
        parent
          ? {
              name: "公开验证报告.md",
              path: "sessions/公开验证报告.md",
              kind: "file",
              size_bytes: "128",
              modified_at: null,
              entry_token: "report-v1",
            }
          : {
              name: "sessions",
              path: "sessions",
              kind: "directory",
              size_bytes: null,
              modified_at: null,
              entry_token: "directory-v1",
            },
      ]),
      pagination: { page: 1, page_size: 20, total: parent ? 1 : 6 },
    };
  };
  const { user } = mount("/files");
  await screen.findByRole("button", { name: "sessions" });
  expect(screen.getByText("共 6 条")).toBeInTheDocument();
  expect(screen.queryByText("当前目录没有文件")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "sessions" }));
  await screen.findByText("公开验证报告.md");
  expect(screen.getByText("共 1 条")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "下载" })).toHaveAttribute(
    "href",
    expect.stringContaining("path=sessions%2F"),
  );
});
it("refreshes occupancy after the directory read releases its own transfer", async () => {
  let reading = false,
    finishRead: (() => void) | undefined;
  override = async (path) => {
    if (path.includes("/entries?")) {
      reading = true;
      await new Promise<void>((resolve) => {
        finishRead = () => {
          reading = false;
          resolve();
        };
      });
    }
    if (path === "/agents/cloud-computers/9")
      return response({
        ...computer,
        pending_transfers: reading ? 1 : 0,
      });
    return undefined;
  };
  const { cache } = mount("/files");
  cache.setQueryData(
    [...sandboxKeys, "workspace", "9"],
    response({
      ...computer,
      pending_transfers: 1,
    }),
  );
  await waitFor(() => expect(finishRead).toBeTypeOf("function"));
  expect(screen.getByRole("button", { name: "新建目录" })).toBeDisabled();
  await act(async () => finishRead!());
  await screen.findByText("report.txt");
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "新建目录" })).toBeEnabled(),
  );
  expect(screen.getByText("传输 0")).toBeInTheDocument();
});
it("observes external transfer completion without repeating directory IO", async () => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  let transfers = 1;
  override = async (path) =>
    path === "/agents/cloud-computers/9"
      ? response({ ...computer, pending_transfers: transfers })
      : undefined;
  mount("/files");
  await screen.findByText("传输 1");
  expect(screen.getByRole("button", { name: "新建目录" })).toBeDisabled();
  const reads = mocked.mock.calls.filter(([path]) =>
    path.includes("/entries?"),
  ).length;
  transfers = 0;
  await act(async () => vi.advanceTimersByTimeAsync(3001));
  await screen.findByText("传输 0");
  expect(screen.getByRole("button", { name: "新建目录" })).toBeEnabled();
  expect(
    mocked.mock.calls.filter(([path]) => path.includes("/entries?")),
  ).toHaveLength(reads);
});
it("deletes the observed file using its token and freshly read maintenance ETag", async () => {
  override = async (path, options) =>
    path.endsWith("/file-removals") && options.method === "POST"
      ? response(operation())
      : path.endsWith("/operations/31")
        ? response(operation())
        : undefined;
  const { user } = mount("/files");
  await screen.findByText("report.txt");
  await user.click(screen.getByRole("button", { name: "删除" }));
  await user.click(screen.getByRole("button", { name: "确认删除" }));
  await waitFor(() =>
    expect(mocked).toHaveBeenCalledWith(
      "/agents/cloud-computers/9/file-removals",
      expect.objectContaining({
        method: "POST",
        etag: '"v1"',
        idempotencyKey: expect.any(String),
        body: {
          items: [{ path: "report.txt", entry_token: "observed-v1" }],
          recursive: false,
        },
      }),
    ),
  );
});
it("shows confirmed changed paths when file maintenance partially fails", async () => {
  const failed = {
    ...operation("failed", { affected_paths: ["storage/first-report.txt"] }),
    error_code: "WORKSPACE_RESULT_UNAVAILABLE",
  };
  override = async (path, options) =>
    (path.endsWith("/file-removals") && options.method === "POST") ||
    path.endsWith("/operations/31")
      ? response(failed)
      : undefined;
  const { user } = mount("/files");
  await screen.findByText("report.txt");
  await user.click(screen.getByRole("button", { name: "删除" }));
  await user.click(screen.getByRole("button", { name: "确认删除" }));
  await screen.findByText("已确认发生变化的路径");
  expect(screen.getByText("storage/first-report.txt")).toBeInTheDocument();
  expect(
    screen.getByText(/文件可能已变化，请重新检查目录/),
  ).toBeInTheDocument();
});
it("does not allocate a sandbox when visiting an empty personal environment", async () => {
  mount("/cloud-computer");
  await screen.findByText("电脑将在首次使用时创建");
  expect(
    mocked.mock.calls.every(
      ([, options]) => !options?.method || options.method === "GET",
    ),
  ).toBe(true);
});
