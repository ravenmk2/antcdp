import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryRouter, RouterProvider } from "react-router";
import { expect, it, vi } from "vitest";
import { resetCSRF } from "@/api/client";
import { NavigationGuardProvider } from "@/components/navigation-guard";
import { EmailPage } from "@/areas/console/pages/email-page";

const profile = {
  id: "1",
  code: "mail",
  name: "通知邮件",
  description: "",
  enabled: true,
  version: "email-profile-1-v1",
  username: "mailer",
  has_secret: true,
  config: {
    host: "smtp.example.test",
    port: 465,
    tls_mode: "implicit_tls",
    from_address: "sender@example.test",
  },
  sender_names: [{ id: "sender1", name: "通知中心", default: true }],
};
const template = {
  id: "2",
  code: "welcome",
  name: "欢迎邮件",
  description: "",
  enabled: true,
  version: "email-template-2-v1",
  engine_id: "go_template",
  engine_version: 1,
  subject_template: "Hello",
  body_format: "html",
  body_template: "<p>Hello</p>",
  text_body_template: "Hello",
  parameter_schema: {},
  sample_data: {},
};
function response(data: unknown, status = 200) {
  return new Response(JSON.stringify({ data }), {
    status,
    headers: { ETag: '"email-profile-1-v1"' },
  });
}
function mount(
  path = "/admin/email/profiles",
  override?: (
    url: string,
    options?: RequestInit,
  ) => Response | undefined | Promise<Response | undefined>,
) {
  resetCSRF();
  const writes: { url: string; options?: RequestInit }[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, options) => {
    const url = String(input);
    if (url.endsWith("/auth/csrf")) return response({ csrf_token: "test" });
    if (options?.method !== "GET") writes.push({ url, options });
    const custom = await override?.(url, options);
    if (custom) return custom;
    if (url.includes("/profiles?"))
      return response({ items: [profile], total: 1, page: 1, page_size: 100 });
    if (url.includes("/templates?"))
      return response({ items: [template], total: 1, page: 1, page_size: 100 });
    if (url.endsWith("/templates/preview"))
      return response({
        subject: "Hello",
        body_format: "html",
        body: "<p>Hello</p>",
      });
    if (url.includes("/templates/")) return response(template);
    return response(profile);
  });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  const router = createMemoryRouter(
    [
      {
        path: "/admin/email/:section/:id?",
        element: (
          <NavigationGuardProvider>
            <EmailPage />
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
  return { user: userEvent.setup(), writes, router, client };
}

it("opens SMTP creation with accessible sender fields and only confirms dirty cancellation", async () => {
  const { user } = mount();
  await user.click(await screen.findByRole("button", { name: "新增 SMTP" }));
  expect(screen.getByRole("textbox", { name: "发件名称 1" })).toHaveValue(
    "AntCDP 通知",
  );
  await user.click(screen.getByRole("button", { name: "取消" }));
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  await user.click(screen.getByRole("button", { name: "新增 SMTP" }));
  await user.type(screen.getByRole("textbox", { name: "配置名称" }), "草稿");
  await user.click(screen.getByRole("button", { name: "取消" }));
  expect(await screen.findByText("放弃未保存的修改？")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "放弃修改" }));
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
});

it("creates SMTP with one request and preserves a default sender", async () => {
  const { user, writes } = mount();
  await user.click(await screen.findByRole("button", { name: "新增 SMTP" }));
  await user.type(
    screen.getByRole("textbox", { name: "配置名称" }),
    "通知邮件",
  );
  await user.type(
    screen.getByRole("textbox", { name: "SMTP 主机" }),
    "smtp.example.test",
  );
  await user.type(
    screen.getByRole("textbox", { name: "认证用户名" }),
    "mailer",
  );
  await user.type(
    screen.getByLabelText("密码 / 授权码", { exact: false, selector: "input" }),
    "fixture-secret",
  );
  await user.type(
    screen.getByRole("textbox", { name: "发件地址" }),
    "sender@example.test",
  );
  await user.click(screen.getByRole("button", { name: "添加名称" }));
  expect(screen.getByRole("button", { name: "删除发件名称 1" })).toBeDisabled();
  await user.type(
    screen.getByRole("textbox", { name: "发件名称 2" }),
    "服务通知",
  );
  await user.click(
    screen.getByRole("radio", { name: "将发件名称 2 设为默认" }),
  );
  await user.click(screen.getByRole("button", { name: "删除发件名称 1" }));
  await user.dblClick(screen.getByRole("button", { name: "保存配置" }));
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  const saves = writes.filter((write) => write.url.endsWith("/profiles"));
  expect(saves).toHaveLength(1);
  expect(JSON.parse(String(saves[0].options?.body)).sender_names).toEqual([
    { id: "", name: "服务通知", default: true },
  ]);
});

it("separates connection editing from credential replacement and focuses invalid fields", async () => {
  const { user, writes } = mount("/admin/email/profiles/1");
  await user.click(
    await screen.findByRole("button", { name: "SMTP 配置的操作" }),
  );
  await user.click(await screen.findByRole("menuitem", { name: "编辑配置" }));
  expect(
    screen.queryByRole("textbox", { name: "认证用户名" }),
  ).not.toBeInTheDocument();
  expect(screen.queryByLabelText("密码 / 授权码")).not.toBeInTheDocument();
  await user.clear(screen.getByRole("textbox", { name: "SMTP 主机" }));
  await user.click(screen.getByRole("button", { name: "保存配置" }));
  expect(await screen.findByText("请输入 SMTP 主机")).toBeVisible();
  await waitFor(() =>
    expect(screen.getByRole("textbox", { name: "SMTP 主机" })).toHaveFocus(),
  );
  expect(writes).toHaveLength(0);
});

it("keeps SMTP search and status when paging and supplies icons for every tab", async () => {
  const { user, router } = mount(
    "/admin/email/profiles?q=notify&status=enabled",
    (url) =>
      url.includes("/profiles?")
        ? response({ items: [profile], total: 41, page: 1, page_size: 20 })
        : undefined,
  );
  await screen.findByRole("link", { name: "通知邮件" });
  for (const tab of screen.getAllByRole("tab"))
    expect(tab.querySelector("svg")).not.toBeNull();
  await user.click(screen.getByRole("button", { name: "下一页" }));
  expect(router.state.location.search).toContain("q=notify");
  expect(router.state.location.search).toContain("status=enabled");
  expect(router.state.location.search).toContain("page=2");
});

it("preselects the current SMTP and prevents resending an uncertain request until reviewed", async () => {
  let sends = 0;
  const { user } = mount("/admin/email/profiles/1?test=1", (url) => {
    if (url.endsWith("/test")) {
      sends++;
      throw new TypeError("connection lost");
    }
    return undefined;
  });
  const dialog = await screen.findByRole("dialog", { name: "发送邮件测试" });
  await waitFor(() =>
    expect(
      within(dialog).getByRole("combobox", { name: "SMTP 配置" }),
    ).toHaveTextContent("通知邮件"),
  );
  await user.type(
    within(dialog).getByRole("textbox", { name: "收件地址" }),
    "test@example.test",
  );
  await user.type(
    within(dialog).getByRole("textbox", { name: "主题" }),
    "test",
  );
  await user.type(
    within(dialog).getByRole("textbox", { name: "正文" }),
    "test",
  );
  await user.click(within(dialog).getByRole("button", { name: "确认发送" }));
  await within(dialog).findByRole("button", { name: "核实发送结果" });
  expect(
    within(dialog).getByRole("button", { name: "确认发送" }),
  ).toBeDisabled();
  expect(sends).toBe(1);
  await user.click(
    within(dialog).getByRole("button", { name: "核实发送结果" }),
  );
  await user.click(
    await within(dialog).findByRole("button", {
      name: "已核对，允许准备下一次发送",
    }),
  );
  expect(
    within(dialog).getByRole("button", { name: "确认发送" }),
  ).toBeEnabled();
  expect(sends).toBe(1);
});

it("loads SMTP choices past the first 100 and removes attachments individually", async () => {
  const { user } = mount("/admin/email/profiles/101?test=1", (url) => {
    if (url.includes("/profiles?")) {
      const second =
        new URL(url, "http://localhost").searchParams.get("page") === "2";
      return response({
        items: second
          ? [{ ...profile, id: "101", name: "最后一项" }]
          : Array.from({ length: 100 }, (_, index) => ({
              ...profile,
              id: String(index + 1),
            })),
        total: 101,
        page: second ? 2 : 1,
        page_size: 100,
      });
    }
    return undefined;
  });
  const dialog = await screen.findByRole("dialog", { name: "发送邮件测试" });
  await waitFor(() =>
    expect(
      within(dialog).getByRole("combobox", { name: "SMTP 配置" }),
    ).toHaveTextContent("最后一项"),
  );
  await user.upload(within(dialog).getByLabelText("附件"), [
    new File(["a"], "a.txt"),
    new File(["b"], "b.txt"),
  ]);
  await user.click(
    within(dialog).getByRole("button", { name: "移除附件 a.txt" }),
  );
  expect(within(dialog).queryByText("a.txt")).not.toBeInTheDocument();
  expect(within(dialog).getByText("b.txt")).toBeVisible();
});

it("marks stale previews, validates JSON locally and confirms template deletion", async () => {
  const { user, writes } = mount("/admin/email/templates/2");
  await user.click(await screen.findByRole("button", { name: "预览草稿" }));
  expect(await screen.findByTitle("邮件 HTML 隔离预览")).toHaveAttribute(
    "sandbox",
    "",
  );
  await user.type(
    screen.getByRole("textbox", { name: "主题模板" }),
    " changed",
  );
  expect(
    screen.getByText("内容已修改，当前为上次预览。请重新预览草稿。"),
  ).toBeVisible();
  await user.click(
    within(screen.getByRole("region", { name: "参数定义" })).getByRole(
      "button",
      { name: "高级 JSON" },
    ),
  );
  await user.clear(
    screen.getByRole("textbox", { name: "参数 Schema（JSON）" }),
  );
  await user.type(
    screen.getByRole("textbox", { name: "参数 Schema（JSON）" }),
    "invalid",
  );
  await user.click(screen.getByRole("button", { name: "保存模板" }));
  expect(await screen.findByText("请输入有效的 JSON 对象")).toBeVisible();
  expect(
    writes.filter((write) => write.options?.method === "PATCH"),
  ).toHaveLength(0);
  await user.click(screen.getByRole("button", { name: "删除模板" }));
  expect(
    await screen.findByRole("dialog", { name: "删除邮件模板？" }),
  ).toBeVisible();
  expect(
    writes.filter((write) => write.options?.method === "DELETE"),
  ).toHaveLength(0);
});

it("preserves dirty template content across navigation until the user confirms", async () => {
  const { user, router } = mount("/admin/email/templates/2");
  await screen.findByRole("textbox", { name: "主题模板" });
  await user.type(screen.getByRole("textbox", { name: "主题模板" }), " draft");
  await act(() => router.navigate("/admin/email/templates"));
  expect(await screen.findByText("离开当前页面？")).toBeVisible();
  expect(router.state.location.pathname).toBe("/admin/email/templates/2");
});

it("keeps a conflict recovery locked when refreshing fails and preserves the SMTP draft", async () => {
  let conflicted = false;
  let reloads = 0;
  const { user, writes } = mount("/admin/email/profiles/1", (url, options) => {
    if (url.endsWith("/profiles/1") && options?.method === "PATCH") {
      conflicted = true;
      return new Response(
        JSON.stringify({
          error: {
            code: "VERSION_CONFLICT",
            message: "资料已更新",
            details: [],
          },
        }),
        { status: 412 },
      );
    }
    if (url.endsWith("/profiles/1") && conflicted) {
      reloads++;
      if (reloads === 1) throw new TypeError("read failed");
      return response({
        ...profile,
        name: "服务器上的名称",
        version: "email-profile-1-v2",
      });
    }
    return undefined;
  });
  await user.click(
    await screen.findByRole("button", { name: "SMTP 配置的操作" }),
  );
  await user.click(await screen.findByRole("menuitem", { name: "编辑配置" }));
  await user.type(screen.getByRole("textbox", { name: "配置名称" }), "草稿");
  await user.click(screen.getByRole("button", { name: "保存配置" }));
  await user.click(await screen.findByRole("button", { name: "读取最新配置" }));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "读取最新配置" })).toBeEnabled(),
  );
  expect(screen.getByRole("button", { name: "保存配置" })).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "读取最新配置" }));
  await screen.findByText("服务器上的名称");
  expect(screen.getByRole("textbox", { name: "配置名称" })).toHaveValue(
    "通知邮件草稿",
  );
  expect(screen.getByRole("button", { name: "保存配置" })).toBeDisabled();
  await user.click(
    screen.getByRole("button", { name: "已核对，继续编辑草稿" }),
  );
  expect(screen.getByRole("button", { name: "保存配置" })).toBeEnabled();
  expect(
    writes.filter((write) => write.options?.method === "PATCH"),
  ).toHaveLength(1);
});

