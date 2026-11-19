import { ApiError, request, type RequestOptions } from "@/api/client";
import { CloudComputerDetailPage } from "@/areas/console/pages/cloud-computers";
import { SandboxesPage } from "@/areas/console/pages/sandboxes";
import { PersonalCloudComputerPage } from "@/areas/workspace/pages/personal-cloud-computer";
import { NavigationGuardProvider } from "@/components/navigation-guard";
import { AgentRuntimeProvider } from "@/features/agents/data/agent-runtime";
import { sandboxKeys } from "@/features/agents/sandbox/shared";
import { WorkspaceFiles } from "@/features/agents/sandbox/workspace-files";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
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
    if (path === "/admin/sandboxes/connection")
      return response(sandboxConnection);
    if (
      path === "/admin/agents/cloud-computers/9" ||
      path === "/agents/cloud-computers/9"
    )
      return response(computer);
    if (path === "/agents/cloud-computer") return response(null);
    if (path === "/agents/cloud-computers/9/home")
      return response({ status: "succeeded" });
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
            path: "/admin/sandboxes",
            element: <SandboxesPage />,
          },
          {
            path: "/admin/cloud-computers/:computerId",
            element: <CloudComputerDetailPage />,
          },
          { path: "/computer", element: <PersonalCloudComputerPage /> },
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
  const { user } = mount("/admin/sandboxes");
  const endpoint = await screen.findByLabelText("服务地址");
  expect(endpoint).toBeDisabled();
  await user.click(
    screen.getByRole("button", { name: "修改连接（极度危险）" }),
  );
  await user.clear(endpoint);
  await user.type(endpoint, "https://new.example.com");
  await user.click(screen.getByRole("button", { name: "预览连接变更" }));
  expect(
    await screen.findByRole("dialog", { name: "确认修改沙箱连接？" }),
  ).toBeVisible();
  expect(
    mocked.mock.calls.some(([, options]) => options?.method === "PUT"),
  ).toBe(false);
  expect(screen.getByRole("button", { name: "确认提交" })).toBeDisabled();
  await user.type(
    screen.getByLabelText("输入「确认修改沙箱连接」"),
    "确认修改沙箱连接",
  );
  await user.click(screen.getByRole("button", { name: "确认提交" }));
  await waitFor(() =>
    expect(mocked).toHaveBeenCalledWith(
      "/admin/sandboxes/connection",
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
  await waitFor(() =>
    expect(
      screen.queryByRole("dialog", { name: "删除文件？" }),
    ).not.toBeInTheDocument(),
  );
  expect(
    mocked.mock.calls.some(([path]) => path.includes("/operations/")),
  ).toBe(false);
});
it("keeps deletion in its dialog until the synchronous request completes", async () => {
  let finish: (() => void) | undefined;
  override = async (path, options) => {
    if (path.endsWith("/file-removals") && options.method === "POST") {
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      return response(operation());
    }
  };
  const { user } = mount("/files");
  await screen.findByText("report.txt");
  await user.click(screen.getByRole("button", { name: "删除" }));
  await user.click(screen.getByRole("button", { name: "确认删除" }));
  expect(
    await screen.findByRole("button", { name: "正在删除" }),
  ).toBeDisabled();
  expect(screen.getByRole("dialog", { name: "删除文件？" })).toBeVisible();
  await waitFor(() => expect(finish).toBeTypeOf("function"));
  await act(async () => finish!());
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  expect(screen.queryByText("操作进度")).not.toBeInTheDocument();
  expect(
    mocked.mock.calls.some(([path]) => path.includes("/operations/")),
  ).toBe(false);
});
it("checks an uncertain file result without submitting the deletion again", async () => {
  override = async (path, options) => {
    if (path.endsWith("/file-removals") && options.method === "POST")
      return response(operation("outcome_unknown"));
    if (path.endsWith("/operations/31")) return response(operation());
  };
  const { user } = mount("/files");
  await screen.findByText("report.txt");
  await user.click(screen.getByRole("button", { name: "删除" }));
  await user.click(screen.getByRole("button", { name: "确认删除" }));
  await screen.findByText("操作结果尚未确认，请先核实结果，不要重复执行。");
  expect(screen.getByRole("button", { name: "确认删除" })).toBeDisabled();
  expect(
    mocked.mock.calls.some(([path]) => path.includes("/operations/")),
  ).toBe(false);
  await user.click(screen.getByRole("button", { name: "核实结果" }));
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  expect(
    mocked.mock.calls.filter(([path]) => path.endsWith("/file-removals")),
  ).toHaveLength(1);
});
it("closes directory creation only after the synchronous result succeeds", async () => {
  override = async (path, options) =>
    path.endsWith("/directories") && options.method === "POST"
      ? response(operation())
      : undefined;
  const { user } = mount("/files");
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "新建目录" })).toBeEnabled(),
  );
  await user.click(screen.getByRole("button", { name: "新建目录" }));
  await user.type(screen.getByLabelText("目录名称"), "notes");
  await user.click(screen.getByRole("button", { name: "创建目录" }));
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  expect(screen.queryByText("操作进度")).not.toBeInTheDocument();
  expect(
    mocked.mock.calls.some(([path]) => path.includes("/operations/")),
  ).toBe(false);
});
it("shows confirmed changed paths when file maintenance partially fails", async () => {
  const failed = {
    ...operation("failed", { affected_paths: ["storage/first-report.txt"] }),
    error_code: "WORKSPACE_ENTRY_CHANGED",
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
  expect(screen.getByRole("dialog", { name: "删除文件？" })).toBeVisible();
  expect(screen.queryByText("操作进度")).not.toBeInTheDocument();
  expect(screen.getByText("storage/first-report.txt")).toBeInTheDocument();
  expect(
    screen.getByText("文件状态已变化，请刷新目录后重新选择"),
  ).toBeInTheDocument();
});
it("does not allocate a sandbox when visiting an empty personal environment", async () => {
  mount("/computer");
  await screen.findByText("电脑将在首次使用时创建");
  expect(
    mocked.mock.calls.every(
      ([, options]) => !options?.method || options.method === "GET",
    ),
  ).toBe(true);
});
it("browses nested personal directories and keeps environment details collapsed initially", async () => {
  override = async (path) => {
    if (path === "/agents/cloud-computer") return response(computer);
    if (path.includes("/entries?")) {
      const parent = new URLSearchParams(path.split("?")[1]).get("path");
      return {
        ...response(
          parent === "home"
            ? []
            : parent
              ? [
                  {
                    name: "report.md",
                    path: "reports/report.md",
                    kind: "file",
                    size_bytes: "100",
                    modified_at: null,
                    entry_token: "v1",
                  },
                ]
              : [
                  {
                    name: "reports",
                    path: "reports",
                    kind: "directory",
                    size_bytes: null,
                    modified_at: null,
                    entry_token: "v1",
                  },
                ],
        ),
        pagination: { total: 1 },
      };
    }
  };
  const { user } = mount("/computer");
  const details = (await screen.findByText("环境与存储")).closest("details");
  expect(details).not.toHaveAttribute("open");
  await user.click(screen.getByText("环境与存储"));
  expect(details).toHaveAttribute("open");
  await user.click(await screen.findByRole("button", { name: "reports" }));
  expect(
    await screen.findByRole("button", { name: "report.md" }),
  ).toBeVisible();
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "新建目录" })).toBeEnabled(),
  );
  await user.click(screen.getByRole("button", { name: "新建目录" }));
  expect(await screen.findByText("创建位置：/data/reports")).toBeVisible();
});
it("prevents directory creation after a personal directory read fails", async () => {
  override = async (path) => {
    if (path === "/agents/cloud-computer") return response(computer);
    if (path.includes("/entries?"))
      throw new ApiError("READ_FAILED", "目录不可读取", 503);
  };
  mount("/computer");
  await screen.findAllByText("目录不可读取");
  expect(screen.getByRole("button", { name: "新建目录" })).toBeDisabled();
});

