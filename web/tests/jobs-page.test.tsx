import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryRouter, RouterProvider } from "react-router";
import { expect, it, vi } from "vitest";
import { JobsPage } from "@/features/jobs/page";
import { NavigationGuardProvider } from "@/components/navigation-guard";
import { resetCSRF } from "@/api/client";
import type { Job } from "@/features/jobs/types";
import type { Resource } from "@/types/collaboration";

vi.mock("@/app/auth", () => ({
  useAuth: () => ({ settings: { timezone: "Asia/Shanghai" } }),
  useSession: () => ({ user: { id: "1" } }),
}));
vi.mock("@/features/jobs/script-editor", () => ({
  ScriptEditor: ({
    value,
    onChange,
  }: {
    value: string;
    onChange: (value: string) => void;
  }) => (
    <textarea
      aria-label="脚本"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  ),
}));

const job: Job = {
  code: "test_job",
  id: "2",
  name: "示例作业",
  description: "",
  revision_id: "1",
  enabled: true,
  max_concurrency: 1,
  busy_policy: "queue",
  timeout_ms: 30000,
  version: "1",
  can_run: false,
  can_manage: false,
  parameters: [],
  queued_count: 0,
  active_count: 0,
  latest_status: "",
  next_fire_at: null,
};
function response(data: unknown) {
  return new Response(JSON.stringify({ data }));
}
function mount(
  path: string,
  definition = job,
  override?: (url: string, options?: RequestInit) => Response | undefined,
) {
  resetCSRF();
  const writes: { url: string; body: Record<string, unknown> }[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, options) => {
    const url = String(input);
    if (url.endsWith("/auth/csrf")) return response({ csrf_token: "test" });
    if (options?.body)
      writes.push({ url, body: JSON.parse(String(options.body)) });
    const custom = override?.(url, options);
    if (custom) return custom;
    if (url.endsWith("/jobs/2")) return response(definition);
    if (url.endsWith("/schedules"))
      return response({
        items: [
          {
            id: "9",
            name: "每日检查",
            code: "daily",
            schedule_kind: "cron",
            fire_count: 0,
            max_fires: null,
            cron: "0 9 * * *",
            enabled: true,
            next_fire_at: null,
            inputs: {},
          },
        ],
      });
    if (url.includes("/fires"))
      return response({
        items: [
          {
            id: "8",
            scheduled_at: "2026-11-16T09:00:00Z",
            outcome: "accepted",
            reason_code: "",
            run_id: "7",
          },
        ],
      });
    return response({ items: [], total: 0 });
  });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  const project = {
    id: "1",
    can_manage: definition.can_manage,
    status: "active",
  } as Resource;
  const element = (
    <NavigationGuardProvider>
      <JobsPage project={project} />
    </NavigationGuardProvider>
  );
  const router = createMemoryRouter(
    [
      { path: "/projects/1/jobs/:jobId/runs/:runId", element },
      { path: "/projects/1/jobs/:jobId?", element },
    ],
    { initialEntries: [path] },
  );
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { user: userEvent.setup(), writes };
}

it("shows jobs in a table and retains row navigation after resetting filters", async () => {
  const { user } = mount("/projects/1/jobs", job, (url) => {
    const request = new URL(url, window.location.origin);
    if (!request.pathname.endsWith("/jobs")) return undefined;
    return response({ items: request.searchParams.get("q") ? [] : [job] });
  });
  const search = screen.getByRole("textbox", { name: "搜索作业" });
  await screen.findByRole("table", { name: "作业列表" });
  await user.type(search, "不存在");
  expect(await screen.findByText("没有符合筛选条件的作业")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "重置筛选" }));
  const table = within(await screen.findByRole("table", { name: "作业列表" }));
  expect(table.getByRole("link", { name: job.name })).toHaveAttribute(
    "href",
    "/projects/1/jobs/2",
  );
  await user.click(table.getByRole("cell", { name: /并发上限/ }));
  expect(await screen.findByRole("heading", { name: job.name })).toBeVisible();
});

