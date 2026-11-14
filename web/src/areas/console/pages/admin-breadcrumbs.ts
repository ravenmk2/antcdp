import type { Crumb } from "@/components/layout";
import type { Resource } from "@/types/collaboration";

const names: Record<string, string> = {
  "/admin": "系统概览",
  "/admin/users": "真人用户",
  "/admin/robots": "机器人账号",
  "/admin/projects": "项目管理",
  "/admin/teams": "团队管理",
  "/admin/integrations": "服务集成",
  "/admin/remote-hosts": "远程主机",
  "/admin/models": "模型管理",
  "/admin/agents": "智能体管理",
  "/admin/agent-usage": "运行与用量",
  "/admin/web-access": "网络检索",
  "/admin/mcp-servers": "MCP 服务",
  "/admin/skills": "技能库",
  "/admin/cloud-computers": "云电脑",
  "/admin/email": "邮件配置",
  "/admin/sms": "短信管理",
  "/admin/dingtalk": "钉钉机器人",
  "/admin/audit": "审计日志",
  "/admin/settings": "系统设置",
};

export function adminBreadcrumbs(
  path: string,
  teamName?: string,
  adminProject?: Resource,
  mcpServerName?: string,
): Crumb[] {
  const mcpServerId = path.match(/^\/admin\/mcp-servers\/([1-9]\d*)\/?$/)?.[1];
  if (mcpServerId)
    return [
      { label: "控制台", to: "/admin" },
      { label: "MCP 服务", to: "/admin/mcp-servers" },
      {
        label: mcpServerName || "MCP 服务详情",
        to: "/admin/mcp-servers?edit=" + mcpServerId,
      },
      { label: "工具调试" },
    ];
  if (path.startsWith("/admin/cloud-computers/"))
    return [
      { label: "控制台", to: "/admin" },
      { label: "云电脑", to: "/admin/cloud-computers" },
      { label: path.endsWith("/settings") ? "连接与创建配置" : "云电脑详情" },
    ];
  const debug = path.match(/^\/admin\/agents\/([1-9]\d*)\/debug/);
  if (debug)
    return [
      { label: "控制台", to: "/admin" },
      { label: "智能体", to: `/admin/agents/${debug[1]}` },
      { label: "调试" },
    ];
  const agentResource = path.match(
    /^\/admin\/(agents|web-access|mcp-servers|skills)\/(new|settings|[1-9]\d*)(?:\/(prompt|upload|versions)\/?([1-9]\d*)?)?\/?$/,
  );
  if (agentResource) {
    const [, section, id, sub] = agentResource;
    return [
      { label: "控制台", to: "/admin" },
      { label: names[`/admin/${section}`], to: `/admin/${section}` },
      {
        label:
          id === "new"
            ? "新建"
            : id === "settings"
              ? section === "web-access"
                ? "检索设置"
                : "能力路由与限制"
              : section === "mcp-servers"
                ? "工具调试"
                : "配置详情",
        ...(sub ? { to: `/admin/${section}/${id}` } : {}),
      },
      ...(sub
        ? [
            {
              label: (
                {
                  prompt: "编辑系统提示",
                  upload: "上传技能版本",
                  versions: "版本详情",
                } as Record<string, string>
              )[sub],
            },
          ]
        : []),
    ];
  }
  if (/^\/admin\/models\/(new|[1-9]\d*)\/?$/.test(path)) {
    return [
      { label: "控制台", to: "/admin" },
      { label: "模型管理", to: "/admin/models" },
      {
        label: path.replace(/\/$/, "").endsWith("/new")
          ? "新建提供商"
          : "提供商详情",
      },
    ];
  }
  if (path.startsWith("/admin/email/")) {
    const [, , , section, id] = path.split("/");
    const label =
      (
        {
          profiles: "SMTP 配置",
          templates: "邮件模板",
          "send-logs": "发送日志",
        } as Record<string, string>
      )[section] ?? "邮件配置";
    return [
      { label: "控制台", to: "/admin" },
      { label: "邮件配置", to: "/admin/email" },
      { label, ...(id ? { to: `/admin/email/${section}` } : {}) },
      ...(id
        ? [
            {
              label:
                id === "new"
                  ? "创建模板"
                  : section === "profiles"
                    ? "配置详情"
                    : section === "templates"
                      ? "编辑模板"
                      : "发送记录",
            },
          ]
        : []),
    ];
  }
  const adminProjectMatch = path.match(
    /^\/admin\/projects\/([1-9]\d*)(?:\/(.*))?\/?$/,
  );
  if (adminProjectMatch) {
    const [, id, rawRemainder] = adminProjectMatch;
    const remainder = rawRemainder?.replace(/\/$/, "") ?? "";
    const projectPath = `/admin/projects/${id}`;
    const items: Crumb[] = [
      { label: "控制台", to: "/admin" },
      { label: "项目管理", to: "/admin/projects" },
      {
        label: adminProject?.name || "项目详情",
        ...(remainder ? { to: projectPath } : {}),
      },
    ];
    if (remainder === "description/edit") {
      items.push({ label: "编辑项目介绍" });
      return items;
    }
    const credentialMatch = remainder.match(
      /^(integrations|remote-hosts)(?:\/([1-9]\d*))?$/,
    );
    if (credentialMatch) {
      const [, section, objectId] = credentialMatch;
      const sectionPath = `${projectPath}/${section}`;
      items.push({
        label: section === "integrations" ? "项目服务凭证" : "项目 SSH 凭证",
        ...(objectId ? { to: sectionPath } : {}),
      });
      if (objectId)
        items.push({
          label: section === "integrations" ? "连接详情" : "主机详情",
        });
      return items;
    }
    return items;
  }
  if (/^\/admin\/teams\/[1-9]\d*\/description\/edit$/.test(path))
    return [
      { label: "控制台", to: "/admin" },
      { label: "团队管理", to: "/admin/teams" },
      { label: teamName || "团队", to: path.replace("/description/edit", "") },
      { label: "编辑描述" },
    ];
  if (path.startsWith("/admin/teams/"))
    return [
      { label: "控制台", to: "/admin" },
      { label: "团队管理", to: "/admin/teams" },
      { label: teamName || "团队" },
    ];
  if (path.includes("/integrations/"))
    return [
      { label: "服务集成", to: "/admin/integrations" },
      { label: "连接详情" },
    ];
  if (path.includes("/remote-hosts/"))
    return [
      { label: "远程主机", to: "/admin/remote-hosts" },
      { label: "主机详情" },
    ];
  return [{ label: "控制台", to: "/admin" }, { label: names[path] ?? "页面" }];
}
