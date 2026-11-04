import { describe, expect, it } from "vitest";
import { appHref, authHref, safeReturnTo } from "../src/lib/navigation";
describe("authentication return targets", () => {
  it.each([
    "/account",
    "/account/security",
    "/admin/settings?tab=access",
    "/admin/audit?q=test",
  ])("preserves migrated account and administration target %s", (target) => {
    expect(safeReturnTo(target, location.origin)).toBe(target);
  });
  it("allows registered variant routes and rejects sibling asset paths", () => {
    expect(
      safeReturnTo("/projects/12/variants?variant=3", location.origin),
    ).toBe("/projects/12/variants?variant=3");
    expect(
      safeReturnTo("/projects/12/variants/assets", location.origin),
    ).toBeNull();
  });
  it("resolves bookmarked sign-in targets at the root", () => {
    expect(safeReturnTo("/next/admin/users?page=2#edit", location.origin)).toBe(
      "/admin/users?page=2#edit",
    );
    expect(safeReturnTo("/next//evil.test", location.origin)).toBeNull();
  });
  it("uses the active application base for authentication", () => {
    const target = appHref("/admin/users?page=2#edit");
    const url = new URL(authHref("/login", target));
    expect(url.origin).toBe(location.origin);
    expect(url.pathname).toBe(appHref("/login"));
    expect(url.searchParams.get("return_to")).toBe(target);
  });
  it("keeps query and fragment for registered routes", () => {
    expect(
      safeReturnTo("/admin/users?page=2#edit", "https://example.test"),
    ).toBe("/admin/users?page=2#edit");
  });
  it.each([
    "https://other.test/home",
    "//other.test/home",
    "/\\other.test/home",
    "/api/v1/auth/session",
    "/assets/main.js",
    "/login",
    "/%2fhome",
    "/%255chome",
    "/nextish/home",
    ["/home"],
    null,
  ])("rejects unsafe or non-page target %s", (value) => {
    expect(safeReturnTo(value, "https://example.test")).toBeNull();
  });
  it("accepts only registered business return targets at the root", () => {
    expect(
      safeReturnTo("/projects/7/variants?variant=3#repo", location.origin),
    ).toBe("/projects/7/variants?variant=3#repo");
    for (const path of [
      "/required-password",
      "/api/v1/me",
      "/assets/a.js",
      "/nextish",
      "/components",
      "//bad.test/home",
    ])
      expect(safeReturnTo(path, location.origin)).toBeNull();
  });
});
