import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryRouter, RouterProvider } from "react-router";
import { expect, it, vi } from "vitest";
import { resetCSRF } from "@/api/client";
import { NavigationGuardProvider } from "@/components/navigation-guard";
import { DingTalkPage } from "@/areas/console/pages/dingtalk-page";
const robot = {
  id: "1",
  name: "群机器人",
  code: "robot",
  description: "说明",
  enabled: true,
  has_secret: true,
  version: "v1",
  created_at: "2026-11-07T00:00:00Z",
  updated_at: "2026-11-07T00:00:00Z",
  latest: null,
};
function mount(path = "/admin/dingtalk") {
  resetCSRF();
  const writes: unknown[] = [];
  let reads = 0;
  const response = (data: unknown) =>
    new Response(JSON.stringify({ data }), { headers: { ETag: '"v1"' } });
  const result = {
    test_id: "test-1",
    status: "accepted",
    stage: "submit",
    reason_code: "provider_accepted",
    started_at: robot.created_at,
    outdated: false,
  };
  let tested = false;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, options) => {
    const url = String(input);
    if (url.endsWith("/auth/csrf")) return response({ csrf_token: "test" });
    if (options?.method === "POST") {
      writes.push(JSON.parse(String(options.body)));
      tested = true;
      return response(result);
    }
    if (url.includes("robots?"))
      return response({ items: [robot], total: 1, page: 1, page_size: 20 });
    reads++;
    return response({ ...robot, latest: tested ? result : null });
  });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const router = createMemoryRouter(
    [
      {
        path: "/admin/dingtalk/:id?",
        element: (
          <NavigationGuardProvider>
            <DingTalkPage />
          </NavigationGuardProvider>
        ),
      },
    ],
    { initialEntries: [path] },
  );
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { writes, reads: () => reads };
}
it("focuses missing authentication and protects a new robot draft", async () => {
  mount();
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "新建机器人" }));
  const dialog = screen.getByRole("dialog");
  expect(within(dialog).queryByLabelText(/关键词/)).toBeNull();
  await user.type(
    within(dialog).getByRole("textbox", { name: /名称/ }),
    "新机器人",
  );
  await user.click(within(dialog).getByRole("button", { name: "保存" }));
  await waitFor(() =>
    expect(
      within(dialog).getByLabelText(/^Access Token/, { selector: "input" }),
    ).toHaveFocus(),
  );
  await user.click(within(dialog).getByRole("button", { name: "取消" }));
  expect(
    await screen.findByRole("dialog", { name: "放弃未保存的修改？" }),
  ).toBeVisible();
});
it("sends the exact body and refreshes the detail result", async () => {
  const state = mount("/admin/dingtalk/1");
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "发送测试" }));
  const dialog = screen.getByRole("dialog");
  await user.type(
    within(dialog).getByRole("textbox", { name: /正文/ }),
    "原样正文",
  );
  await user.click(within(dialog).getByRole("button", { name: "确认发送" }));
  await waitFor(() =>
    expect(state.writes).toEqual([
      { format: "text", title: "", body: "原样正文" },
    ]),
  );
  await waitFor(() => expect(state.reads()).toBeGreaterThan(1));
  await user.click(
    within(dialog).getAllByRole("button", { name: "关闭" }).at(-1)!,
  );
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(screen.getByText("已受理")).toBeVisible();
});
