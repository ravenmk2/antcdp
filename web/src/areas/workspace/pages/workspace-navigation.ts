export const workspaceProjectPages = [
  "overview",
  "repositories",
  "jobs",
  "events",
  "description",
  "settings",
] as const;
export type WorkspaceProjectPage = (typeof workspaceProjectPages)[number];

export const projectSectionLabels = {
  profile: "基本资料",
  members: "项目成员",
  roles: "角色管理",
  teams: "团队授权",
  integrations: "服务连接",
  hosts: "SSH 凭证",
  dingtalk: "钉钉机器人",
} as const;
export type WorkspaceProjectSettingSection = keyof typeof projectSectionLabels;

export const projectSectionRoutes: Partial<
  Record<WorkspaceProjectSettingSection, string>
> = {
  integrations: "integrations",
  hosts: "remote-hosts",
  dingtalk: "dingtalk",
};

export interface WorkspaceProjectView {
  projectId: string;
  page: WorkspaceProjectPage;
  section: WorkspaceProjectSettingSection;
}

export function normalizeWorkspaceProjectSetting(
  value: string | null,
): WorkspaceProjectSettingSection {
  return value && Object.hasOwn(projectSectionLabels, value)
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
  if (remainder === "events")
    return { projectId, page: "events", section: "profile" };
  if (remainder === "description/edit")
    return { projectId, page: "description", section: "profile" };
  if (/^jobs(?:\/(?:new|[1-9]\d*)(?:\/runs\/[1-9]\d*)?)?$/.test(remainder))
    return { projectId, page: "jobs", section: "profile" };
  if (/^dingtalk(?:\/[1-9]\d*)?$/.test(remainder))
    return { projectId, page: "settings", section: "dingtalk" };
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

export const workspaceTeamTabLabels = {
  overview: "团队介绍",
  members: "团队成员",
  projects: "参与项目",
} as const;

export type WorkspaceTeamTab = keyof typeof workspaceTeamTabLabels;

export function normalizeWorkspaceTeamTab(
  value: string | null,
): WorkspaceTeamTab {
  return value === "members" || value === "projects" ? value : "overview";
}
