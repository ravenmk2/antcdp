import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import { expect, it, vi } from "vitest";
import { CredentialPanel } from "@/features/credentials/credential-panel";
import { sshProvider } from "@/domain/ssh-provider";
import { request } from "@/api/client";
vi.mock("@/api/client", async (original) => ({
  ...(await original<typeof import("@/api/client")>()),
  request: vi.fn(),
}));
it("selects an existing scoped identity, verifies it and clears the preference", async () => {
  const base = "/admin/remote-hosts/1/credentials";
  let selected: string | null = null;
  const mock = vi.mocked(request);
  mock.mockImplementation(async (path, opts = {}) => {
    if (path === base)
      return {
        data: {
          items: [
            {
              id: "2",
              code: "deploy",
              name: "发布账户",
              kind: "username_password",
              enabled: true,
              expires_at: null,
              version: "material-v1",
            },
          ],
        },
        etag: "",
        status: 200,
      };
    if (path.endsWith("/preferred")) {
      if (opts.method === "PUT")
        selected = (opts.body as { credential_id: string }).credential_id;
      if (opts.method === "DELETE") selected = null;
      return {
        data: { credential_id: selected },
        etag: '"selection-v1"',
        status: 200,
      };
    }
    return { data: { latest: null }, etag: "", status: 200 };
  });
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <MemoryRouter>
        <CredentialPanel base={base} provider={sshProvider} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  const user = userEvent.setup();
  expect(screen.getByRole("link", { name: /管理凭据/ })).toHaveAttribute(
    "href",
    "/admin/credentials",
  );
  await user.click(await screen.findByRole("combobox", { name: "首选凭据" }));
  await user.click(await screen.findByRole("option", { name: /发布账户/ }));
  await user.click(screen.getByRole("button", { name: "保存首选" }));
  await waitFor(() =>
    expect(mock).toHaveBeenCalledWith(
      base + "/preferred",
      expect.objectContaining({
        method: "PUT",
        etag: '"selection-v1"',
        body: { credential_id: "2" },
      }),
    ),
  );
  await user.click(await screen.findByRole("button", { name: "验证凭据" }));
  await waitFor(() =>
    expect(mock).toHaveBeenCalledWith(
      base + "/2/verify",
      expect.objectContaining({ etag: '"material-v1"' }),
    ),
  );
  await user.click(screen.getByRole("combobox", { name: "首选凭据" }));
  await user.click(await screen.findByRole("option", { name: "未设置" }));
  await user.click(screen.getByRole("button", { name: "保存首选" }));
  await waitFor(() => expect(selected).toBeNull());
});
