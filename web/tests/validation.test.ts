import { describe, expect, it } from "vitest";
import {
  displayNameSchema,
  passwordSchema,
  usernameSchema,
} from "@/domain/validation";

describe("shared validation", () => {
  it("validates usernames and display names", () => {
    expect(usernameSchema.safeParse("valid_user-1").success).toBe(true);
    expect(usernameSchema.safeParse("Invalid").success).toBe(false);
    expect(usernameSchema.safeParse("ab").success).toBe(false);
    expect(displayNameSchema.safeParse(" 中文用户 ").success).toBe(true);
    expect(displayNameSchema.safeParse("").success).toBe(false);
  });
  it("counts Unicode code points and UTF-8 bytes independently", () => {
    expect(passwordSchema.safeParse("密码密码密码密码").success).toBe(true);
    expect(passwordSchema.safeParse("😀😀😀😀😀😀😀😀").success).toBe(true);
    expect(passwordSchema.safeParse("short").success).toBe(false);
    expect(passwordSchema.safeParse("密".repeat(25)).success).toBe(false);
  });
});