it("uploads selected and dropped files by name into the default /data directory", async () => {
  const target = "/agents/cloud-computers/9/entries?path=&page=1&page_size=100";
  const home =
    "/agents/cloud-computers/9/entries?path=home&page=1&page_size=100";
  const uploads: string[] = [];
  override = async (path, options) => {
    if (path === "/agents/cloud-computer") return response(computer);
    if (path === "/agents/cloud-computers/9/file-uploads?path=") {
      const file = (options.body as FormData).get("file") as File;
      uploads.push(file.name);
      if (file.name === "同名.txt")
        throw new ApiError(
          "WORKSPACE_PATH_EXISTS",
          "当前目录已有同名文件或目录",
          409,
        );
      return { ...response({ path: file.name }), status: 201 };
    }
    if (path === target)
      return response(
        uploads
          .filter((name) => name !== "同名.txt")
          .map((name) => ({
            name,
            path: name,
            kind: "file",
            size_bytes: "1",
            modified_at: null,
            entry_token: "v1",
          })),
      );
  };
  const { user } = mount("/computer");
  const upload = await screen.findByRole("button", { name: "上传文件" });
  await waitFor(() => expect(upload).toBeEnabled());
  await user.click(upload);
  expect(
    screen.getByRole("dialog", { name: "上传文件" }),
  ).toHaveAccessibleDescription("保存到 /data");
  await user.upload(screen.getByLabelText("选择要上传的文件"), [
    new File(["a"], "原名.txt"),
    new File(["b"], "同名.txt"),
  ]);
  // The file picker and the drop zone feed the same upload queue.
  fireEvent.drop(screen.getByText("将文件拖到这里"), {
    dataTransfer: { files: [new File(["c"], "拖放.txt")] },
  });
  mocked.mockClear();
  await user.click(screen.getByRole("button", { name: "开始上传" }));
  await waitFor(() => expect(screen.getAllByText("已上传")).toHaveLength(2));
  expect(screen.getByText("当前目录已有同名文件或目录")).toBeVisible();
  expect(uploads).toEqual(["原名.txt", "同名.txt", "拖放.txt"]);
  await waitFor(() =>
    expect(mocked.mock.calls.filter(([path]) => path === target)).toHaveLength(
      1,
    ),
  );
  expect(mocked.mock.calls.some(([path]) => path === home)).toBe(false);
});

