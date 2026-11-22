import { beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { AppRoot } from "@/app/auth";
import userEvent from "@testing-library/user-event";
import { resetCSRF } from "@/api/client";
import { SetupPage } from "@/features/access/setup-page";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify({ data: body }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
function renderSetup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <SetupPage />
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  resetCSRF();
  vi.restoreAllMocks();
});

describe("installation wizard", () => {
  it.each([true, false])(
    "keeps the successful summary until manual entry (authenticated: %s)",
    async (authenticated) => {
      let installed = false;
      vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
        const path = String(input);
        if (path.endsWith("/setup/status"))
          return json({
            state: installed ? "ready" : "setup_required",
            public_url: "https://setup.example.com",
          });
        if (path.endsWith("/auth/csrf")) return json({ csrf_token: "csrf" });

        if (path.endsWith("/setup/install")) {
          const body = JSON.parse(String(init?.body));
          expect(body.install_password).toBe("install-secret");
          expect(body.founder.email).toBe("founder@example.test");
          expect(body).not.toHaveProperty("database");
          installed = true;
          return json({ authenticated });
        }
        if (path.endsWith("/public/settings"))
          return json({
            site_name: "Example",
            timezone: "Asia/Shanghai",
            registration_enabled: false,
            session_ttl_days: 7,
          });
        if (path.endsWith("/auth/session"))
          return new Response(
            JSON.stringify({
              error: {
                code: "UNAUTHENTICATED",
                message: "请登录",
                details: [],
              },
            }),
            { status: 401, headers: { "Content-Type": "application/json" } },
          );
        throw new Error(`Unexpected ${path}`);
      });
      const client = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      });
      const router = createMemoryRouter(
        [
          {
            element: <AppRoot />,
            children: [
              { path: "/setup", element: <SetupPage /> },
              { path: "/login", element: <h1>登录入口</h1> },
            ],
          },
        ],
        { initialEntries: ["/setup"] },
      );
      render(
        <QueryClientProvider client={client}>
          <RouterProvider router={router} />
        </QueryClientProvider>,
      );
      const user = userEvent.setup();
      await user.type(await screen.findByLabelText("系统名称"), "Example");
      await user.click(screen.getByRole("button", { name: "下一步" }));
      await user.type(screen.getByLabelText(/^安装口令/), "install-secret");
      await user.type(
        screen.getByLabelText(/^创始人邮箱/),
        "founder@example.test",
      );
      await user.type(screen.getByLabelText(/用户名/), "founder");
      await user.type(screen.getByLabelText(/显示名称/), "创始人");
      await user.type(screen.getByLabelText(/^密码/), "password123");
      await user.type(screen.getByLabelText(/^确认密码/), "password123");
      await user.click(screen.getByRole("button", { name: "确认并安装" }));
      await screen.findByRole("heading", { name: "安装完成" });
      expect(screen.getByRole("link", { name: "进入系统" })).toHaveAttribute(
        "href",
        authenticated ? "/home" : "/login",
      );
      for (const value of [
        "Example",
        "https://setup.example.com",
        "Asia/Shanghai",
        "founder",
      ])
        expect(screen.getByText(value)).toBeVisible();
      expect(document.body).not.toHaveTextContent("database-secret");
      expect(document.body).not.toHaveTextContent("password123");
      expect(document.querySelector("input")).toBeNull();
      await act(async () => {
        await client.invalidateQueries({ queryKey: ["setup"] });
      });
      expect(client.getQueryData(["setup"])).toMatchObject({
        data: { state: "ready" },
      });
      vi.useFakeTimers();
      try {
        await act(async () => {
          await vi.advanceTimersByTimeAsync(10000);
        });
      } finally {
        vi.useRealTimers();
      }
      expect(screen.getByRole("heading", { name: "安装完成" })).toBeVisible();
      expect(router.state.location.pathname).toBe("/setup");
      await act(async () => {
        await router.navigate("/login");
      });
      await screen.findByRole("heading", { name: "登录入口" });
      expect(document.title).toBe("Example");
      await act(async () => {
        client.setQueryData(["public-settings"], {
          data: {
            site_name: "",
            timezone: "Asia/Shanghai",
            registration_enabled: false,
            session_ttl_days: 7,
          },
        });
      });
      await waitFor(() => expect(document.title).toBe("ANTCDP"));
      await act(async () => {
        await router.navigate(-1);
      });
      await waitFor(() =>
        expect(router.state.location.pathname).toBe("/login"),
      );
      expect(
        screen.queryByRole("heading", { name: "安装完成" }),
      ).not.toBeInTheDocument();
    },
  );
  it("requires the installation fields and reports an uncertain interrupted result", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const path = String(input);
      if (path.endsWith("/setup/status"))
        return json({
          state: "setup_required",
          public_url: "https://setup.example.com",
        });
      if (path.endsWith("/auth/csrf")) return json({ csrf_token: "csrf" });
      throw new TypeError("connection lost");
    });
    const user = userEvent.setup();
    renderSetup();
    await user.click(await screen.findByRole("button", { name: "下一步" }));
    await user.type(
      await screen.findByLabelText(/^安装口令/),
      "fixture-password",
    );
    await user.type(await screen.findByLabelText(/用户名/), "founder");
    await user.type(screen.getByLabelText(/显示名称/), "创始人");
    await user.type(screen.getByLabelText(/^密码/), "password123");
    await user.type(screen.getByLabelText(/^确认密码/), "password123");
    await user.click(screen.getByRole("button", { name: "确认并安装" }));
    expect(screen.getByText("请输入邮箱")).toBeVisible();
    await user.type(
      screen.getByLabelText(/^创始人邮箱/),
      "founder@example.test",
    );
    await user.click(screen.getByRole("button", { name: "确认并安装" }));
    await waitFor(() =>
      expect(screen.getByText("安装结果未知")).toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: "确认并安装" })).toBeDisabled();
  });

  it("searches timezones, keeps the selection on no match, and preserves it across steps", async () => {
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: vi.fn(),
    });
    const install = vi.fn();
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, options) => {
      const path = String(input);
      if (path.endsWith("/setup/status"))
        return json({ state: "setup_required" });
      if (path.endsWith("/auth/csrf")) return json({ csrf_token: "csrf" });
      if (path.endsWith("/setup/install")) {
        install(JSON.parse(String(options?.body)));
        throw new TypeError("connection lost");
      }
      throw new Error(`Unexpected ${path}`);
    });
    const user = userEvent.setup();
    renderSetup();
    const timezone = screen.getByLabelText(/系统时区/);
    expect(timezone).toHaveTextContent("Asia/Shanghai");
    await user.click(timezone);
    const search = await screen.findByRole("combobox", { name: "搜索时区" });
    await waitFor(() => expect(search).toHaveFocus());
    await user.type(search, "shanghai");
    expect(
      await screen.findByRole("option", { name: "Asia/Shanghai" }),
    ).toBeVisible();
    expect(screen.getAllByRole("option")).toHaveLength(1);
    await user.clear(search);
    await user.type(search, "NoSuchTimeZone");
    expect(await screen.findByText("没有匹配的时区")).toBeVisible();
    expect(screen.queryByRole("option")).not.toBeInTheDocument();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(timezone).toHaveFocus());
    expect(timezone).toHaveTextContent("Asia/Shanghai");
    await user.keyboard("{Enter}");
    const reopened = await screen.findByRole("combobox", { name: "搜索时区" });
    expect(reopened).toHaveValue("");
    await user.type(reopened, "utc");
    expect(await screen.findByRole("option", { name: "UTC" })).toBeVisible();
    await user.keyboard("{ArrowDown}{Enter}");
    await waitFor(() => expect(timezone).toHaveTextContent("UTC"));
    await waitFor(() => expect(timezone).toHaveFocus());
    await user.click(screen.getByRole("button", { name: "下一步" }));
    await user.click(screen.getByRole("button", { name: "上一步" }));
    expect(screen.getByLabelText(/系统时区/)).toHaveTextContent("UTC");
    await user.click(screen.getByRole("button", { name: "下一步" }));
    await user.type(screen.getByLabelText(/^安装口令/), "fixture-password");
    await user.type(
      screen.getByLabelText(/^创始人邮箱/),
      "founder@example.test",
    );
    await user.type(screen.getByLabelText(/用户名/), "founder");
    await user.type(screen.getByLabelText(/显示名称/), "创始人");
    await user.type(screen.getByLabelText(/^密码/), "password123");
    await user.type(screen.getByLabelText(/^确认密码/), "password123");
    await user.click(screen.getByRole("button", { name: "确认并安装" }));
    await waitFor(() =>
      expect(install).toHaveBeenCalledWith(
        expect.objectContaining({ site: { site_name: "", timezone: "UTC" } }),
      ),
    );
  });
});
