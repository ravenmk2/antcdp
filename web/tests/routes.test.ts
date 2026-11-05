import { describe, expect, it } from "vitest";
import { appHref, safeReturnTo } from "@/lib/routes";

describe("History routes", () => {
  it("keeps same-origin business bookmarks", () => {
    const origin = "https://antcdp.example.com";
    expect(
      safeReturnTo(
        "/projects/21?tab=releases&variant=41&release=81#materials",
        origin,
      ),
    ).toBe("/projects/21?tab=releases&variant=41&release=81#materials");
    expect(safeReturnTo("/admin/email/templates/new", origin)).toBe(
      "/admin/email/templates/new",
    );
    expect(safeReturnTo("/projects/21/variants/41", origin)).toBe(
      "/projects/21/variants/41",
    );
  });
  it("rejects external, protocol-relative and unsafe targets", () => {
    const origin = "https://antcdp.example.com";
    expect(safeReturnTo("https://example.com/steal", origin)).toBeNull();
    expect(safeReturnTo("//example.com/path", origin)).toBeNull();
    expect(safeReturnTo("/unknown/path", origin)).toBeNull();
    expect(safeReturnTo("/projects/21\\@example.com", origin)).toBeNull();
  });
  it("normalizes the legacy preview prefix", () => {
    expect(
      safeReturnTo(
        "/next/projects/21?tab=members",
        "https://antcdp.example.com",
      ),
    ).toBe("/projects/21?tab=members");
    expect(appHref("/projects/21?tab=members")).toBe(
      "/projects/21?tab=members",
    );
  });
});
