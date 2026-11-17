import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryRouter, RouterProvider } from "react-router";
import { expect, it, vi } from "vitest";
import { EventsPage } from "@/features/events/page";
import { NavigationGuardProvider } from "@/components/navigation-guard";
import { resetCSRF } from "@/api/client";
import type { Resource } from "@/types/collaboration";
import type { Consumption, Subscription } from "@/features/events/types";

vi.mock("@/components/script-editor", () => ({
  ScriptEditor: ({ value }: { value: string }) => <pre>{value}</pre>,
}));

const subscription: Subscription = {
  id: "2",
  name: "MR 自动审查",
  description: "审查新合并请求",
  enabled: true,
  revision_id: "4",
  version: "5",
  can_manage: false,
  deleted_at: null,
  config: {
    id: "4",
    revision_no: 2,
    event_types: ["gitlab.merge_request.created"],
    executor_user_id: "9",
    timeout_ms: 60000,
    max_retries: 3,
    retry_interval_ms: 30000,
    created_at: "2026-11-17T00:00:00Z",
    script_api_version: 1,
  },
};
const failed: Consumption = {
  id: "7",
  subscription_id: "2",
  revision_id: "3",
  scope_ref_id: "6",
  queue_seq: 1,
  status: "failed",
  attempt_count: 4,
  next_retry_at: null,
  started_at: null,
  finished_at: null,
  created_at: "2026-11-17T00:00:00Z",
  error_code: "SCRIPT_ERROR",
  error_summary: "脚本执行失败",
  retry_of_id: null,
  result: null,
  has_result: false,
  last_log_seq: 1,
};
function response(data: unknown) {
  return new Response(JSON.stringify({ data }));
}
function mount(query: string, manage = false, archived = false) {
  resetCSRF();
  const calls: { url: string; method: string }[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    calls.push({ url, method: init?.method ?? "GET" });
    if (url.endsWith("/auth/csrf")) return response({ csrf_token: "test" });
    if (url.endsWith("/event-types"))
      return response({
        groups: [
          {
            code: "gitlab",
            name: "GitLab",
            types: [
              {
                code: "gitlab.merge_request.created",
                name: "MR 创建",
                description: "",
              },
            ],
          },
        ],
      });
    if (url.endsWith("/event-subscriptions"))
      return response({ items: [{ ...subscription, can_manage: manage }] });
    if (url.endsWith("/retry"))
      return response({
        ...failed,
        id: "8",
        retry_of_id: "7",
        revision_id: "4",
        status: "succeeded",
      });
    if (url.includes("/logs?"))
      return response({
        items: [
          {
            seq: 1,
            attempt_no: 4,
            occurred_at: "2026-11-17T00:00:00Z",
            kind: "script",
            level: "info",
            message: "消费脚本独立日志",
            fields: {},
          },
        ],
      });
    if (url.endsWith("/event-consumptions/7")) return response(failed);
    if (url.endsWith("/event-consumptions/8"))
      return response({
        ...failed,
        id: "8",
        retry_of_id: "7",
        revision_id: "4",
        status: "succeeded",
      });
    if (url.endsWith("/source"))
      return response({
        revision: subscription.config,
        script: "admin-only-script",
      });
    return response({ items: [] });
  });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  const router = createMemoryRouter(
    [
      {
        path: "/events",
        element: (
          <NavigationGuardProvider>
            <EventsPage
              project={
                {
                  id: "1",
                  code: "demo",
                  can_manage: manage,
                  status: archived ? "archived" : "active",
                } as Resource
              }
            />
          </NavigationGuardProvider>
        ),
      },
    ],
    { initialEntries: [`/events?${query}`] },
  );
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { calls, router, user: userEvent.setup() };
}

it("shows members public subscription configuration without requesting script source", async () => {
  const { calls } = mount("tab=subscriptions");
  expect(await screen.findByText("MR 自动审查")).toBeVisible();
  expect(screen.getByText("机器人 #9")).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "新建订阅" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "编辑" }),
  ).not.toBeInTheDocument();
  expect(
    calls.some(({ url }) => /source|revisions|robot-options/.test(url)),
  ).toBe(false);
});

it("opens the manual retry child and keeps its original consumption link", async () => {
  const { user, router, calls } = mount("tab=consumptions&selected=7", true);
  expect(await screen.findByText("消费脚本独立日志")).toBeVisible();
  await user.click(
    await screen.findByRole("button", { name: "使用当前配置人工重试" }),
  );
  expect(
    await screen.findByRole("button", { name: "原消费 #7" }),
  ).toBeVisible();
  expect(router.state.location.search).toContain("selected=8");
  expect(calls.filter(({ method }) => method === "POST")).toEqual([
    { url: "/api/v1/projects/1/event-consumptions/7/retry", method: "POST" },
  ]);
  await user.click(screen.getByRole("button", { name: "原消费 #7" }));
  await waitFor(() =>
    expect(router.state.location.search).toContain("selected=7"),
  );
});

it("keeps archived project history readable while hiding retry actions", async () => {
  mount("tab=consumptions&selected=7", true, true);
  expect(await screen.findByText("消费脚本独立日志")).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "使用当前配置人工重试" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "新建订阅" }),
  ).not.toBeInTheDocument();
});
