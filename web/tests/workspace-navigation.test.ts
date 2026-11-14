import { expect, it } from "vitest";
import {
  normalizeWorkspaceTeamTab,
  resolveWorkspaceProjectView,
} from "@/areas/workspace/pages/workspace-navigation";

it.each([
  ["/projects/7", "", "overview", "profile"],
  ["/projects/7", "?tab=unknown", "overview", "profile"],
  ["/projects/7", "?tab=releases", "overview", "profile"],
  ["/projects/7", "?tab=repositories", "repositories", "profile"],
  ["/projects/7", "?tab=description", "description", "profile"],
  ["/projects/7/description/edit", "", "description", "profile"],
  ["/projects/7", "?tab=variants", "overview", "profile"],
  ["/projects/7/variants", "", "overview", "profile"],
  ["/projects/7/variants/41", "?tab=releases", "overview", "profile"],
  ["/projects/7", "?tab=members", "settings", "members"],
  ["/projects/7", "?tab=teams", "settings", "teams"],
  ["/projects/7", "?tab=branch-model", "overview", "profile"],
  ["/projects/7", "?tab=settings&section=unknown", "settings", "profile"],
  ["/projects/7/integrations", "", "settings", "integrations"],
  ["/projects/7/integrations/9", "", "settings", "integrations"],
  ["/projects/7/remote-hosts", "", "settings", "hosts"],
  ["/projects/7/remote-hosts/9", "", "settings", "hosts"],
])("resolves %s%s", (pathname, search, page, section) => {
  expect(resolveWorkspaceProjectView(pathname, search)).toEqual({
    projectId: "7",
    page,
    section,
  });
});

it("does not treat unrelated nested routes as project tasks", () => {
  expect(resolveWorkspaceProjectView("/projects/7/unknown", "")).toBeNull();
  expect(resolveWorkspaceProjectView("/admin/projects/7", "")).toBeNull();
});

it.each([null, "", "unknown", "settings"])(
  "normalizes team tab %s to team information",
  (tab) => {
    expect(normalizeWorkspaceTeamTab(tab)).toBe("overview");
  },
);
