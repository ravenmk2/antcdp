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
    await user.click(screen.getByRole("button", { name: "继续" }));
    expect(
      await screen.findByText("请先完成数据库连接检查，再继续。"),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "检查数据库连接" }));
    expect(
      await screen.findByText("数据库连接、版本与空库检查已通过。"),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "继续" }));
    expect(
      await screen.findByRole("heading", { name: "系统信息" }),
    ).toBeInTheDocument();
    expect(
      screen.getByDisplayValue("https://setup.example.com"),
    ).toBeInTheDocument();
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
    await user.click(screen.getByRole("button", { name: "检查数据库连接" }));
    await screen.findByText("数据库连接、版本与空库检查已通过。");
    await user.click(screen.getByRole("button", { name: "继续" }));
    await user.click(await screen.findByRole("button", { name: "继续" }));
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
});
