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
      vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
        const path = String(input);
        if (path.endsWith("/setup/status"))
          return json({
            state: installed ? "ready" : "setup_required",
            public_url: "https://setup.example.com",
          });
        if (path.endsWith("/auth/csrf")) return json({ csrf_token: "csrf" });
        if (path.endsWith("/setup/database-check"))
          return json({
            reachable: true,
            compatible: true,
            empty_schema: true,
          });
        if (path.endsWith("/setup/install")) {
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
      await user.type(
        await screen.findByLabelText(/数据库主机/),
        "mysql.internal",
      );
      await user.type(screen.getByLabelText("数据库密码"), "database-secret");
      await user.click(screen.getByRole("button", { name: "检查连接" }));
      await screen.findByText("数据库连接、版本与空库检查已通过。");
      await user.click(screen.getByRole("button", { name: "下一步" }));
      await user.type(screen.getByLabelText("系统名称"), "Example");
      await user.click(screen.getByRole("button", { name: "下一步" }));
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
        "antcdp",
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
  it("shows the actual failure, clears it on retry, and invalidates a successful check when edited", async () => {
    let checks = 0;
    let finish: (() => void) | undefined;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const path = String(input);
      if (path.endsWith("/setup/status"))
        return json({ state: "setup_required" });
      if (path.endsWith("/auth/csrf")) return json({ csrf_token: "csrf" });
      if (path.endsWith("/setup/database-check")) {
        checks++;
        if (checks === 1)
          return new Response(
            JSON.stringify({
              error: {
                code: "DATABASE_UNAVAILABLE",
                message: "数据库连接失败，请检查连接参数",
                details: [],
              },
              request_id: "check-1",
            }),
            { status: 422, headers: { "Content-Type": "application/json" } },
          );
        await new Promise<void>((resolve) => {
          finish = resolve;
        });
        return json({ reachable: true, compatible: true, empty_schema: true });
      }
      throw new Error(`Unexpected ${path}`);
    });
    const user = userEvent.setup();
    renderSetup();
    const host = await screen.findByLabelText(/数据库主机/);
    await user.type(host, "mysql.internal");
    const check = screen.getByRole("button", { name: "检查连接" });
    await user.click(check);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "数据库连接失败，请检查连接参数（请求编号：check-1）",
    );
    await user.click(check);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(check).toBeDisabled();
    expect(screen.getByRole("textbox", { name: /端口/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: "增加端口" })).toBeDisabled();
    expect(screen.getByRole("combobox", { name: /传输加密/ })).toBeDisabled();
    await user.click(check);
    expect(checks).toBe(2);
    finish?.();
    await screen.findByText("数据库连接、版本与空库检查已通过。");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    await user.type(host, ".changed");
    expect(
      screen.queryByText("数据库连接、版本与空库检查已通过。"),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "下一步" }));
    expect(
      await screen.findByText("请先完成数据库连接检查，再继续。"),
    ).toBeInTheDocument();
  });

  it("keeps Base UI port controls bounded and supports keyboard stepping without submitting", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      json({ state: "setup_required" }),
    );
    const user = userEvent.setup();
    renderSetup();
    const port = screen.getByRole("textbox", { name: /端口/ });
    await user.click(screen.getByRole("button", { name: "增加端口" }));
    expect(port).toHaveValue("3307");
    expect(port).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "减少端口" }));
    expect(port).toHaveValue("3306");
    await user.keyboard("{ArrowUp}");
    expect(port).toHaveValue("3307");
    await user.keyboard("{Alt>}{ArrowUp}{/Alt}");
    expect(port).toHaveValue("3308");
    await user.clear(port);
    await user.type(port, "65535");
    expect(screen.getByRole("button", { name: "增加端口" })).toBeDisabled();
    await user.clear(port);
    await user.type(port, "1");
    expect(screen.getByRole("button", { name: "减少端口" })).toBeDisabled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    await user.type(screen.getByLabelText(/数据库主机/), "mysql.internal");
    await user.clear(port);
    await user.type(port, "65536");
    await user.click(screen.getByRole("button", { name: "检查连接" }));
    expect(await screen.findByText("端口范围为 1–65535")).toBeInTheDocument();
    await waitFor(() => expect(port).toHaveFocus());
    await user.clear(port);
    expect(screen.queryByText("端口范围为 1–65535")).not.toBeInTheDocument();
  });

  it("supports selecting encryption with the keyboard and restores trigger focus", async () => {
    // jsdom has no layout or scrolling implementation; Radix focuses real options.
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: vi.fn(),
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      json({ state: "setup_required" }),
    );
    const user = userEvent.setup();
    renderSetup();
    const select = screen.getByRole("combobox", { name: /传输加密/ });
    select.focus();
    await user.keyboard("{ArrowDown}");
    expect(await screen.findByRole("listbox")).toBeVisible();
    await user.keyboard("{End}{Enter}");
    await waitFor(() => expect(select).toHaveTextContent("验证服务器身份"));
    expect(select).toHaveFocus();
    await user.keyboard("{ArrowDown}{Escape}");
    await waitFor(() =>
      expect(screen.queryByRole("listbox")).not.toBeInTheDocument(),
    );
    expect(select).toHaveFocus();
  });

  it("blocks progress before a successful database check and preserves drafts on return", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const path = String(input);
      if (path.endsWith("/setup/status"))
        return json({
          state: "setup_required",
          public_url: "https://setup.example.com",
        });
      if (path.endsWith("/auth/csrf")) return json({ csrf_token: "csrf" });
      if (path.endsWith("/setup/database-check"))
        return json({ reachable: true, compatible: true, empty_schema: true });
      throw new Error(`Unexpected ${path}`);
    });
    const user = userEvent.setup();
    renderSetup();
    const host = await screen.findByLabelText(/数据库主机/);
    await user.type(host, "mysql.internal");
    await user.click(screen.getByRole("button", { name: "下一步" }));
    expect(
      await screen.findByText("请先完成数据库连接检查，再继续。"),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "检查连接" }));
    expect(
      await screen.findByText("数据库连接、版本与空库检查已通过。"),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "下一步" }));
    expect(
      await screen.findByRole("heading", { name: "系统信息" }),
    ).toBeInTheDocument();
    expect(
      screen.getByDisplayValue("https://setup.example.com"),
    ).toBeInTheDocument();
    const siteName = screen.getByLabelText("系统名称");
    await user.type(siteName, "a".repeat(41));
    await user.click(screen.getByRole("button", { name: "下一步" }));
    expect(
      await screen.findByText("系统名称最多 40 个字符"),
    ).toBeInTheDocument();
    await waitFor(() => expect(siteName).toHaveFocus());
    await user.clear(siteName);
    expect(
      screen.queryByText("系统名称最多 40 个字符"),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "上一步" }));
    expect(screen.getByLabelText(/数据库主机/)).toHaveValue("mysql.internal");
  });

  it("requires the installation fields and reports an uncertain interrupted result", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const path = String(input);
      if (path.endsWith("/setup/status"))
        return json({
          state: "setup_required",
          public_url: "https://setup.example.com",
        });
      if (path.endsWith("/auth/csrf")) return json({ csrf_token: "csrf" });
      if (path.endsWith("/setup/database-check"))
        return json({ reachable: true, compatible: true, empty_schema: true });
      throw new TypeError("connection lost");
    });
    const user = userEvent.setup();
    renderSetup();
    await user.type(
      await screen.findByLabelText(/数据库主机/),
      "mysql.internal",
    );
    await user.click(screen.getByRole("button", { name: "检查连接" }));
    await screen.findByText("数据库连接、版本与空库检查已通过。");
    await user.click(screen.getByRole("button", { name: "下一步" }));
    await user.click(await screen.findByRole("button", { name: "下一步" }));
    await user.type(await screen.findByLabelText(/用户名/), "founder");
    await user.type(screen.getByLabelText(/显示名称/), "创始人");
    await user.type(screen.getByLabelText(/^密码/), "password123");
    await user.type(screen.getByLabelText(/^确认密码/), "password123");
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
      if (path.endsWith("/setup/database-check"))
        return json({ reachable: true, compatible: true, empty_schema: true });
      if (path.endsWith("/setup/install")) {
        install(JSON.parse(String(options?.body)));
        throw new TypeError("connection lost");
      }
      throw new Error(`Unexpected ${path}`);
    });
    const user = userEvent.setup();
    renderSetup();
    await user.type(
      await screen.findByLabelText(/数据库主机/),
      "mysql.internal",
    );
    await user.click(screen.getByRole("button", { name: "检查连接" }));
    await screen.findByText("数据库连接、版本与空库检查已通过。");
    await user.click(screen.getByRole("button", { name: "下一步" }));
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