it("keeps template drafts after a background version update and arms protection after a no-op save", async () => {
  const { user, client, router } = mount("/admin/email/templates/2");
  await user.type(
    await screen.findByRole("textbox", { name: "主题模板" }),
    " draft",
  );
  await act(async () => {
    client.setQueryData(["email-template", "2"], {
      data: { ...template, version: "v2", subject_template: "external update" },
      etag: '"v2"',
    });
  });
  expect(screen.getByRole("textbox", { name: "主题模板" })).toHaveValue(
    "Hello draft",
  );
  await user.click(screen.getByRole("button", { name: "保存模板" }));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "保存模板" })).toBeDisabled(),
  );
  await user.type(screen.getByRole("textbox", { name: "主题模板" }), " again");
  await act(() => router.navigate("/admin/email/templates"));
  expect(await screen.findByText("离开当前页面？")).toBeVisible();
});

it("does not treat a failed non-sending preview as an uncertain save", async () => {
  const { user } = mount("/admin/email/templates/new", (url) => {
    if (url.endsWith("/preview")) throw new TypeError("preview unavailable");
    return undefined;
  });
  await user.type(
    await screen.findByRole("textbox", { name: "模板名称" }),
    "draft",
  );
  await user.type(screen.getByRole("textbox", { name: "主题模板" }), "Hello");
  await user.type(screen.getByRole("textbox", { name: "正文模板" }), "Hello");
  await user.click(screen.getByRole("button", { name: "预览草稿" }));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "创建模板" })).toBeEnabled(),
  );
  expect(
    screen.queryByRole("button", { name: "返回列表核实" }),
  ).not.toBeInTheDocument();
});