it("prepares home on each visit and lists its files only when expanded", async () => {
  let finish: (() => void) | undefined;
  let waiting = true;
  override = async (path) => {
    if (path === "/agents/cloud-computer") return response(computer);
    if (path.includes("/entries?")) {
      const parent = new URLSearchParams(path.split("?")[1]).get("path");
      if (parent === "home" && waiting)
        await new Promise<void>((resolve) => {
          finish = resolve;
        });
      return {
        ...response([]),
        pagination: { total: parent === "" ? 101 : 0 },
      };
    }
  };
  const first = mount("/computer");
  const folder = await screen.findByRole("button", {
    name: "home",
    expanded: false,
  });
  expect(screen.getByText("/data")).toBeVisible();
  expect(finish).toBeUndefined();
  await first.user.click(folder);
  await waitFor(() => expect(finish).toBeTypeOf("function"));
  expect(folder).toHaveAttribute("aria-expanded", "true");
  expect(folder).toHaveAttribute("aria-busy", "true");
  expect(screen.getByLabelText("正在加载 home").closest("button")).toBe(folder);
  expect(screen.getByText("/data/home")).toBeVisible();
  expect(screen.queryByText("正在加载…")).not.toBeInTheDocument();
  expect(screen.queryByText("空目录")).not.toBeInTheDocument();
  waiting = false;
  await act(async () => finish!());
  await screen.findByText("空目录");
  expect(folder).toHaveAttribute("aria-busy", "false");
  await first.user.click(screen.getByRole("button", { name: "下一页" }));
  expect(screen.getByRole("button", { name: "home" })).toBeVisible();
  cleanup();
  mount("/computer");
  await screen.findByRole("button", { name: "home", expanded: false });
  const preparations = mocked.mock.calls.filter(([path]) =>
    path.endsWith("/9/home"),
  );
  expect(preparations).toHaveLength(2);
  expect(preparations[0][1]?.idempotencyKey).not.toBe(
    preparations[1][1]?.idempotencyKey,
  );
});

it("reads the root while a busy computer delays home preparation", async () => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  let busy = true;
  override = async (path) => {
    if (path === "/agents/cloud-computer") return response(computer);
    if (path.endsWith("/9/home") && busy)
      throw new ApiError("CLOUD_COMPUTER_BUSY", "busy", 409);
    if (path.includes("/entries?"))
      return { ...response([]), pagination: { total: 0 } };
  };
  mount("/computer");
  await screen.findByText("电脑忙碌，空闲后自动准备主目录。");
  const listed = mocked.mock.calls.filter(([path]) =>
    path.includes("/entries?"),
  );
  expect(
    listed.map(([path]) => new URLSearchParams(path.split("?")[1]).get("path")),
  ).toEqual([""]);
  busy = false;
  await act(async () => vi.advanceTimersByTimeAsync(3001));
  await screen.findByRole("button", { name: "home" });
});
