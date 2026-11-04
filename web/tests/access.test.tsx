import { expect, it, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Component as Setup } from "@/features/access/SetupPage";
import { api } from "@/lib/api";
import { useQuery } from "@/lib/use-query";
vi.mock("@/lib/api", async (original) => ({
  ...(await original<object>()),
  api: vi.fn(),
}));
vi.mock("@/lib/use-query", () => ({ useQuery: vi.fn() }));
vi.mock("@/app/appearance", () => ({
  useAppearance: () => ({ appearance: "light", setAppearance: vi.fn() }),
}));
beforeEach(() => {
  vi.mocked(api).mockReset();
});
afterEach(cleanup);
it.each(["recovery_required", "unavailable", "initializing"])(
  "shows %s without offering a new installation",
  (state) => {
    vi.mocked(useQuery).mockReturnValue({
      data: { state },
      loading: false,
      error: undefined,
      response: undefined,
      refresh: vi.fn(),
    });
    render(<Setup />);
    expect(screen.queryByRole("button", { name: "开始安装" })).toBeNull();
    expect(screen.queryByRole("heading", { level: 1 })).toBeTruthy();
    expect(api).not.toHaveBeenCalled();
  },
);
it("rechecks a changed database and reads status after an ambiguous installation result", async () => {
  const refresh = vi.fn();
  vi.mocked(useQuery).mockReturnValue({
    data: { state: "setup_required", public_url: "https://example.invalid" },
    loading: false,
    error: undefined,
    response: undefined,
    refresh,
  });
  vi.mocked(api).mockImplementation(async (path) => {
    if (path === "/setup/install") throw Error("connection closed");
    if (path === "/setup/status") return { state: "ready" };
    return {};
  });
  const u = userEvent.setup();
  render(<Setup />);
  await u.click(screen.getByRole("button", { name: "开始安装" }));
  expect(document.activeElement).toBe(
    screen.getByRole("heading", { name: "连接数据库" }),
  );
  await u.type(screen.getByLabelText(/数据库主机/), "mysql");
  await u.click(screen.getByRole("button", { name: "检查连接" }));
  await screen.findByText("数据库连接检查通过");
  await u.type(screen.getByLabelText(/数据库名/), "2");
  expect(screen.queryByText("数据库连接检查通过")).toBeNull();
  await u.click(screen.getByRole("button", { name: "下一步" }));
  await u.click(screen.getByRole("button", { name: "下一步" }));
  await u.type(screen.getByLabelText(/用户名/), "founder");
  await u.type(screen.getByLabelText(/显示名称/), "Founder");
  await u.type(screen.getByLabelText(/^密码/), "correct-password");
  await u.type(screen.getByLabelText(/确认密码/), "correct-password");
  await u.click(screen.getByRole("button", { name: "安装系统" }));
  expect(vi.mocked(api).mock.calls.map((c) => c[0])).toEqual([
    "/setup/database-check",
    "/setup/database-check",
    "/setup/install",
    "/setup/status",
  ]);
  expect(refresh).toHaveBeenCalledOnce();
});
