import { describe, expect, it } from "vitest";
import {
  displayNameSchema,
  passwordSchema,
  usernameSchema,
} from "@/domain/validation";
import {
  creationItemCanRetry,
  canTerminateRelease,
  reviewNeedsNote,
} from "@/domain/delivery-rules";

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

describe("delivery recovery rules", () => {
  it("requires reconciliation evidence before retrying an unknown item", () => {
    expect(
      creationItemCanRetry({ status: "unknown", reconciliation: null }),
    ).toBe(false);
    expect(
      creationItemCanRetry({
        status: "unknown",
        reconciliation: {
          status: "missing",
          reason: "",
          commit_id: "",
          checked_at: "now",
        },
      }),
    ).toBe(true);
    expect(
      creationItemCanRetry({ status: "created", reconciliation: null }),
    ).toBe(false);
  });
  it("requires return reasons and blocks termination during unknown operations", () => {
    expect(reviewNeedsNote("return")).toBe(true);
    expect(reviewNeedsNote("pass")).toBe(false);
    expect(canTerminateRelease("accepted", "unknown")).toBe(false);
    expect(canTerminateRelease("archived")).toBe(false);
    expect(canTerminateRelease("integrating", "succeeded")).toBe(true);
  });
});
