import { OperationToastProvider } from "@/components/platform/operation-toast";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { SettingsForm, type Settings } from "@/features/admin/SettingsPage";
import { PasswordDialog, Profile } from "@/features/account/AccountPage";
import { AuditResults } from "@/features/admin/AuditPage";
import { IdentityContext, type Identity } from "@/app/identity";
import { ApiError, request } from "@/lib/api";
vi.mock("@/lib/api", async (original) => ({
  ...(await original<object>()),
  request: vi.fn(),
}));
const mocked = vi.mocked(request);
const settings: Settings = {
  site_name: "AntCDP",
  timezone: "Asia/Shanghai",
  registration_enabled: false,
  session_ttl_days: 30,
  version: "1",
  deployment: { public_url: "https://example.invalid" },
};
const identity: Identity = {
  settings,
  session: {
    require_password_change: false,
    session_ttl_days: 30,
    expires_at: "2026-12-01T00:00:00Z",
    user: {
      id: "7",
      username: "alice",
      display_name: "Alice",
      version: "3",
      role: "admin",
      is_founder: false,
      status: "active",
      avatar: null,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
      last_login_at: null,
    },
  },
};
beforeEach(() => {
  mocked.mockReset();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function settingsForm(tab = "general") {
  const saved = vi.fn(),
    reload = vi.fn();
  render(
    <SettingsForm
      initial={settings}
      etag={'"s1"'}
      tab={tab}
      onSaved={saved}
      onReload={reload}
    />,
  );
  return { user: userEvent.setup(), saved, reload };
}
it.each([
  ["新的系统", "新的系统"],
  ["   ", ""],
])(
  "saves the system name %j with the original version",
  async (input, expected) => {
    mocked.mockResolvedValue({ data: settings, etag: '"s2"' });
    const { user, saved } = settingsForm();
    await user.clear(screen.getByLabelText("系统名称", { exact: false }));
    await user.type(screen.getByLabelText("系统名称", { exact: false }), input);
    await user.click(screen.getByRole("button", { name: "保存当前分类" }));
    await waitFor(() => expect(saved).toHaveBeenCalledOnce());
    expect(mocked).toHaveBeenCalledWith("/admin/settings", {
      method: "PATCH",
      etag: '"s1"',
      body: { site_name: expected, timezone: "Asia/Shanghai" },
    });
  },
);
it("saves access settings without overwriting site fields", async () => {
  mocked.mockResolvedValue({ data: settings, etag: '"s2"' });
  const { user } = settingsForm("access");
  await user.click(screen.getByRole("switch", { name: "允许用户自主注册" }));
  await user.selectOptions(screen.getByLabelText("会话闲置有效期"), "7");
  await user.click(screen.getByRole("button", { name: "保存当前分类" }));
  await waitFor(() => expect(mocked).toHaveBeenCalledOnce());
  expect(mocked.mock.calls[0]?.[1]?.body).toEqual({
    registration_enabled: true,
    session_ttl_days: 7,
  });
});
it("preserves a conflicting settings draft and requires explicit discard before reload", async () => {
  mocked.mockRejectedValue(new ApiError("VERSION_CONFLICT", "版本冲突"));
  const { user, reload } = settingsForm();
  await user.type(screen.getByLabelText("系统名称", { exact: false }), " 草稿");
  await user.click(screen.getByRole("button", { name: "保存当前分类" }));
  await screen.findByText("版本冲突");
  expect(
    (screen.getByRole("button", { name: "保存当前分类" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  expect(screen.getByDisplayValue("AntCDP 草稿")).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "重新读取最新配置" }));
  expect(reload).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "放弃草稿并重新读取" }));
  expect(reload).toHaveBeenCalledOnce();
});
it("validates password confirmation before writing and focuses a server password error", async () => {
  mocked.mockRejectedValue(
    new ApiError("CURRENT_PASSWORD_INVALID", "当前密码不正确"),
  );
  render(<PasswordDialog onClose={vi.fn()} />);
  const user = userEvent.setup();
  await user.type(
    screen.getByLabelText("当前密码", { exact: false }),
    "Wrong-password",
  );
  await user.type(
    screen.getByLabelText(/^新密码/, { selector: "input" }),
    "New-password",
  );
  await user.click(screen.getByRole("button", { name: "更新密码" }));
  expect(mocked).not.toHaveBeenCalled();
  await user.type(
    screen.getByLabelText("确认新密码", { exact: false }),
    "New-password",
  );
  await user.click(screen.getByRole("button", { name: "更新密码" }));
  await screen.findByText("当前密码不正确");
  expect(document.activeElement).toBe(
    screen.getByLabelText("当前密码", { exact: false }),
  );
  expect(mocked.mock.calls[0]?.[1]?.body).toEqual({
    current_password: "Wrong-password",
    new_password: "New-password",
  });
});
it("blocks repeated unknown password writes while retaining the draft", async () => {
  mocked.mockRejectedValue(new ApiError("NETWORK_ERROR", "网络中断"));
  render(<PasswordDialog onClose={vi.fn()} />);
  const user = userEvent.setup();
  const inputs = screen.getAllByLabelText(/密码/, { selector: "input" });
  for (const input of inputs) await user.type(input, "Password-2026");
  await user.click(screen.getByRole("button", { name: "更新密码" }));
  await screen.findByText("网络中断");
  await user.click(screen.getByRole("button", { name: "更新密码" }));
  expect(mocked).toHaveBeenCalledOnce();
  expect(
    inputs.every(
      (input) => (input as HTMLInputElement).value === "Password-2026",
    ),
  ).toBe(true);
});
it("updates the account using its version without changing username or role", async () => {
  mocked.mockResolvedValue({
    data: {
      ...identity.session.user,
      display_name: "Alice 更新",
      version: "4",
    },
    etag: '"u-7-v4"',
  });
  const router = createMemoryRouter([
    {
      path: "/",
      element: (
        <OperationToastProvider>
          <Profile initial={identity.session.user} />
        </OperationToastProvider>
      ),
    },
  ]);
  render(<RouterProvider router={router} />);
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("显示名称", { exact: false }), " 更新");
  await user.click(screen.getByRole("button", { name: "保存资料" }));
  await screen.findByText("个人资料已保存。");
  expect(mocked).toHaveBeenCalledWith("/account", {
    method: "PATCH",
    etag: '"u-7-v3"',
    body: { display_name: "Alice 更新" },
  });
});
it("uses server cursors for audit navigation and returns to the first cursor", async () => {
  mocked.mockImplementation(
    async (path) =>
      ({
        data: [
          {
            id: path.includes("cursor=") ? "2" : "1",
            action: "user.created",
            actor: { display_name: "Alice" },
            target: { label: "账号" },
            occurred_at: "2026-01-01T00:00:00Z",
          },
        ],
        etag: "",
        pagination: {
          next_cursor: path.includes("cursor=") ? null : "opaque+/=",
        },
      }) as never,
  );
  render(
    <IdentityContext value={identity}>
      <AuditResults
        filters="limit=10&q=%E7%94%A8%E6%88%B7"
        size={10}
        onSize={vi.fn()}
      />
    </IdentityContext>,
  );
  const user = userEvent.setup();
  await screen.findByText("创建用户");
  await user.click(screen.getByRole("button", { name: "下一页" }));
  await waitFor(() => expect(mocked).toHaveBeenCalledTimes(2));
  expect(
    new URL(
      mocked.mock.calls[1]![0],
      "https://example.invalid",
    ).searchParams.get("cursor"),
  ).toBe("opaque+/=");
  await screen.findByText("创建用户");
  await user.click(screen.getByRole("button", { name: "上一页" }));
  await waitFor(() => expect(mocked).toHaveBeenCalledTimes(3));
  expect(mocked.mock.calls[2]![0]).not.toContain("cursor=");
});
it("does not display a late audit page after filters replace the list", async () => {
  let resolve!: (r: unknown) => void;
  mocked.mockImplementation((path) =>
    path.includes("q=old")
      ? (new Promise((r) => {
          resolve = r;
        }) as never)
      : (Promise.resolve({ data: [], etag: "" }) as never),
  );
  const view = render(
    <IdentityContext value={identity}>
      <AuditResults key="old" filters="q=old" size={10} onSize={vi.fn()} />
    </IdentityContext>,
  );
  view.rerender(
    <IdentityContext value={identity}>
      <AuditResults key="new" filters="q=new" size={10} onSize={vi.fn()} />
    </IdentityContext>,
  );
  await screen.findByText("当前筛选下没有审计记录，请调整筛选条件。");
  await act(async () =>
    resolve({ data: [{ id: "old", action: "user.created" }], etag: "" }),
  );
  expect(screen.queryByText("创建用户")).toBeNull();
});
