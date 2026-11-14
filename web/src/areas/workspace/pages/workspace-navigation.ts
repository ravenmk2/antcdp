export const workspaceProjectPages = [
  "overview",
  "repositories",
  "description",
  "settings",
] as const;
export type WorkspaceProjectPage = (typeof workspaceProjectPages)[number];

export const workspaceProjectSettingSections = [
  "profile",
  "members",
  "teams",
  "integrations",
  "hosts",
] as const;
export type WorkspaceProjectSettingSection =
  (typeof workspaceProjectSettingSections)[number];

export interface WorkspaceProjectView {
  projectId: string;
  page: WorkspaceProjectPage;
  section: WorkspaceProjectSettingSection;
}

export function normalizeWorkspaceProjectSetting(
  value: string | null,
): WorkspaceProjectSettingSection {
  return workspaceProjectSettingSections.includes(
    value as WorkspaceProjectSettingSection,
  )
    ? (value as WorkspaceProjectSettingSection)
    : "profile";
}

export function resolveWorkspaceProjectView(
  pathname: string,
  search: string,
): WorkspaceProjectView | null {
  const match = pathname.match(/^\/projects\/([1-9]\d*)(?:\/(.*))?\/?$/);
  if (!match) return null;
  const projectId = match[1]!;
  const remainder = match[2]?.replace(/\/$/, "") ?? "";
  if (remainder === "description/edit")
    return { projectId, page: "description", section: "profile" };
  if (/^variants(?:\/[1-9]\d*)?$/.test(remainder))
    return { projectId, page: "overview", section: "profile" };
  if (/^integrations(?:\/[1-9]\d*)?$/.test(remainder))
    return { projectId, page: "settings", section: "integrations" };
  if (/^remote-hosts(?:\/[1-9]\d*)?$/.test(remainder))
    return { projectId, page: "settings", section: "hosts" };
  if (remainder) return null;

  const params = new URLSearchParams(search);
  const tab = params.get("tab");
  const legacySections: Record<string, WorkspaceProjectSettingSection> = {
    members: "members",
    teams: "teams",
  };
  if (tab === "variants")
    return { projectId, page: "overview", section: "profile" };
  if (tab && legacySections[tab])
    return {
      projectId,
      page: "settings",
      section: legacySections[tab],
    };
  if (tab === "settings")
    return {
      projectId,
      page: "settings",
      section: normalizeWorkspaceProjectSetting(params.get("section")),
    };
  const page = workspaceProjectPages.includes(tab as WorkspaceProjectPage)
    ? (tab as WorkspaceProjectPage)
    : "overview";
  return { projectId, page, section: "profile" };
}

export type WorkspaceTeamTab = "overview" | "members" | "projects";

export function normalizeWorkspaceTeamTab(
  value: string | null,
): WorkspaceTeamTab {
  return value === "members" || value === "projects" ? value : "overview";
}
