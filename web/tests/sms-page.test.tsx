import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryRouter, RouterProvider } from "react-router";
import { expect, it, vi } from "vitest";
import { resetCSRF } from "@/api/client";
import { NavigationGuardProvider } from "@/components/navigation-guard";
import { SmsPage } from "@/areas/console/pages/sms-page";
vi.mock("@/app/auth", () => ({
  useAuth: () => ({ settings: { timezone: "Asia/Shanghai" } }),
}));
const profile = {
  id: "1",
  name: "短信账号",
  code: "sms",
  enabled: true,
  version: "1",
  description: "",
  access_key_id: "test-key",
  has_secret: true,
  config: { provider: "aliyun_sms" },
};
const template = {
  id: "2",
  name: "通知模板",
  code: "notice",
  enabled: true,
  version: "1",
  description: "",
  mode: "remote",
  profile_id: "1",
  sign_name: "示例签名",
  remote_template_id: "SMS_123",
  provider_parameters: { code: "code" },
  parameter_schema: { code: { type: "string", required: true } },
  sample_data: { code: "0012" },
  body_template: "",
  engine_id: "",
  engine_version: 0,
  updated_at: "2026-11-07T00:00:00Z",
};
const log = {
  id: "3",
  test_id: "test-3",
  status: "unknown",
  reason_code: "response_unknown",
  profile_name: profile.name,
  template_name: template.name,
  recipient_mask: "138****0000",
  started_at: "2026-11-07T00:00:00Z",
  actor_name: "管理员",
};
function response(data: unknown) {
  return new Response(JSON.stringify({ data }), { headers: { ETag: '"1"' } });
}
function mount(
  path = "/admin/sms/profiles",
  override?: (url: string, options?: RequestInit) => Response | undefined,
) {
  resetCSRF();
  const writes: { url: string; options?: RequestInit }[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, options) => {
    const url = String(input);
    if (url.endsWith("/auth/csrf")) return response({ csrf_token: "test" });
    if (options?.method !== "GET") writes.push({ url, options });
    const custom = override?.(url, options);
    if (custom) return custom;
    if (url.includes("/profiles?"))
      return response({ items: [profile], total: 1, page: 1, page_size: 20 });
    if (url.includes("/templates?"))
      return response({ items: [template], total: 1, page: 1, page_size: 20 });
    if (url.endsWith("/templates/preview"))
      return response({
        sign_name: template.sign_name,
        remote_template_id: template.remote_template_id,
        provider_parameters: { code: "0012" },
      });
    if (url.endsWith("/test") || url.includes("/send-logs/"))
      return response(log);
    if (url.includes("/send-logs?"))
      return response({ items: [log], total: 1, page: 1, page_size: 20 });
    if (url.includes("/templates/")) return response(template);
    return response(profile);
  });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  const router = createMemoryRouter(
    [
      {
        path: "/admin/sms/:section/:id?",
        element: (
          <NavigationGuardProvider>
            <SmsPage />
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
  return { user: userEvent.setup(), router, client, writes };
}
it("unmounts logs on every tab switch and preserves filtered list behind log details", async () => {
  const { user, router } = mount(
    "/admin/sms/send-logs?status=unknown&profile_id=1",
  );
  await screen.findByRole("table", { name: "发送日志" });
  await user.click(screen.getByRole("link", { name: "查看发送记录" }));
  await screen.findByRole("dialog");
  expect(
    screen.getByRole("table", { name: "发送日志", hidden: true }),
  ).toBeInTheDocument();
  await user.click(
    within(screen.getByRole("dialog")).getAllByRole("button", {
      name: "关闭",
    })[0],
  );
  await waitFor(() =>
    expect(router.state.location.pathname).toBe("/admin/sms/send-logs"),
  );
  expect(router.state.location.search).toContain("status=unknown");
  await user.click(screen.getByRole("tab", { name: "短信配置" }));
  await screen.findByRole("table", { name: "短信配置" });
  expect(
    screen.queryByRole("table", { name: "发送日志" }),
  ).not.toBeInTheDocument();
  await user.click(screen.getByRole("tab", { name: "发送日志" }));
  await screen.findByRole("table", { name: "发送日志" });
  await user.click(screen.getByRole("tab", { name: "短信模板" }));
  await screen.findByRole("table", { name: "短信模板" });
  expect(
    screen.queryByRole("table", { name: "发送日志" }),
  ).not.toBeInTheDocument();
});
it("preserves filters when paging profiles", async () => {
  const { user, router } = mount(
    "/admin/sms/profiles?q=sms&status=enabled",
    (url) =>
      url.includes("/profiles?")
        ? response({ items: [profile], total: 45, page: 1, page_size: 20 })
        : undefined,
  );
  await screen.findByRole("table");
  await user.click(screen.getByRole("button", { name: "下一页" }));
  expect(router.state.location.search).toContain("q=sms");
  expect(router.state.location.search).toContain("status=enabled");
  expect(router.state.location.search).toContain("page=2");
});
it("marks edited parameter previews stale and keeps drafts across background refresh", async () => {
  const { user, client } = mount("/admin/sms/templates/2");
  await screen.findByDisplayValue("通知模板");
  await user.click(screen.getByRole("button", { name: "预览映射" }));
  await screen.findByText("0012", { selector: "span" });
  await user.type(screen.getByRole("textbox", { name: "code" }), "3");
  await screen.findByText("内容已修改，请重新预览。");
  await user.type(screen.getByRole("textbox", { name: "模板名称" }), "草稿");
  await act(async () => {
    client.setQueryData(["sms-template", "2"], {
      data: { ...template, name: "服务器更新", version: "2" },
      etag: '"2"',
    });
  });
  expect(screen.getByRole("textbox", { name: "模板名称" })).toHaveValue(
    "通知模板草稿",
  );
});
it("confirms template deletion before issuing a write", async () => {
  const { user, writes } = mount("/admin/sms/templates/2");
  await screen.findByDisplayValue("通知模板");
  await user.click(screen.getByRole("button", { name: "删除模板" }));
  expect(writes.some((w) => w.options?.method === "DELETE")).toBe(false);
  await user.click(
    within(screen.getByRole("dialog")).getByRole("button", { name: "取消" }),
  );
  expect(writes.some((w) => w.options?.method === "DELETE")).toBe(false);
});
it("prefills the current template, preserves leading zeros, and locks unknown sends", async () => {
  const { user, writes } = mount("/admin/sms/templates/2?test=1");
  await screen.findByRole("dialog", { name: "发送真实短信测试" });
  const dialog = screen.getByRole("dialog", { name: "发送真实短信测试" });
  await waitFor(() =>
    expect(within(dialog).getByRole("textbox", { name: "code" })).toHaveValue(
      "0012",
    ),
  );
  await user.type(
    within(dialog).getByRole("textbox", { name: "接收手机号" }),
    "13800000000",
  );
  await user.click(
    within(dialog).getByRole("button", { name: "确认真实发送" }),
  );
  await screen.findByText("请先核实本次发送");
  expect(
    within(dialog).getByRole("button", { name: "确认真实发送" }),
  ).toBeDisabled();
  const sends = writes.filter((w) => w.url.endsWith("/test"));
  expect(sends).toHaveLength(1);
  expect(
    JSON.parse(String(sends[0].options?.body)).template.parameters.code,
  ).toBe("0012");
});
it("closes an unchanged configuration without a discard prompt", async () => {
  const { user } = mount();
  await screen.findByRole("table");
  await user.click(screen.getByRole("button", { name: "新增配置" }));
  await screen.findByRole("dialog");
  await user.click(
    within(screen.getByRole("dialog")).getByRole("button", { name: "取消" }),
  );
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
});
