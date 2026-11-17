import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryRouter, RouterProvider } from "react-router";
import { expect, it, vi } from "vitest";
import { JobsPage } from "@/features/jobs/page";
import { NavigationGuardProvider } from "@/components/navigation-guard";
import { resetCSRF } from "@/api/client";
import type { Job } from "@/features/jobs/types";
import type { Resource } from "@/types/collaboration";

vi.mock("@/app/auth", () => ({ useSession: () => ({ user: { id: "1" } }) }));
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
  name: "示例任务",
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
            cron: "0 9 * * *",
            timezone: "UTC",
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

it("lets project members inspect schedule history without management actions", async () => {
  const { user } = mount("/projects/1/jobs/2?tab=schedules");
  await screen.findByText("每日检查");
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

it("saves a new binding with numeric ID strings alongside the script", async () => {
  const definition = {
    ...job,
    can_manage: true,
    config: { script: "function main(){}", parameters: [], bindings: [] },
    resource_grants: [
      { id: "4", connection_id: "5", credential_id: "6", status: "active" },
    ],
  };
  const { user, writes } = mount("/projects/1/jobs/2?edit=1", definition);
  await user.click(await screen.findByRole("button", { name: "添加绑定" }));
  await user.type(screen.getByRole("textbox", { name: "绑定名称" }), "build");
  await user.click(screen.getByRole("combobox", { name: "服务连接授权" }));
  await user.click(
    await screen.findByRole("option", { name: "授权 #4 · 连接 #5 / 凭证 #6" }),
  );
  await user.click(screen.getByRole("button", { name: "保存任务" }));
  await waitFor(() => expect(writes).toHaveLength(1));
  expect(writes[0]!.body.config).toEqual({
    script: "function main(){}",
    parameters: [],
    bindings: [
      { name: "build", grant_id: "4", connection_id: "5", connection_code: "" },
    ],
  });
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
});