it("lets project members inspect schedule history without management actions", async () => {
  const { user } = mount("/projects/1/jobs/2?tab=schedules");
  expect(
    within(await screen.findByRole("table", { name: "定时计划" })).getByText(
      "每日检查",
    ),
  ).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "添加计划" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "编辑" }),
  ).not.toBeInTheDocument();
  await user.click(screen.getAllByRole("button", { name: "触发记录" }).at(-1)!);
  expect(await screen.findByRole("link", { name: "查看运行" })).toHaveAttribute(
    "href",
    "/projects/1/jobs/2/runs/7",
  );
});

it("saves a script with its selected run account", async () => {
  const definition = {
    ...job,
    can_manage: true,
    config: {
      run_as_user_id: "",
      script: "function main(){}",
      parameters: [],
    },
  };
  const { user, writes } = mount(
    "/projects/1/jobs/2?edit=1",
    definition,
    (url) => {
      if (url.endsWith("/run-account-options"))
        return response({
          items: [
            {
              id: "3",
              name: "发布机器人",
              username: "release",
              account_type: "robot",
            },
          ],
        });
      return undefined;
    },
  );
  await user.click(await screen.findByRole("combobox", { name: "运行账号" }));
  await user.click(
    await screen.findByRole("option", { name: /发布机器人/ }),
  );
  await user.click(screen.getByRole("button", { name: "保存作业" }));
  await waitFor(() => expect(writes).toHaveLength(1));
  expect(writes[0]!.body.config).toEqual({
    run_as_user_id: "3",
    script: "function main(){}",
    parameters: [],
  });
});

it("keeps the run history visible behind the confirmation and starts only when confirmed", async () => {
  const { user, writes } = mount("/projects/1/jobs/2", {
    ...job,
    can_run: true,
  });
  await user.click(await screen.findByRole("button", { name: "运行作业" }));
  const dialog = await screen.findByRole("dialog", { name: "运行作业" });
  expect(within(dialog).getByText(/此作业无需输入参数/)).toBeVisible();
  expect(writes).toHaveLength(0);
  await user.click(within(dialog).getByRole("button", { name: "取消" }));
  expect(await screen.findByText("暂无运行记录")).toBeVisible();
  expect(writes).toHaveLength(0);
});

it("explains draft creation before making a write from the new job editor", async () => {
  const { user, writes } = mount("/projects/1/jobs/new", {
    ...job,
    can_manage: true,
  });
  await user.type(
    await screen.findByRole("textbox", { name: "作业编码" }),
    "verify_job",
  );
  await user.click(screen.getByRole("button", { name: "草稿调试" }));
  const dialog = await screen.findByRole("dialog", {
    name: "创建草稿并调试？",
  });
  expect(within(dialog).getByText(/固定作业编码/)).toBeVisible();
  expect(writes).toHaveLength(0);
});

