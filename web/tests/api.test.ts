import { beforeEach, describe, it, vi, expect } from "vitest";
import { ApiError, errorMessage, request, resetCSRF } from "@/api/client";

function response(
  body: unknown,
  init: { status?: number; headers?: Record<string, string> } = {},
) {
  return new Response(body === null ? null : JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "Content-Type": "application/json", ...init.headers },
  });
}

beforeEach(() => {
  resetCSRF();
  vi.restoreAllMocks();
});

describe("API protocol", () => {
  it.each([undefined, "", "invalid", "-1", "0"])(
    "does not invent a wait instruction for Retry-After=%s",
    async (header) => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        response(
          {
            error: {
              code: "PRECONDITION_REQUIRED",
              message: "请先加载当前资料",
            },
          },
          {
            status: 428,
            headers: header === undefined ? {} : { "Retry-After": header },
          },
        ),
      );
      await request("/credentials").catch((error: unknown) => {
        expect(error).toBeInstanceOf(ApiError);
        expect(errorMessage(error)).toBe("请先加载当前资料");
        if (header !== "0")
          expect((error as ApiError).retryAfter).toBeUndefined();
      });
    },
  );
  it("reads data and keeps identifiers as strings", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        response(
          { data: { id: "9007199254740993" } },
          { headers: { ETag: '"project-1-v2"' } },
        ),
      );
    const result = await request<{ id: string }>("/projects/1");
    expect(result.data.id).toBe("9007199254740993");
    expect(result.etag).toBe('"project-1-v2"');
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/v1/projects/1");
  });

  it("uses CSRF and the exact conditional headers", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input) => {
        if (String(input).endsWith("/auth/csrf"))
          return response({ data: { csrf_token: "csrf-value" } });
        return response(null, {
          status: 204,
          headers: { "X-Collection-ETag": '"collection-2"' },
        });
      });
    await request("/projects/1", {
      method: "DELETE",
      etag: '"project-1-v2"',
      collectionEtag: '"collection-1"',
      idempotencyKey: crypto.randomUUID(),
      body: undefined,
    });
    const [, init] = fetchMock.mock.calls[1] ?? [];
    const headers = new Headers(init?.headers);
    expect(headers.get("X-CSRF-Token")).toBe("csrf-value");
    expect(headers.get("If-Match")).toBe('"project-1-v2"');
    expect(headers.get("X-Collection-If-Match")).toBe('"collection-1"');
    expect(headers.get("Idempotency-Key")).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("marks interrupted writes as uncertain and never retries them", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input) => {
        if (String(input).endsWith("/auth/csrf"))
          return response({ data: { csrf_token: "csrf" } });
        throw new TypeError("offline");
      });
    const result = request("/auth/logout", { method: "POST", body: {} });
    await expect(result).rejects.toMatchObject({
      code: "NETWORK_ERROR",
      uncertain: true,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("preserves structured conflicts, request IDs and rate limits", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      if (String(input).endsWith("/auth/csrf"))
        return response({ data: { csrf_token: "csrf" } });
      return response(
        {
          error: {
            code: "VERSION_CONFLICT",
            message: "版本过期",
            details: [{ code: "version_conflict", field: "name" }],
          },
          request_id: "request-1",
        },
        { status: 412, headers: { "Retry-After": "2" } },
      );
    });
    const result = request("/projects/1", {
      method: "PATCH",
      etag: '"old"',
      body: { name: "draft" },
    });
    await expect(result).rejects.toMatchObject({
      status: 412,
      code: "VERSION_CONFLICT",
      requestId: "request-1",
      retryAfter: 2,
    });
    await result.catch((error: unknown) => {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).details[0]?.field).toBe("name");
    });
  });
});
