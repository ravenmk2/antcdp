import { afterEach, expect, it, vi } from "vitest";
import { createApiClient, ApiError } from "@/shared/api";
afterEach(() => vi.unstubAllGlobals());
function response(data: unknown, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}
it("shares CSRF acquisition across simultaneous writes and preserves versions", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(response({ data: { csrf_token: "token" } }))
    .mockImplementation(() =>
      Promise.resolve(response({ data: { id: "1" } }, 200, { ETag: '"v2"' })),
    );
  vi.stubGlobal("fetch", fetch);
  const client = createApiClient();
  const replies = await Promise.all([
    client.request("/first", { method: "PUT", etag: '"v1"', body: {} }),
    client.request("/second", { method: "POST", body: {} }),
  ]);
  expect(
    fetch.mock.calls.filter(([path]) => path.endsWith("/auth/csrf")),
  ).toHaveLength(1);
  expect(fetch.mock.calls[1]![1].headers).toMatchObject({
    "X-CSRF-Token": "token",
    "If-Match": '"v1"',
  });
  expect(replies[0]!.etag).toBe('"v2"');
});
it("distinguishes a failed CSRF read from a lost write response", async () => {
  const fetch = vi.fn().mockRejectedValue(new Error("offline"));
  vi.stubGlobal("fetch", fetch);
  await expect(
    createApiClient().request("/send", { method: "POST" }),
  ).rejects.toMatchObject({ code: "CSRF_UNAVAILABLE" });
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch.mock.calls[0]?.[0]).toContain("/auth/csrf");
});
it("does not retry unknown write results", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(response({ data: { csrf_token: "token" } }))
    .mockRejectedValue(new Error("offline"));
  vi.stubGlobal("fetch", fetch);
  await expect(
    createApiClient().request("/send", { method: "POST", body: {} }),
  ).rejects.toMatchObject({ code: "NETWORK_ERROR" });
  expect(fetch).toHaveBeenCalledTimes(2);
});
it("preserves field errors and signals authentication failures", async () => {
  const fetch = vi.fn().mockResolvedValue(
    response(
      {
        error: { code: "PASSWORD_CHANGE_REQUIRED", message: "请修改密码" },
        request_id: "r1",
      },
      403,
    ),
  );
  vi.stubGlobal("fetch", fetch);
  const client = createApiClient();
  const auth = vi.fn();
  client.onAuthFailure(auth);
  await expect(client.request("/projects")).rejects.toBeInstanceOf(ApiError);
  expect(auth).toHaveBeenCalledWith("PASSWORD_CHANGE_REQUIRED");
});
