import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ApiError, request } from "@/api/client";
import { NavigationGuardProvider } from "@/components/navigation-guard";
import { TestPanel } from "@/features/web-access/test-panel";
import { ProviderEditor } from "@/features/web-access/editors";
import { WebDiagnosticView } from "@/features/web-access/shared";
import { WebAccessSettings as SettingsPage } from "@/areas/console/pages/web-access/settings";
import type {
  WebAccessProvider,
  WebAccessCatalog,
  WebAccessSettings,
} from "@/types/agent-resources";

vi.mock("@/api/client", async (original) => ({
  ...(await original<typeof import("@/api/client")>()),
  request: vi.fn(),
}));
const mocked = vi.mocked(request);
const provider: WebAccessProvider = {
  id: "3",
  name: "搜索提供商",
  code: "search-3",
  description: "",
  provider_type: "deepseek",
  enabled: true,
  supported_operations: ["search", "fetch"],
  config: { base_url: "https://retrieval.example.test", timeout_seconds: 15 },
  authentication: { auth_method: "api_key", has_secret: true },
  version: "v1",
  created_at: "2026-11-11T00:00:00Z",
  updated_at: "2026-11-11T00:00:00Z",
};
const catalog: WebAccessCatalog = {
  items: [
    {
      provider_type: "deepseek",
      name: "DeepSeek",
      supported_operations: ["search", "fetch"],
      auth_methods: ["api_key"],
      configuration_schema: {
        properties: { base_url: { default: provider.config.base_url } },
      },
    },
  ],
  builtin_readers: [],
};
const diagnostic = {
  kind: "web_access_probe",
  status: "succeeded" as const,
  started_at: provider.created_at,
  finished_at: provider.created_at,
  outdated: false,
  checks: [{ name: "search", status: "succeeded", reason: null }],
};
const response = <T,>(data: T) => ({ data, etag: '"v1"', status: 200 });
function mount(element: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const router = createMemoryRouter([
    {
      path: "/",
      element: <NavigationGuardProvider>{element}</NavigationGuardProvider>,
    },
  ]);
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return userEvent.setup();
}
beforeEach(() => {
  mocked.mockReset();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});
afterEach(() => vi.unstubAllGlobals());

it("returns the synchronous result without operation polling or idempotency keys", async () => {
  mocked.mockImplementation(async (path, options) => {
    if (path.endsWith("/test")) {
      expect(options?.etag).toBe('"v1"');
      expect(options?.idempotencyKey).toBeUndefined();
      expect(options?.body).toEqual({ operation: "search" });
      return response({ operation: "search", diagnostic });
    }
    if (path.endsWith("/providers/3")) return response(provider);
    throw Error(path);
  });
  const user = mount(<TestPanel provider={provider} onClose={() => {}} />);
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "开始测试" })).toBeEnabled(),
  );
  await user.click(screen.getByRole("button", { name: "开始测试" }));
  expect(await screen.findByText("通过")).toBeVisible();
  expect(
    mocked.mock.calls.some(
      ([path]) =>
        path.includes("/operations/") || path.includes("/command-receipts/"),
    ),
  ).toBe(false);
});

it("stops an in-flight test without replaying and explains the unknown remote result", async () => {
  let signal: AbortSignal | undefined;
  mocked.mockImplementation(async (path, options) => {
    if (path.endsWith("/test")) {
      signal = options?.signal;
      return new Promise((_resolve, reject) =>
        signal?.addEventListener(
          "abort",
          () => reject(new DOMException("Aborted", "AbortError")),
          { once: true },
        ),
      );
    }
    return response(provider);
  });
  const user = mount(<TestPanel provider={provider} onClose={() => {}} />);
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "开始测试" })).toBeEnabled(),
  );
  await user.click(screen.getByRole("button", { name: "开始测试" }));
  await user.click(await screen.findByRole("button", { name: "停止测试" }));
  expect(signal?.aborted).toBe(true);
  expect(await screen.findByText(/不能证明远端没有执行/)).toBeVisible();
  expect(
    mocked.mock.calls.filter(([path]) => path.endsWith("/test")),
  ).toHaveLength(1);
});