it("submits valid rerun inputs over HTTP", async ({ onTestFinished }) => {
  vi.stubGlobal("crypto", {
    getRandomValues: crypto.getRandomValues.bind(crypto),
  });
  onTestFinished(() => {
    vi.unstubAllGlobals();
  });
  const definition: Job = {
    ...job,
    can_run: true,
    parameters: [
      {
        name: "env",
        label: "环境",
        type: "select",
        required: true,
        options: ["测试", "正式"],
      },
      {
        name: "regions",
        label: "区域",
        type: "multiselect",
        required: false,
        options: ["华东", "华南"],
      },
    ],
  };
  const { user, writes } = mount(
    "/projects/1/jobs/2/runs/7",
    definition,
    (url, options) => {
      if (url.includes("/runs/7?"))
        return response({
          run: {
            id: "7",
            status: "succeeded",
            trigger_kind: "manual",
            queued_at: "2026-11-16T09:00:00Z",
            inputs: {
              env: "已下线",
              regions: ["华东", "已下线"],
              removed: "旧参数",
            },
            last_log_seq: 0,
          },
          logs: [],
          calls: [],
          can_cancel: false,
        });
      if (url.endsWith("/runs") && options?.method === "POST") {
        return response({
          outcome: "skipped",
          reason_code: "JOB_BUSY",
          run_id: null,
        });
      }
    },
  );
  await user.click(await screen.findByRole("button", { name: "重新运行" }));
  const dialog = within(
    await screen.findByRole("dialog", { name: "重新运行" }),
  );
  expect(dialog.getByText(/失效的参数或选项/)).toBeVisible();
  expect(dialog.getByRole("checkbox", { name: "华东" })).toBeChecked();
  await user.click(dialog.getByRole("button", { name: "确认运行" }));
  expect(dialog.getByText("请选择此参数")).toBeVisible();
  expect(writes).toHaveLength(0);

  await user.click(dialog.getByRole("combobox", { name: "环境" }));
  await user.click(await screen.findByRole("option", { name: "测试" }));
  await user.click(dialog.getByRole("button", { name: "确认运行" }));
  await dialog.findByText("作业并发已满");
  expect(writes[0]?.body).toMatchObject({
    inputs: { env: "测试", regions: ["华东"] },
    rerun_of_run_id: "7",
    request_key: expect.stringMatching(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    ),
  });
  expect(writes[0]?.body.inputs).not.toHaveProperty("removed");
});

it("names the configuration section rejected by the server in the editor feedback", async () => {
  const { user } = mount(
    "/projects/1/jobs/2?edit=1",
    {
      ...job,
      can_manage: true,
      config: {
        run_as_user_id: "1",
        script: "function main(){}",
        parameters: [],
      },
    },
    (_url, options) => {
      if (options?.method !== "PUT") return;
      return new Response(
        JSON.stringify({
          error: {
            code: "VALIDATION_FAILED",
            message: "请检查输入内容",
            details: [{ field: "parameters", code: "invalid_options" }],
          },
        }),
        { status: 422 },
      );
    },
  );
  await user.click(await screen.findByRole("button", { name: "保存作业" }));
  expect(await screen.findByText(/「输入参数」校验失败/)).toBeVisible();
});

it("drains terminal logs and merges call updates without duplicate calls", async () => {
  const reads: string[] = [];
  const { user } = mount("/projects/1/jobs/2/runs/7", job, (url) => {
    if (!url.includes("/runs/7?")) return;
    reads.push(url);
    const last = url.includes("after_seq=1");
    return response({
      run: {
        id: "7",
        status: "succeeded",
        trigger_kind: "manual",
        actor_user_id: "1",
        queued_at: "2026-11-16T09:00:00Z",
        state_mode: "default",
        inputs: {},
        has_result: false,
        last_log_seq: 2,
      },
      can_cancel: false,
      logs: [
        {
          seq: last ? 2 : 1,
          occurred_at: "2026-11-16T09:00:00Z",
          kind: "resource",
          level: last ? "error" : "info",
          message: last ? "最后一条日志" : "发送意图",
          fields: {},
        },
      ],
      calls: [
        {
          id: "9",
          resource_kind: "dingtalk_robot",
          target: "notify",
          operation: "send",
          outcome: last ? "unknown" : "pending",
          resource: {},
          error_code: "",
        },
      ],
    });
  });
  await screen.findByText("最后一条日志");
  expect(screen.getAllByText("#9")).toHaveLength(1);
  expect(screen.getByText("结果未知")).toBeInTheDocument();
  expect(reads).toHaveLength(2);
  await user.click(screen.getByRole("combobox", { name: "日志级别" }));
  await user.click(await screen.findByRole("option", { name: "错误" }));
  expect(screen.queryByText("发送意图")).not.toBeInTheDocument();
  expect(screen.getByText("最后一条日志")).toBeInTheDocument();
  expect(screen.getByText("1 / 2 条 · 已结束")).toBeVisible();
});
