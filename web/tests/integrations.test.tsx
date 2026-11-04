import { afterEach, beforeEach, it, expect, vi } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConnectionEditor } from "@/features/integrations/ConnectionEditor";
import { Webhook } from "@/features/integrations/Webhook";
import { request, ApiError } from "@/lib/api";
import type { Capability } from "@/shared/integrations";
vi.mock("@/lib/api", async (o) => ({
  ...(await o<object>()),
  request: vi.fn(),
}));
const mock = vi.mocked(request);
beforeEach(() => {
  mock.mockReset();
});
vi.mock("@/lib/date", () => ({ useDate: () => (value: string) => value }));
afterEach(cleanup);
const cap: Capability = {
  name: "GitLab",
  service_type: "gitlab",
  credentials: true,
  connection_test: true,
  auth_methods: ["gitlab_access_token"],
  webhook: { supported: true, verification_methods: ["secret_token"] },
};
it("resumes a partially created connection at the credential step and erases rejected secrets", async () => {
  const user = userEvent.setup(),
    saved = vi.fn(),
    created = { id: "8", name: "测试连接", service_type: "gitlab" };
  let writes = 0;
  mock.mockImplementation(async (path, opts) => {
    if (path === "/admin/service-connections/gitlab" && opts?.method === "POST")
      return { data: created, etag: "one" };
    if (
      path.endsWith("/8/credentials") &&
      opts?.method === "POST" &&
      ++writes === 1
    )
      throw new ApiError("VALIDATION_FAILED", "认证材料无效");
    return { data: { items: [] }, etag: '"group"' };
  });
  render(
    <ConnectionEditor
      capabilities={[cap]}
      onClose={() => {}}
      onSaved={saved}
    />,
  );
  await user.click(screen.getByText("下一步"));
  await user.type(screen.getByLabelText(/连接名称/), "测试连接");
  await user.type(
    screen.getByLabelText(/GitLab 实例地址/),
    "https://git.example.invalid",
  );
  await user.click(screen.getByText("下一步"));
  await user.type(screen.getByLabelText(/凭证名称/), "自动化");
  await user.type(screen.getByLabelText("API Token"), "test-only");
  await user.click(screen.getByText("创建连接并添加凭证"));
  await screen.findByText(/连接已创建。/);
  expect((screen.getByLabelText("API Token") as HTMLInputElement).value).toBe(
    "",
  );
  await user.type(screen.getByLabelText("API Token"), "replacement");
  await user.click(screen.getByText("保存凭证"));
  await waitFor(() => expect(saved).toHaveBeenCalledWith(created));
  expect(
    mock.mock.calls.filter(
      ([path]) => path === "/admin/service-connections/gitlab",
    ),
  ).toHaveLength(1);
  expect(writes).toBe(2);
});
it("retains a generated token through a failed settings refresh until explicitly dismissed", async () => {
  let generated = false;
  mock.mockImplementation(async (path) => {
    if (path.endsWith("/generate")) {
      generated = true;
      return {
        data: { secret: { token: "one-time-test-value" } },
        etag: '"new"',
      };
    }
    if (path.endsWith("/receiver"))
      return {
        data: { receive_url: "https://example.invalid/api/test" },
        etag: "",
      };
    if (path.endsWith("/diagnostics"))
      return { data: { latest: null }, etag: "" };
    if (generated) throw Error("offline");
    return {
      data: {
        enabled: false,
        has_secret: false,
        verification_method: "secret_token",
      },
      etag: '"old"',
    };
  });
  const user = userEvent.setup();
  render(<Webhook base="/webhook" enabled methods={["secret_token"]} />);
  await user.click(await screen.findByRole("button", { name: "配置验证秘密" }));
  await user.click(screen.getByLabelText("生成新的 Secret Token"));
  await user.click(screen.getByRole("button", { name: "确认保存" }));
  expect(
    ((await screen.findByLabelText("一次性 Webhook Token")) as HTMLInputElement)
      .value,
  ).toBe("one-time-test-value");
  expect(mock).toHaveBeenCalledWith("/webhook/verification/generate", {
    method: "POST",
    etag: '"old"',
    body: {},
  });
  await user.click(screen.getByRole("button", { name: "已保存并关闭" }));
  expect(screen.queryByLabelText("一次性 Webhook Token")).toBeNull();
});