it("preserves an uncertain create and reads the existing provider before adoption", async () => {
  const saved = vi.fn();
  mocked.mockImplementation(async (path, options) => {
    if (options?.method === "POST") {
      expect(options.idempotencyKey).toBeUndefined();
      throw new ApiError(
        "NETWORK_ERROR",
        "结果未知",
        0,
        [],
        undefined,
        undefined,
        true,
      );
    }
    if (path.includes("/providers?"))
      return { ...response([provider]), pagination: { total: 1 } };
    if (path.endsWith("/providers/3")) return response(provider);
    throw Error(path);
  });
  const user = mount(
    <ProviderEditor catalog={catalog} onClose={() => {}} onSaved={saved} />,
  );
  await user.type(screen.getByLabelText(/^名称/), provider.name);
  await user.type(screen.getByLabelText(/^API Key/), "dummy-not-a-real-secret");
  await user.click(screen.getByRole("button", { name: "创建提供商" }));
  expect(await screen.findByText("需要核对服务器状态")).toBeVisible();
  expect(screen.getByLabelText(/^名称/)).toHaveValue(provider.name);
  await user.click(screen.getByRole("button", { name: "刷新核对" }));
  await user.click(await screen.findByRole("button", { name: "使用已有记录" }));
  expect(saved).toHaveBeenCalledWith(provider);
  expect(
    mocked.mock.calls.filter(([, options]) => options?.method === "POST"),
  ).toHaveLength(1);
});

it("preserves edits on conflict and adopts the latest configuration only on request", async () => {
  const latest = {
    ...provider,
    name: "服务器更新后的提供商",
    description: "最新说明",
    config: { ...provider.config, timeout_seconds: 20 },
  };
  mocked.mockImplementation(async (_path, options) => {
    if (options?.method === "PATCH")
      throw new ApiError("VERSION_CONFLICT", "版本冲突", 412);
    return { ...response(latest), etag: '"v2"' };
  });
  const user = mount(
    <ProviderEditor
      initial={response(provider)}
      catalog={catalog}
      onClose={() => {}}
      onSaved={() => {}}
    />,
  );
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "关闭" })).toHaveFocus(),
  );
  await user.clear(screen.getByLabelText(/^名称/));
  await user.type(screen.getByLabelText(/^名称/), "我的草稿");
  await user.click(screen.getByRole("button", { name: "保存配置" }));
  await user.click(await screen.findByRole("button", { name: "读取最新配置" }));
  expect(screen.getByLabelText(/^名称/)).toHaveValue("我的草稿");
  await user.click(await screen.findByRole("button", { name: "采用最新配置" }));
  expect(screen.getByLabelText(/^名称/)).toHaveValue(latest.name);
  expect(screen.getByLabelText("说明")).toHaveValue(latest.description);
  expect(screen.getByLabelText("超时（秒）")).toHaveValue(20);
  expect(screen.getByRole("button", { name: "保存配置" })).toBeDisabled();
  expect(
    mocked.mock.calls.filter(([, options]) => options?.method === "PATCH"),
  ).toHaveLength(1);
});

it("distinguishes outdated observations and interrupted tests", () => {
  render(
    <WebDiagnosticView
      value={{ ...diagnostic, status: "interrupted", outdated: true }}
    />,
  );
  expect(screen.getByText("结果未确认")).toBeVisible();
  expect(screen.getByText("配置已变化")).toBeVisible();
});

const settings: WebAccessSettings = {
  search: { routes: [], max_results: 5 },
  fetch: {
    routes: [],
    max_bytes: 2097153,
    timeout_seconds: 20,
    max_redirects: 3,
    allowed_internal_hosts: [],
  },
  version: "v1",
};
const unavailable = { available: false, reason: "not_configured", routes: [] };
function mockSettings(
  read: () => WebAccessSettings,
  write?: (
    options: NonNullable<Parameters<typeof request>[1]>,
  ) => ReturnType<typeof response>,
) {
  mocked.mockImplementation(async (path, options) => {
    if (path.endsWith("/state"))
      return response({ search: unavailable, fetch: unavailable });
    if (path.endsWith("/settings")) {
      if (options?.method === "PUT") return write!(options);
      const value = read();
      return { ...response(value), etag: `"${value.version}"` };
    }
    throw Error(path);
  });
}

