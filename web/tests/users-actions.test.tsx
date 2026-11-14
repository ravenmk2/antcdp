import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import { expect, it, vi } from "vitest";
import { UsersPage } from "@/areas/console/pages/users-page";
import { resetCSRF } from "@/api/client";

vi.mock("@/app/auth", () => ({
  useSession: () => ({ user: { id: "2", role: "admin" } }),
}));

it.each([
  ["role", "设为管理员", "取消管理员", "取消管理员身份"],
  ["status", "禁用", "启用", "启用用户"],
])(
  "uses current state and ETag for consecutive %s actions",
  async (field, first, second, secondTitle) => {
    resetCSRF();
    let member = {
      id: "3",
      username: "member",
      display_name: "成员账号",
      role: "user",
      status: "active",
      is_founder: false,
      version: 1,
    };
    const writes: { etag: string | null; body: Record<string, string> }[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, options) => {
      const url = String(input);
      if (url.endsWith("/auth/csrf"))
        return new Response(JSON.stringify({ data: { csrf_token: "test" } }));
      if (options?.method === "PUT") {
        const etag = new Headers(options.headers).get("If-Match");
        const body = JSON.parse(String(options.body));
        writes.push({ etag, body });
        if (etag !== `"u-3-v${member.version}"`)
          return new Response(
            JSON.stringify({
              error: { code: "VERSION_CONFLICT", message: "版本冲突" },
            }),
            { status: 412 },
          );
        member = { ...member, ...body, version: member.version + 1 };
        return new Response(JSON.stringify({ data: member }));
      }
      if (url.endsWith("/admin/users/3"))
        return new Response(JSON.stringify({ data: member }), {
          headers: { ETag: `"u-3-v${member.version}"` },
        });
      if (url.includes("/admin/overview"))
        return new Response(
          JSON.stringify({
            data: { users_total: 1, users_active: 1, users_disabled: 0 },
          }),
        );
      return new Response(
        JSON.stringify({ data: [member], pagination: { total: 1 } }),
      );
    });
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <UsersPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole("button", { name: "成员账号的操作" }),
    );
    await user.click(await screen.findByRole("menuitem", { name: first }));
    const firstTitle = field === "role" ? first : "禁用用户";
    await user.click(
      within(await screen.findByRole("dialog", { name: firstTitle })).getByRole(
        "button",
        { name: firstTitle },
      ),
    );
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    await user.click(screen.getByRole("button", { name: "成员账号的操作" }));
    await user.click(await screen.findByRole("menuitem", { name: second }));
    await user.click(
      within(
        await screen.findByRole("dialog", { name: secondTitle }),
      ).getByRole("button", { name: secondTitle }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(writes).toEqual([
      {
        etag: '"u-3-v1"',
        body: { [field]: field === "role" ? "admin" : "disabled" },
      },
      {
        etag: '"u-3-v2"',
        body: { [field]: field === "role" ? "user" : "active" },
      },
    ]);
    client.clear();
  },
);

it("waits for fresh detail before initializing an edit form from a warm cache", async () => {
  const member = {
    id: "3",
    username: "member",
    display_name: "旧名称",
    role: "user",
    status: "active",
    is_founder: false,
    version: 1,
  };
  let resolveDetail!: (response: Response) => void;
  const detail = new Promise<Response>((resolve) => {
    resolveDetail = resolve;
  });
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    if (String(input).endsWith("/admin/users/3")) return detail;
    if (String(input).includes("/admin/overview"))
      return new Response(JSON.stringify({ data: { users_total: 1 } }));
    return new Response(
      JSON.stringify({ data: [member], pagination: { total: 1 } }),
    );
  });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  client.setQueryData(["user", "3"], {
    data: member,
    etag: '"u-3-v1"',
    status: 200,
  });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <UsersPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "旧名称的操作" }));
  await user.click(await screen.findByRole("menuitem", { name: "编辑" }));
  expect(await screen.findByRole("dialog", { name: "读取用户" })).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "保存更改" }),
  ).not.toBeInTheDocument();
  resolveDetail(
    new Response(
      JSON.stringify({
        data: { ...member, display_name: "最新名称", version: 2 },
      }),
      { headers: { ETag: '"u-3-v2"' } },
    ),
  );
  await screen.findByRole("dialog", { name: "编辑用户" });
  expect(screen.getByRole("textbox", { name: "显示名称" })).toHaveValue(
    "最新名称",
  );
  client.clear();
});

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
    (await screen.findAllByRole("menuitem")).map((item) => item.textContent),
  ).toEqual(["编辑"]);
  await user.keyboard("{Escape}");
  const trigger = screen.getByRole("button", { name: "成员账号的操作" });
  await user.click(trigger);
  expect(
    (await screen.findAllByRole("menuitem")).map((item) => item.textContent),
  ).toEqual(["编辑", "设为管理员", "禁用", "重置密码", "删除用户"]);
  await user.click(await screen.findByRole("menuitem", { name: "编辑" }));
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

it("closes untouched forms without confirmation and protects actual edits", async () => {
  const member = {
    id: "3",
    username: "member",
    display_name: "成员账号",
    role: "user",
    status: "active",
    is_founder: false,
    avatar: null,
    version: 1,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    last_login_at: null,
  };
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input);
    if (url.endsWith("/admin/users/3"))
      return new Response(JSON.stringify({ data: member }), {
        headers: { ETag: '"u-3-v1"' },
      });
    if (url.includes("/admin/overview"))
      return new Response(
        JSON.stringify({
          data: { users_total: 1, users_active: 1, users_disabled: 0 },
        }),
      );
    return new Response(
      JSON.stringify({ data: [member], pagination: { total: 1 } }),
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
  await user.click(await screen.findByRole("button", { name: "添加用户" }));
  expect(
    await screen.findByRole("dialog", { name: "创建用户" }),
  ).toBeInTheDocument();
  await user.keyboard("{Escape}");
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );

  const trigger = await screen.findByRole("button", {
    name: "成员账号的操作",
  });
  await user.click(trigger);
  await user.click(await screen.findByRole("menuitem", { name: "删除用户" }));
  expect(
    await screen.findByRole("dialog", { name: "删除用户" }),
  ).toBeInTheDocument();
  await user.keyboard("{Escape}");
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );

  await user.click(trigger);
  await user.click(await screen.findByRole("menuitem", { name: "删除用户" }));
  const input = await screen.findByRole("textbox", {
    name: /输入用户名 member/,
  });
  await user.type(input, "member");
  await user.keyboard("{Escape}");
  const confirmation = await screen.findByRole("dialog", {
    name: "放弃未保存的修改？",
  });
  await user.click(
    within(confirmation).getByRole("button", { name: "放弃修改" }),
  );
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  client.clear();
});
