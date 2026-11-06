import { beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
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
    await user.type(screen.getByLabelText(/确认密码/), "password123");
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
    await user.type(screen.getByLabelText(/确认密码/), "password123");
    await user.click(screen.getByRole("button", { name: "确认并安装" }));
    await waitFor(() =>
      expect(install).toHaveBeenCalledWith(
        expect.objectContaining({ site: { site_name: "", timezone: "UTC" } }),
      ),
    );
  });
});
