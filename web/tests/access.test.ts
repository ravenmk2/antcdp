import { beforeEach, describe, expect, it, vi } from "vitest";
import { api, resetCSRF } from "@/api/client";
import { registerSchema } from "@/features/access/auth-page";
import type { Session } from "@/types/auth";

const valid = {
  username: "new_user",
  display_name: "新用户",
  password: "password123",
  confirm: "password123",
};
beforeEach(() => {
  resetCSRF();
  vi.restoreAllMocks();
});

describe("registration", () => {
  it("validates required fields, username, password and confirmation", () => {
    expect(registerSchema.safeParse(valid).success).toBe(true);
    expect(
      registerSchema.safeParse({ ...valid, username: "Invalid" }).success,
    ).toBe(false);
    expect(
      registerSchema.safeParse({
        ...valid,
        password: "short",
        confirm: "short",
      }).success,
    ).toBe(false);
    expect(
      registerSchema.safeParse({ ...valid, confirm: "different" }).error
        ?.issues[0]?.path,
    ).toEqual(["confirm"]);
    expect(
      registerSchema.safeParse({
        username: "",
        display_name: "",
        password: "",
        confirm: "",
      }).success,
    ).toBe(false);
  });
  it("submits the real registration payload without confirmation or elevated role", async () => {
    const session = { require_password_change: false } as Session;
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input) => {
        if (String(input).endsWith("/auth/csrf"))
          return new Response(
            JSON.stringify({ data: { csrf_token: "csrf" } }),
            { headers: { "Content-Type": "application/json" } },
          );
        return new Response(JSON.stringify({ data: session }), {
          status: 201,
          headers: { "Content-Type": "application/json" },
        });
      });
    const result = await api<Session>("/auth/register", {
      username: valid.username,
      display_name: valid.display_name,
      password: valid.password,
    });
    expect(result.require_password_change).toBe(false);
    const [, init] = fetchMock.mock.calls[1] ?? [];
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    expect(body).toEqual({
      username: "new_user",
      display_name: "新用户",
      password: "password123",
    });
    expect(body).not.toHaveProperty("confirm");
    expect(body).not.toHaveProperty("role");
  });
});
