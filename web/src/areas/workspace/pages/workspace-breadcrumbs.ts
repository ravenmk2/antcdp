import type { Crumb } from "@/components/layout";
import type { Resource } from "@/types/collaboration";
import {
  normalizeWorkspaceTeamTab,
  resolveWorkspaceProjectView,
} from "@/areas/workspace/pages/workspace-navigation";

export function workspaceBreadcrumbs(
  path: string,
  search: string,
  project: Resource | undefined,
  workspaceTeamName?: string,
): Crumb[] {
  if (path === "/home") return [{ label: "工作区" }, { label: "工作台" }];
  if (path === "/cloud-computer")
    return [{ label: "工作区", to: "/home" }, { label: "我的云电脑" }];
  if (/^\/agents\/sessions\/[1-9]\d*\/?$/.test(path))
    return [{ label: "工作台", to: "/home" }, { label: "对话" }];
  if (path.startsWith("/account"))
    return [{ label: "工作区", to: "/home" }, { label: "个人设置" }];
  if (path.startsWith("/teams/")) {
    const editMatch = path.match(/^\/teams\/([1-9]\d*)\/description\/edit$/);
    if (editMatch)
      return [
        { label: "我的团队", to: "/teams" },
        {
          label: workspaceTeamName || "团队详情",
          to: `/teams/${editMatch[1]}`,
        },
        { label: "编辑描述" },
      ];
    const tab = normalizeWorkspaceTeamTab(
      new URLSearchParams(search).get("tab"),
    );
    const items: Crumb[] = [
      { label: "我的团队", to: "/teams" },
      {
        label: workspaceTeamName || "团队详情",
        ...(tab !== "overview" ? { to: path } : {}),
      },
    ];
    if (tab === "members") items.push({ label: "成员管理" });
    if (tab === "projects") items.push({ label: "关联项目" });
    return items;
  }
  if (project) {
    const view = resolveWorkspaceProjectView(path, search);
    const labels: Record<string, string> = {
      repositories: "Git 仓库",
      settings: "项目设置",
      description: "项目介绍",
    };
    const items: Crumb[] = [
      { label: "我的项目", to: "/projects" },
      { label: project.name, to: `/projects/${project.id}` },
    ];
    const credentialMatch = path.match(
      /^\/projects\/[1-9]\d*\/(integrations|remote-hosts)(?:\/([1-9]\d*))?$/,
    );
    if (credentialMatch) {
      const [, section, objectId] = credentialMatch;
      const sectionPath = `/projects/${project.id}/${section}`;
      items.push({
        label: section === "integrations" ? "项目服务凭证" : "项目 SSH 凭证",
        ...(objectId ? { to: sectionPath } : {}),
      });
      if (objectId)
        items.push({
          label: section === "integrations" ? "连接详情" : "主机详情",
        });
    } else if (path.endsWith("/description/edit")) {
      items.push(
        {
          label: "项目介绍",
          to: `/projects/${project.id}?tab=description`,
        },
        { label: "编辑项目介绍" },
      );
    } else if (view && view.page !== "overview") {
      items.push({ label: labels[view.page] ?? "项目总览" });
    }
    return items;
  }
  if (path.includes("/integrations/"))
    return [
      { label: "服务集成", to: "/account/integrations" },
      { label: "连接详情" },
    ];
  if (path.includes("/remote-hosts/"))
    return [
      { label: "远程主机", to: "/account/remote-hosts" },
      { label: "主机详情" },
    ];
  const names: Record<string, string> = {
    "/projects": "我的项目",
    "/teams": "我的团队",
  };
  return [{ label: "工作区", to: "/home" }, { label: names[path] ?? "页面" }];
}