it("edits one capability in a drawer and preserves exact byte limits", async () => {
  mockSettings(
    () => settings,
    (options) => {
      expect(options.body).toEqual({
        search: settings.search,
        fetch: { ...settings.fetch, timeout_seconds: 25 },
      });
      expect(options.etag).toBe('"v1"');
      return response({
        ...settings,
        fetch: { ...settings.fetch, timeout_seconds: 25 },
      });
    },
  );
  const user = mount(<SettingsPage />);
  expect(
    await screen.findByRole("button", { name: "配置网页读取" }),
  ).toBeVisible();
  expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "配置网页读取" }));
  expect(await screen.findByLabelText("网页内容上限（KiB）")).toHaveValue(
    2097153 / 1024,
  );
  expect(screen.queryByText("高级设置 · 内置读取")).not.toBeInTheDocument();
  await user.clear(screen.getByLabelText("读取总期限（秒）"));
  await user.type(screen.getByLabelText("读取总期限（秒）"), "25");
  await user.click(screen.getByRole("button", { name: "保存配置" }));
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  expect(
    mocked.mock.calls.filter(([, options]) => options?.method === "PUT"),
  ).toHaveLength(1);
});

it("rebases only the active capability after a settings version conflict", async () => {
  let current = settings;
  let writes = 0;
  const otherFetch = {
    ...settings.fetch,
    timeout_seconds: 45,
    max_bytes: 4194304,
  };
  mockSettings(
    () => current,
    (options) => {
      writes++;
      if (writes === 1) {
        current = { ...settings, version: "v2", fetch: otherFetch };
        throw new ApiError("VERSION_CONFLICT", "版本冲突", 412);
      }
      expect(options.etag).toBe('"v2"');
      expect(options.body).toEqual({
        search: { ...settings.search, max_results: 10 },
        fetch: otherFetch,
      });
      return response(current);
    },
  );
  const user = mount(<SettingsPage />);
  await user.click(await screen.findByRole("button", { name: "配置联网搜索" }));
  await user.clear(await screen.findByLabelText("搜索结果数量"));
  await user.type(screen.getByLabelText("搜索结果数量"), "10");
  await user.click(screen.getByRole("button", { name: "保存配置" }));
  await user.click(await screen.findByRole("button", { name: "读取最新配置" }));
  await user.click(
    await screen.findByRole("button", { name: "保留草稿，使用最新版本" }),
  );
  expect(screen.getByLabelText("搜索结果数量")).toHaveValue(10);
  expect(writes).toBe(1);
  await user.click(screen.getByRole("button", { name: "保存配置" }));
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  expect(writes).toBe(2);
});

it("confirms discarding a settings draft and restores focus to its configure button", async () => {
  mockSettings(() => settings);
  const user = mount(<SettingsPage />);
  const trigger = await screen.findByRole("button", { name: "配置网页读取" });
  await user.click(trigger);
  await user.click(
    await screen.findByRole("button", { name: "添加内置 HTTP 读取" }),
  );
  expect(screen.getByText("高级设置 · 内置读取")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "取消" }));
  await user.click(await screen.findByRole("button", { name: "放弃修改" }));
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  await waitFor(() => expect(trigger).toHaveFocus());
  await user.click(trigger);
  expect(
    await screen.findByRole("button", { name: "添加内置 HTTP 读取" }),
  ).toBeEnabled();
  expect(screen.getByRole("button", { name: "保存配置" })).toBeDisabled();
  expect(
    mocked.mock.calls.some(([, options]) => options?.method === "PUT"),
  ).toBe(false);
});
