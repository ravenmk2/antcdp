import { afterEach, beforeEach, it, expect, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HostKeys } from "@/features/remote-hosts/HostKeys";
import {
  credentialBody,
  credentialDraft,
  clearSecrets,
} from "@/features/remote-hosts/Fields";
import { request, ApiError } from "@/lib/api";
import type { RemoteHost } from "@/shared/remote-hosts";
vi.mock("@/lib/api", async (o) => ({
  ...(await o<object>()),
  request: vi.fn(),
}));
const host = {
  id: "5",
  name: "构建机",
  service_type: "ssh",
  enabled: true,
  config: { host_keys: ["trusted-key"] },
} as RemoteHost;
beforeEach(() => {
  vi.mocked(request).mockReset();
});
afterEach(cleanup);
it("keeps a probed key untrusted until explicitly confirmed with the original host version", async () => {
  const user = userEvent.setup(),
    saved = vi.fn();
  vi.mocked(request).mockImplementation(async (path) => {
    if (path.endsWith("/test"))
      return {
        data: {
          summary: { host_key: "probe-key", fingerprint: "SHA256:test" },
        },
        etag: "",
      };
    throw new ApiError("VERSION_CONFLICT", "主机版本变化");
  });
  const view = (tag: string) => (
    <HostKeys
      host={host}
      path="/admin/remote-hosts/5"
      etag={tag}
      onSaved={saved}
    />
  );
  const ui = render(view('"original"'));
  await user.click(screen.getByRole("button", { name: "探测公钥" }));
  await screen.findByText("SHA256:test");
  expect(vi.mocked(request).mock.calls).toHaveLength(1);
  expect(
    (screen.getByRole("button", { name: "加入信任" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  ui.rerender(view('"other-address"'));
  await user.click(screen.getByLabelText("已通过可信来源核对主机身份"));
  await user.click(screen.getByRole("button", { name: "加入信任" }));
  await waitFor(() => expect(screen.getByText(/草稿已保留/)).toBeTruthy());
  expect(request).toHaveBeenCalledWith("/admin/remote-hosts/5", {
    method: "PATCH",
    etag: '"original"',
    body: { config: { host_keys: ["trusted-key", "probe-key"] } },
  });
  expect(saved).not.toHaveBeenCalled();
});
it("sends only the selected SSH authentication shape and clears both encrypted-key secrets after errors", () => {
  const draft = {
    ...credentialDraft("ssh"),
    name: "连接凭证",
    method: "ssh_encrypted_key",
    values: {
      username: "builder",
      private_key: "test-only-key",
      passphrase: "test-only-pass",
      token: "old",
    },
  };
  expect(credentialBody("ssh", draft).authentication).toEqual({
    auth_method: "ssh_encrypted_key",
    identity_config: { username: "builder" },
    secret: { private_key: "test-only-key", passphrase: "test-only-pass" },
  });
  expect(clearSecrets("ssh", draft).values.private_key).toBeUndefined();
  expect(clearSecrets("ssh", draft).values.passphrase).toBeUndefined();
});
