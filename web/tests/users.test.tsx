import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { IdentityContext, type Identity, type User } from "@/app/identity";
import { UserEditor, type EditTarget } from "@/features/users/UserEditor";
import { ApiError, request } from "@/lib/api";
import { readIdentity } from "@/app/identity";
import { loader } from "@/features/users/UsersPage";
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  request: vi.fn(),
}));
vi.mock("@/app/identity", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  readIdentity: vi.fn(),
}));
const founder: User = {
  id: "1",
  username: "founder",
  display_name: "创始人",
  role: "admin",
  is_founder: true,
  status: "active",
  version: "1",
  avatar: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  last_login_at: null,
};
const member: User = {
  ...founder,
  id: "2",
  username: "member",
  display_name: "成员",
  role: "user",
  is_founder: false,
};
const identity: Identity = {
  session: {
    user: founder,
    require_password_change: false,
    expires_at: "2026-12-01T00:00:00Z",
    session_ttl_days: 30,
  },
  settings: {
    site_name: "AntCDP",
    timezone: "Asia/Shanghai",
    registration_enabled: false,
    session_ttl_days: 30,
  },
};
const mocked = vi.mocked(request);
beforeEach(() => {
  mocked.mockReset();
  vi.mocked(readIdentity).mockResolvedValue({ setup: "ready", identity });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
function editor(target: EditTarget, viewer = identity) {
  const saved = vi.fn(),
    close = vi.fn();
  render(
    <IdentityContext value={viewer}>
      <UserEditor target={target} onSaved={saved} onClose={close} />
    </IdentityContext>,
  );
  return { user: userEvent.setup(), saved, close };
}
it("blocks an ordinary user before requesting management data", async () => {
  vi.mocked(readIdentity).mockResolvedValue({
    setup: "ready",
    identity: { ...identity, session: { ...identity.session, user: member } },
  });
  await expect(
    loader({ request: new Request("https://test/admin/users") }),
  ).rejects.toMatchObject({ status: 403 });
  expect(mocked).not.toHaveBeenCalled();
});
it("loads server counts and preserves URL pagination and identity filters", async () => {
  mocked.mockImplementation(
    async (path) =>
      ({
        data: path.startsWith("/admin/users")
          ? [member]
          : { users_total: 12, users_active: 10, users_disabled: 2 },
        etag: "",
        pagination: { total: 7 },
      }) as never,
  );
  const data = await loader({
    request: new Request(
      "https://test/admin/users?q=%E6%88%90%E5%91%98&page=2&page_size=10&identity=user&status=active",
    ),
  });
  expect(data.total).toBe(7);
  expect(data.counts?.users_total).toBe(12);
  expect(mocked.mock.calls[0]![0]).toContain("page=2&page_size=10");
  expect(mocked.mock.calls[0]![0]).toContain("identity=user");
});
it("creates only after field validation, and focuses the first invalid field", async () => {
  mocked.mockResolvedValue({ data: member, etag: '"2"' });
  const { user, saved } = editor({ mode: "create" });
  await user.click(screen.getByRole("button", { name: "创建用户" }));
  expect(mocked).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(
    screen.getByLabelText("显示名称", { exact: false }),
  );
  await user.type(
    screen.getByLabelText("显示名称", { exact: false }),
    "新成员",
  );
  await user.type(
    screen.getByLabelText("用户名", { exact: false }),
    "new_member",
  );
  // Password and confirmation are distinct accessible fields.
  const inputs = document.querySelectorAll<HTMLInputElement>(
    'input[type="password"]',
  );
  await user.clear(inputs[0]!);
  await user.type(inputs[0]!, "abcdefgh");
  await user.type(inputs[1]!, "abcdefgh");
  await user.click(screen.getByRole("button", { name: "创建用户" }));
  expect(mocked).toHaveBeenCalledWith("/admin/users", {
    method: "POST",
    body: {
      username: "new_member",
      display_name: "新成员",
      role: "user",
      password: "abcdefgh",
    },
  });
  expect(saved).toHaveBeenCalledOnce();
});
it("sends the fetched ETag and preserves draft on a version conflict", async () => {
  mocked.mockRejectedValue(new ApiError("VERSION_CONFLICT", "资料已被更新"));
  const { user, saved } = editor({
    mode: "edit",
    user: member,
    etag: '"user-2-v1"',
  });
  await user.clear(screen.getByLabelText("显示名称", { exact: false }));
  await user.type(
    screen.getByLabelText("显示名称", { exact: false }),
    "保留草稿",
  );
  await user.click(screen.getByRole("button", { name: "编辑用户" }));
  await screen.findByText(/草稿已保留/);
  expect(
    (screen.getByLabelText("显示名称", { exact: false }) as HTMLInputElement)
      .value,
  ).toBe("保留草稿");
  expect(mocked.mock.calls[0]![1]?.etag).toBe('"user-2-v1"');
  expect(saved).not.toHaveBeenCalled();
  expect(
    (screen.getByRole("button", { name: "编辑用户" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
});
it("requires the exact current username before deleting", async () => {
  mocked.mockResolvedValue({ data: undefined, etag: "" });
  const { user } = editor({ mode: "delete", user: member, etag: '"v1"' });
  await user.click(screen.getByRole("button", { name: "删除用户" }));
  expect(mocked).not.toHaveBeenCalled();
  await user.type(screen.getByLabelText(/输入用户名/), "member");
  await user.click(screen.getByRole("button", { name: "删除用户" }));
  expect(mocked).toHaveBeenCalledWith("/admin/users/2", {
    method: "DELETE",
    etag: '"v1"',
    headers: { "X-Confirm-Username": "member" },
  });
});
it.each([founder, { ...member, id: "1" }])(
  "prevents destructive changes to founder and self",
  async (user) => {
    editor({ mode: "status", user, etag: '"v1"' });
    expect(
      (screen.getByRole("button", { name: "禁用用户" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(mocked).not.toHaveBeenCalled();
  },
);
it("does not repeat a pending or unknown write", async () => {
  let reject!: (error: unknown) => void;
  mocked.mockReturnValue(
    new Promise((_, r) => {
      reject = r;
    }),
  );
  const { user, close } = editor({
    mode: "status",
    user: member,
    etag: '"v1"',
  });
  await user.dblClick(screen.getByRole("button", { name: "禁用用户" }));
  expect(mocked).toHaveBeenCalledOnce();
  await user.keyboard("{Escape}");
  expect(close).not.toHaveBeenCalled();
  reject(new ApiError("NETWORK_ERROR", "网络中断"));
  await screen.findByText(/请求结果尚未确认/);
  await user.click(screen.getByRole("button", { name: "禁用用户" }));
  expect(mocked).toHaveBeenCalledOnce();
});
it("associates server username errors with the field", async () => {
  mocked.mockRejectedValue(new ApiError("USERNAME_TAKEN", "用户名已存在"));
  const { user } = editor({ mode: "edit", user: member, etag: '"v1"' });
  await user.click(screen.getByRole("button", { name: "编辑用户" }));
  await screen.findByText("用户名已存在");
  await waitFor(() =>
    expect(document.activeElement).toBe(
      screen.getByLabelText("用户名", { exact: false }),
    ),
  );
});
