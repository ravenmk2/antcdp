import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import { expect, it, vi } from "vitest";
import { UsersPage } from "@/features/admin/users-page";

vi.mock("@/app/auth", () => ({
  useSession: () => ({ user: { id: "2", role: "admin" } }),
}));

it("keeps founder/self restrictions and restores the row trigger after asynchronous user loading", async () => {
  const users = [
    {
      id: "1",
      username: "founder",
      display_name: "创始账号",
      role: "admin",
      is_founder: true,
      status: "active",
      version: 1,
    },
    {
      id: "2",
      username: "self",
      display_name: "本人账号",
      role: "admin",
      is_founder: false,
      status: "active",
      version: 1,
    },
    {
      id: "3",
      username: "member",
      display_name: "成员账号",
      role: "user",
      is_founder: false,
      status: "active",
      version: 1,
    },
  ];
  let resolveDetail!: (response: Response) => void;
  const detail = new Promise<Response>((resolve) => {
    resolveDetail = resolve;
  });
  const fetch = vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/admin/users/3")) return detail;
      if (url.includes("/admin/overview"))
        return new Response(
          JSON.stringify({
            data: { users_total: 3, users_active: 3, users_disabled: 0 },
          }),
        );
      return new Response(
        JSON.stringify({ data: users, pagination: { total: 3 } }),
      );
    });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/admin/users"]}>
        <UsersPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  const user = userEvent.setup();
  expect(
    await screen.findByRole("button", { name: "创始账号的操作" }),
  ).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "本人账号的操作" }));
  expect(
    screen.getAllByRole("menuitem").map((item) => item.textContent),
  ).toEqual(["编辑"]);
  await user.keyboard("{Escape}");
  const trigger = screen.getByRole("button", { name: "成员账号的操作" });
  await user.click(trigger);
  expect(
    screen.getAllByRole("menuitem").map((item) => item.textContent),
  ).toEqual(["编辑", "设为管理员", "禁用", "重置密码", "删除用户"]);
  await user.click(screen.getByRole("menuitem", { name: "编辑" }));
  expect(await screen.findByRole("dialog", { name: "读取用户" })).toBeVisible();
  resolveDetail(
    new Response(JSON.stringify({ data: users[2] }), {
      headers: { ETag: '"u-3-v1"' },
    }),
  );
  const dialog = await screen.findByRole("dialog", { name: "编辑用户" });
  await waitFor(() =>
    expect(dialog.contains(document.activeElement)).toBe(true),
  );
  await user.keyboard("{Escape}");
  await waitFor(() => expect(trigger).toHaveFocus());
  expect(
    fetch.mock.calls.every(
      ([, options]) => !options?.method || options.method === "GET",
    ),
  ).toBe(true);
});
