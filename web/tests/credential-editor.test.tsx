import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import { beforeEach, expect, it, vi } from "vitest";
import { resetCSRF } from "@/api/client";
import { CredentialPanel } from "@/features/credentials/credential-panel";
import { sshProvider } from "@/domain/ssh-provider";
import {
  serviceProviders,
  type ProviderDefinition,
} from "@/domain/service-providers";

vi.mock("@/app/auth", () => ({
  useAuth: () => ({ settings: { timezone: "Asia/Shanghai" } }),
}));
beforeEach(resetCSRF);

const credential = {
  id: "c1",
  connection_id: "h1",
  service_type: "ssh",
  code: "example",
  name: "示例凭证",
  description: "",
  ownership_type: "system",
  project_id: null,
  user_id: null,
  auth_method: "ssh_password",
  identity_config: { username: "tester" },
  enabled: true,
  is_preferred: false,
  has_secret: true,
  expires_at: null,
  version: "credential-v1",
  created_at: "2026-11-06T00:00:00Z",
  updated_at: "2026-11-06T00:00:00Z",
};
const json = (data: unknown, etag?: string) =>
  new Response(JSON.stringify({ data }), {
    headers: etag ? { ETag: etag } : {},
  });

function setup(
  provider = sshProvider,
  base = "/admin/remote-hosts/h1/credentials",
  initial = false,
) {
  let tag = '"collection-v1"';
  let items = initial ? [credential] : [];
  let failure: "conflict" | "unknown" | "validation" | undefined;
  const requests: { method: string; headers: Headers; body: unknown }[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const path = String(input);
    const method = init?.method ?? "GET";
    if (path.endsWith("/auth/csrf")) return json({ csrf_token: "test-csrf" });
    if (path === `/api/v1${base}` && method === "GET")
      return json({ items, mutation_version: tag.slice(1, -1) }, tag);
    const headers = new Headers(init?.headers);
    if (path === `/api/v1${base}` && method === "POST") {
      requests.push({ method, headers, body: JSON.parse(String(init?.body)) });
      if (failure === "unknown") throw new TypeError("network failed");
      if (failure === "validation")
        return new Response(
          JSON.stringify({
            error: {
              code: "VALIDATION_FAILED",
              message: "字段校验失败",
              details: [{ field: "token", code: "invalid_format" }],
            },
          }),
          { status: 422 },
        );
      if (failure === "conflict") tag = '"collection-v2"';
      if (headers.get("If-Match") !== tag)
        return new Response(
          JSON.stringify({
            error: { code: "VERSION_CONFLICT", message: "请先加载当前资料" },
            request_id: "debug-request-id",
          }),
          { status: 412 },
        );
      items = [credential];
      return json(credential, '"credential-v1"');
    }
    if (path === `/api/v1${base}/c1` && method === "DELETE") {
      requests.push({ method, headers, body: undefined });
      items = [];
      return new Response(null, { status: 204 });
    }
    throw new Error(`Unexpected request: ${method} ${path}`);
  });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <CredentialPanel base={base} provider={provider} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return {
    user: userEvent.setup(),
    requests,
    fail: (value: typeof failure) => {
      failure = value;
    },
  };
}

async function fill(
  user: ReturnType<typeof userEvent.setup>,
  provider: ProviderDefinition,
) {
  const add = await screen.findByRole("button", { name: "添加凭证" });
  await waitFor(() => expect(add).toBeEnabled());
  await user.click(add);
  await user.type(screen.getByLabelText(/^名称/), "新凭证");
  await user.type(screen.getByLabelText(/编码/), "new-credential");
  await user.click(screen.getByRole("button", { name: "下一步" }));
  for (const field of provider.methods[0]!.identity)
    await user.type(
      screen.getByLabelText(new RegExp(`^${field.label}`)),
      "tester",
    );
  for (const field of provider.methods[0]!.secret)
    await user.type(
      screen.getByLabelText(new RegExp(`^${field.label}`)),
      "sensitive-test-value",
    );
  await user.click(screen.getByRole("button", { name: "下一步" }));
}

