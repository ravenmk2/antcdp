import type { Crumb } from "@/components/layout";
import type { Resource } from "@/types/collaboration";
import {
  normalizeWorkspaceTeamTab,
  projectSectionLabels,
  resolveWorkspaceProjectView,
  workspaceTeamTabLabels,
} from "@/areas/workspace/pages/workspace-navigation";

export function workspaceBreadcrumbs(
  path: string,
  search: string,
  project: Resource | undefined,
  workspaceTeamName?: string,
): Crumb[] {
  if (path === "/home") return [{ label: "工作区" }, { label: "工作台" }];
  if (path === "/computer")
    return [{ label: "工作区", to: "/home" }, { label: "我的云电脑" }];
  if (/^\/chats\/[1-9]\d*\/?$/.test(path))
    return [{ label: "工作台", to: "/home" }, { label: "对话" }];
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
    if (tab !== "overview") items.push({ label: workspaceTeamTabLabels[tab] });
    return items;
  }
  if (project) {
    const view = resolveWorkspaceProjectView(path, search);
    const labels: Record<string, string> = {
      repositories: "Git 仓库",
      jobs: "项目作业",
      events: "事件订阅",
      description: "项目介绍",
    };
    const items: Crumb[] = [
      { label: "我的项目", to: "/projects" },
      { label: project.name, to: `/projects/${project.id}` },
    ];
    const credentialMatch = path.match(
      /^\/projects\/[1-9]\d*\/(integrations|remote-hosts)(?:\/([1-9]\d*))?$/,
    );
    const jobMatch = path.match(
      /^\/projects\/[1-9]\d*\/jobs(?:\/(new|[1-9]\d*)(?:\/runs\/([1-9]\d*))?)?\/?$/,
    );
    if (credentialMatch) {
      const [, section, objectId] = credentialMatch;
      const sectionPath = `/projects/${project.id}/${section}`;
      items.push({
        label: section === "integrations" ? "项目服务连接" : "项目 SSH 凭证",
        ...(objectId ? { to: sectionPath } : {}),
      });
      if (objectId)
        items.push({
          label: section === "integrations" ? "连接详情" : "主机详情",
        });
    } else if (jobMatch) {
      const [, jobId, runId] = jobMatch;
      const jobsPath = `/projects/${project.id}/jobs`;
      items.push({ label: labels.jobs, ...(jobId ? { to: jobsPath } : {}) });
      if (jobId === "new") {
        items.push({ label: "创建作业" });
      } else if (jobId) {
        const editing = new URLSearchParams(search).get("edit") === "1";
        if (runId || editing)
          items.push({ label: "作业详情", to: `${jobsPath}/${jobId}` });
        items.push({
          label: runId ? `运行 #${runId}` : editing ? "编辑作业" : "作业详情",
        });
      }
    } else if (path.includes("/dingtalk")) {
      items.push({
        label: "钉钉机器人",
        to: `/projects/${project.id}/dingtalk`,
      });
    } else if (path.endsWith("/description/edit")) {
      items.push(
        {
          label: "项目介绍",
          to: `/projects/${project.id}?tab=description`,
        },
        { label: "编辑项目介绍" },
      );
    } else if (view?.page === "settings") {
      items.push({ label: projectSectionLabels[view.section] });
    } else if (view && view.page !== "overview") {
      items.push({ label: labels[view.page] ?? "项目总览" });
    }
    return items;
  }
  const names: Record<string, string> = {
    "/agents/catalog": "助手",
    "/projects": "我的项目",
    "/teams": "我的团队",
  };
  return [{ label: "工作区", to: "/home" }, { label: names[path] ?? "页面" }];
}
