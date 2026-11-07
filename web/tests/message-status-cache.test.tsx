import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryRouter, RouterProvider } from "react-router";
import { expect, it, vi } from "vitest";
import { resetCSRF } from "@/api/client";
import { EmailPage } from "@/features/email/email-page";
import { SmsPage } from "@/features/sms/sms-page";
import { DingTalkPage } from "@/features/dingtalk/dingtalk-page";

it.each([
  {
    path: "/admin/email/profiles",
    route: "/admin/email/:section/:id?",
    api: "/admin/email/profiles",
    Page: EmailPage,
    toggle: "停用配置",
  },
  {
    path: "/admin/sms/profiles",
    route: "/admin/sms/:section/:id?",
    api: "/admin/sms/profiles",
    Page: SmsPage,
    toggle: "停用配置",
  },
  {
    path: "/admin/dingtalk",
    route: "/admin/dingtalk/:id?",
    api: "/admin/dingtalk/robots",
    Page: DingTalkPage,
    toggle: "停用机器人",
  },
])(
  "refreshes the cached list after changing status at $path",
  async ({ path, route, api, Page, toggle }) => {
    resetCSRF();
    let profile = {
      id: "1",
      name: "测试配置",
      code: "test",
      enabled: true,
      keyword: "test",
      access_key_id: "test",
      sender_names: [],
      config: {
        host: "smtp.example.test",
        port: 465,
        tls_mode: "implicit",
        from_address: "test@example.test",
      },
    };
    let listReads = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, options) => {
      const url = String(input);
      if (url.endsWith("/auth/csrf"))
        return new Response(JSON.stringify({ data: { csrf_token: "test" } }));
      if (options?.method === "PATCH")
        profile = { ...profile, ...JSON.parse(String(options.body)) };
      if (url.includes(`${api}?`)) {
        listReads++;
        return new Response(
          JSON.stringify({
            data: { items: [profile], total: 1, page: 1, page_size: 20 },
          }),
        );
      }
      return new Response(JSON.stringify({ data: profile }), {
        headers: { ETag: '"v1"' },
      });
    });
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const router = createMemoryRouter([{ path: route, element: <Page /> }], {
      initialEntries: [path],
    });
    render(
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );
    const user = userEvent.setup();
    await user.click(await screen.findByRole("link", { name: "测试配置" }));
    if (api === "/admin/email/profiles") {
      await user.click(
        await screen.findByRole("button", { name: "SMTP 配置的操作" }),
      );
      await user.click(await screen.findByRole("menuitem", { name: toggle }));
      await waitFor(() =>
        expect(
          screen.getByRole("button", { name: "SMTP 配置的操作" }),
        ).toBeEnabled(),
      );
      await user.click(screen.getByRole("button", { name: "SMTP 配置的操作" }));
      await screen.findByRole("menuitem", {
        name: toggle.replace("停用", "启用"),
      });
      await user.keyboard("{Escape}");
    } else {
      await user.click(await screen.findByRole("button", { name: toggle }));
      await screen.findByRole("button", {
        name: toggle.replace("停用", "启用"),
      });
    }
    await act(() => router.navigate(path));
    await waitFor(() =>
      expect(
        within(screen.getByRole("table")).getByText("已停用"),
      ).toBeVisible(),
    );
    expect(listReads).toBe(2);
    client.clear();
  },
);
