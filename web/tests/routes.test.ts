import { recentResources } from "@/lib/recent";
import { describe, expect, it } from "vitest";
import { appHref, safeReturnTo } from "@/lib/routes";

describe("History routes", () => {
  it("keeps same-origin business bookmarks", () => {
    const origin = "https://antcdp.example.com";
    for (const route of [
      "/admin/models",
      "/admin/models/new",
      "/admin/models/3?operation=91",
      "/admin/agents/3/prompt",
      "/admin/agents/new",
      "/admin/web-access/settings",
      "/admin/mcp-servers/12?tab=config",
      "/admin/skills/4/upload?upload=50",
      "/admin/skills/4/versions/55",
      "/admin/agents/4/debug",
      "/admin/agents/4/debug/90",
      "/admin/agent-usage?tab=runs",
      "/agents/sessions/31",
      "/agents",
      "/cloud-computer",
      "/admin/cloud-computers",
      "/admin/cloud-computers/settings",
      "/admin/cloud-computers/15",
    ]) {
      expect(safeReturnTo(route, origin)).toBe(route);
    }
    expect(
      safeReturnTo(
        "/projects/21?tab=releases&variant=41&release=81#materials",
        origin,
      ),
    ).toBe("/projects/21");
    expect(
      safeReturnTo("/admin/teams/7/description/edit#md-section", origin),
    ).toBe("/admin/teams/7/description/edit#md-section");
    expect(safeReturnTo("/teams/7/description/edit", origin)).toBe(
      "/teams/7/description/edit",
    );
    expect(safeReturnTo("/projects/21/description/edit", origin)).toBe(
      "/projects/21/description/edit",
    );
    expect(safeReturnTo("/admin/email/templates/new", origin)).toBe(
      "/admin/email/templates/new",
    );
    expect(safeReturnTo("/projects/21/variants/41", origin)).toBe(
      "/projects/21",
    );
    expect(
      safeReturnTo("/admin/projects/21/integrations/8?tab=credentials", origin),
    ).toBe("/admin/projects/21/integrations/8?tab=credentials");
    expect(safeReturnTo("/admin/projects/21/remote-hosts", origin)).toBe(
      "/admin/projects/21/remote-hosts",
    );
    expect(safeReturnTo("/admin/projects/21/description/edit", origin)).toBe(
      "/admin/projects/21/description/edit",
    );
    expect(safeReturnTo("/admin/projects/21/variants/41", origin)).toBe(
      "/admin/projects/21",
    );
    expect(
      safeReturnTo("/admin/projects/21/variants/41/releases/81", origin),
    ).toBe("/admin/projects/21");
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

it("normalizes removed project pages in recent resources", () => {
  sessionStorage.setItem(
    "antcdp.recent.label-test",
    JSON.stringify([
      {
        id: "21",
        name: "Project",
        kind: "project",
        to: "/projects/21/variants/41?release=81",
      },
    ]),
  );
  expect(recentResources("label-test")[0]?.to).toBe("/projects/21");
  sessionStorage.removeItem("antcdp.recent.label-test");
});