it.each([
  [sshProvider, "/admin/remote-hosts/h1/credentials"],
  [
    serviceProviders.find((provider) => provider.type === "gitlab")!,
    "/admin/service-connections/g1/credentials",
  ],
] as const)(
  "creates %s credentials using the list ETag and a readonly confirmation summary",
  async (provider, base) => {
    const { user, requests } = setup(provider, base);
    await fill(user, provider);
    const dialog = screen.getByRole("dialog", { name: "添加凭证" });
    expect(within(dialog).getByText("新凭证")).toBeVisible();
    expect(within(dialog).queryByRole("textbox")).not.toBeInTheDocument();
    expect(dialog.textContent).not.toContain("sensitive-test-value");
    await user.click(within(dialog).getByRole("button", { name: "保存" }));
    await waitFor(() => expect(dialog).not.toBeInTheDocument());
    expect(requests).toHaveLength(1);
    expect(requests[0]!.headers.get("If-Match")).toBe('"collection-v1"');
    expect(requests[0]!.headers.has("X-Collection-If-Match")).toBe(false);
    expect(requests[0]!.body).toMatchObject({
      name: "新凭证",
      code: "new-credential",
    });
  },
);

it("shows one useful conflict message and reloads the list without losing the draft or replaying a write", async () => {
  const { user, requests, fail } = setup();
  fail("conflict");
  await fill(user, sshProvider);
  await user.click(screen.getByRole("button", { name: "保存" }));
  const error = await screen.findByRole("alert");
  expect(error).toHaveTextContent("凭证列表信息已失效，请重新加载后再保存。");
  expect(screen.getAllByRole("alert")).toHaveLength(1);
  expect(error.textContent).not.toContain("等待 0 秒");
  expect(screen.getByText("请求编号：debug-request-id")).not.toBeVisible();
  expect(screen.getByRole("button", { name: "保存" })).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "重新加载凭证列表" }));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "保存" })).toBeEnabled(),
  );
  expect(requests).toHaveLength(1);
  expect(screen.getByText("新凭证")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "上一步" }));
  expect(screen.getByLabelText(/^密码/)).toHaveValue("sensitive-test-value");
  await user.click(screen.getByRole("button", { name: "下一步" }));
  fail(undefined);
  await user.click(screen.getByRole("button", { name: "保存" }));
  await waitFor(() =>
    expect(
      screen.queryByRole("dialog", { name: "添加凭证" }),
    ).not.toBeInTheDocument(),
  );
  expect(requests).toHaveLength(2);
  expect(requests[1]!.headers.get("If-Match")).toBe('"collection-v2"');
});

it("blocks unknown-result replay and confirms cancellation of the credential draft", async () => {
  const { user, requests, fail } = setup();
  fail("unknown");
  await fill(user, sshProvider);
  await user.click(screen.getByRole("button", { name: "保存" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "保存结果尚未确认",
  );
  expect(screen.getByRole("button", { name: "保存" })).toBeDisabled();
  expect(
    screen.queryByRole("button", { name: "重新加载凭证列表" }),
  ).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "取消" }));
  const discard = await screen.findByRole("dialog", {
    name: "放弃未保存的修改？",
  });
  await user.click(within(discard).getByRole("button", { name: "取消" }));
  expect(screen.getByRole("dialog", { name: "添加凭证" })).toBeVisible();
  expect(requests).toHaveLength(1);
});

it("returns authentication errors to the relevant step with a readable field message and focus", async () => {
  const { user, fail } = setup();
  fail("validation");
  await fill(user, sshProvider);
  await user.click(screen.getByRole("button", { name: "保存" }));
  const password = await screen.findByLabelText(/^密码/);
  expect(await screen.findByText("请检查密码的格式或内容。")).toBeVisible();
  await waitFor(() => expect(password).toHaveFocus());
  expect(password).toHaveValue("sensitive-test-value");
  expect(screen.queryByText(/token：invalid_format/)).not.toBeInTheDocument();
});

it("deletes with the credential ETag and the list ETag in their respective headers", async () => {
  const { user, requests } = setup(sshProvider, undefined, true);
  await user.click(
    await screen.findByRole("button", { name: "示例凭证的操作" }),
  );
  await user.click(await screen.findByRole("menuitem", { name: "删除凭证" }));
  const dialog = await screen.findByRole("dialog", { name: "删除凭证" });
  await user.click(within(dialog).getByRole("button", { name: "删除凭证" }));
  await waitFor(() => expect(dialog).not.toBeInTheDocument());
  expect(requests).toHaveLength(1);
  expect(requests[0]!.headers.get("If-Match")).toBe('"credential-v1"');
  expect(requests[0]!.headers.get("X-Collection-If-Match")).toBe(
    '"collection-v1"',
  );
});
