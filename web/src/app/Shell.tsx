import { useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router";
import { DropdownMenu } from "radix-ui";
import {
  Bell,
  Bot,
  Cable,
  Check,
  ChevronDown,
  ChevronRight,
  FileClock,
  Folder,
  GitBranch,
  GitCompare,
  Home,
  LayoutDashboard,
  LogOut,
  Mail,
  Menu,
  MessageSquare,
  Monitor,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Rocket,
  ScrollText,
  Server,
  Settings,
  Shield,
  Star,
  Sun,
  UserRound,
  Users,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { api, resetCSRF } from "@/api/client";
import { useAuth, useSession } from "./auth";
import { appearanceLabels, useTheme, type Appearance } from "./theme";
import { Avatar, ResourceIcon } from "@/components/resource-icon";
import { Button, IconButton } from "@/components/button";
import { Breadcrumbs, type Crumb } from "@/components/layout";
import { ConfirmDialog, Drawer, Modal } from "@/components/overlays";
import { ErrorNotice, Notice, StatusBadge } from "@/components/feedback";
import { useApiQuery } from "@/hooks/use-api";
import { useSubmission } from "@/hooks/use-form";
import type { Page, Resource, Shortcuts } from "@/types/collaboration";
import { ShortcutEditor } from "@/features/workspace/shortcuts";
import { ProjectSwitcher } from "./project-switcher";

const consoleGroups = [
  {
    label: "全局管理",
    items: [
      { to: "/admin", label: "系统概览", icon: LayoutDashboard, end: true },
      { to: "/admin/users", label: "用户管理", icon: UserRound },
      { to: "/admin/projects", label: "项目管理", icon: Folder },
      { to: "/admin/teams", label: "团队管理", icon: Users },
    ],
  },
  {
    label: "连接与资源",
    items: [
      { to: "/admin/integrations", label: "服务集成", icon: Cable },
      { to: "/admin/remote-hosts", label: "远程主机", icon: Server },
    ],
  },
  {
    label: "消息与系统",
    items: [
      { to: "/admin/email", label: "邮件管理", icon: Mail },
      { to: "/admin/sms", label: "短信管理", icon: MessageSquare },
      { to: "/admin/dingtalk", label: "钉钉机器人", icon: Bot },
      { to: "/admin/audit", label: "审计日志", icon: ScrollText },
      { to: "/admin/settings", label: "系统设置", icon: Settings },
      { to: "/admin/maintenance", label: "临时文件", icon: FileClock },
    ],
  },
];
const workspaceItems = [
  { to: "/home", label: "首页", icon: Home, end: true },
  { to: "/projects", label: "我的项目", icon: Folder },
  { to: "/teams", label: "我的团队", icon: Users },
];

export function AppShell() {
  const session = useSession();
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { appearance, setAppearance, cycle, resolved } = useTheme();
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem("antcdp.sidebar-collapsed") === "true";
    } catch {
      return false;
    }
  });
  const [mobile, setMobile] = useState(false);
  const [messages, setMessages] = useState(false);
  const [logout, setLogout] = useState(false);
  const [shortcutKind, setShortcutKind] = useState<"projects" | "teams" | null>(
    null,
  );
  const submission = useSubmission();
  const consoleMode =
    location.pathname.startsWith("/admin") && session.user.role === "admin";
  const teamId = location.pathname.match(
    /^\/admin\/teams\/([1-9]\d*)(?:\/|$)/,
  )?.[1];
  const team = useApiQuery<Resource>(
    ["team", teamId],
    `/teams/${teamId ?? ""}`,
    { enabled: Boolean(teamId && consoleMode) },
  );
  const projectMatch = location.pathname.match(/^\/projects\/([1-9]\d*)/);
  const projectId = projectMatch?.[1];
  const project = useApiQuery<Resource>(
    ["project", projectId],
    `/projects/${projectId ?? ""}`,
    { enabled: Boolean(projectId) },
  );
  const shortcuts = useApiQuery<Shortcuts>(
    ["shortcuts", session.user.id],
    "/me/sidebar-shortcuts",
  );
  const { settings } = useAuth();
  const projectDirectory = useApiQuery<Page<Resource>>(
    ["project-switcher", session.user.id],
    "/projects?scope=mine&status=all&page=1&page_size=100",
    { enabled: Boolean(projectId) },
  );
  const brand = settings.site_name || "AntCDP";
  const documentTitle =
    projectId && project.data
      ? `${project.data.data.name} · ${brand}`
      : consoleMode
        ? `控制台 · ${brand}`
        : brand;
  document.title = documentTitle;

  function toggleCollapsed() {
    setCollapsed((current) => {
      try {
        localStorage.setItem("antcdp.sidebar-collapsed", String(!current));
      } catch {}
      return !current;
    });
  }
  async function confirmLogout() {
    const ok = await submission.run(async () => {
      await api("/auth/logout", {});
      resetCSRF();
      queryClient.clear();
      window.location.replace("/login");
    });
    if (!ok) setLogout(true);
  }
  const navigation = (compact: boolean, close?: () => void) => (
    <div className="sidebar-navigation" data-compact={compact}>
      <div className="flex h-16 shrink-0 items-center gap-2 border-b px-4">
        <Link
          to="/home"
          className="sidebar-brand flex min-w-0 items-center gap-2"
          aria-hidden={compact}
          tabIndex={compact ? -1 : undefined}
          onClick={close}
        >
          <img src="/logo.svg" alt="" className="size-[30px] dark:hidden" />
          <img
            src="/logo-inverse.svg"
            alt=""
            className="hidden size-[30px] dark:block"
          />
          <span className="min-w-0">
            <strong className="block text-[17px]">AntCDP</strong>
            {brand !== "AntCDP" && (
              <small className="block truncate text-[11px] text-muted">
                {brand}
              </small>
            )}
          </span>
          <small className="rounded border px-1 py-0.5 text-[9px] font-medium text-faint">
            {consoleMode ? "CONSOLE" : "TEAM"}
          </small>
        </Link>
        {!close && (
          <IconButton
            size="iconSm"
            className="ml-auto"
            label={collapsed ? "展开侧栏" : "收起侧栏"}
            onClick={toggleCollapsed}
          >
            {collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
          </IconButton>
        )}
        {close && (
          <IconButton label="关闭导航" onClick={close}>
            <Menu />
          </IconButton>
        )}
      </div>
      <div className="sidebar-scroll">
        {!consoleMode && projectId && project.data && (
          <ProjectSwitcher
            project={project.data.data}
            directory={projectDirectory.data?.data.items}
            compact={compact}
            close={close}
          />
        )}
        <nav aria-label="主导航">
          {(consoleMode
            ? consoleGroups
            : [{ label: "个人工作区", items: workspaceItems }]
          ).map((group) => (
            <div key={group.label}>
              <div className="nav-label" aria-hidden={compact}>
                {group.label}
              </div>
              {group.items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={"end" in item && item.end}
                  title={item.label}
                  aria-label={item.label}
                  className="nav-link"
                  onClick={close}
                >
                  <item.icon className="size-[18px] shrink-0" />
                  <span className="sidebar-label" aria-hidden={compact}>
                    {item.label}
                  </span>
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
        {!consoleMode && projectId && project.data && (
          <div>
            <div className="nav-label" aria-hidden={compact}>
              当前项目
            </div>
            {[
              {
                label: "项目总览",
                to: `/projects/${projectId}`,
                icon: LayoutDashboard,
              },
              {
                label: "发布管理",
                to: `/projects/${projectId}?tab=releases`,
                icon: Rocket,
              },
              {
                label: "产品分支",
                to: `/projects/${projectId}/variants`,
                icon: GitBranch,
              },
              {
                label: "Git 仓库",
                to: `/projects/${projectId}?tab=repositories`,
                icon: GitCompare,
              },
              {
                label: "成员与团队",
                to: `/projects/${projectId}?tab=members`,
                icon: Users,
              },
              {
                label: "项目设置",
                to: `/projects/${projectId}?tab=settings`,
                icon: Settings,
              },
            ].map(({ label, to, icon: Icon }) => {
              const active =
                to === `/projects/${projectId}`
                  ? location.pathname === `/projects/${projectId}` &&
                    !new URLSearchParams(location.search).has("tab")
                  : to.includes("?")
                    ? new URLSearchParams(location.search).get("tab") ===
                      new URLSearchParams(to.split("?")[1]).get("tab")
                    : location.pathname.startsWith(to);
              return (
                <Link
                  key={label}
                  to={to}
                  title={label}
                  aria-label={label}
                  aria-current={active ? "page" : undefined}
                  className="nav-link"
                  onClick={close}
                >
                  <Icon className="size-[18px] shrink-0" />
                  <span className="sidebar-label" aria-hidden={compact}>
                    {label}
                  </span>
                </Link>
              );
            })}
          </div>
        )}
        {!consoleMode && (
          <div>
            <div className="flex items-center justify-between">
              <span className="nav-label sidebar-label" aria-hidden={compact}>
                关注项目
              </span>
              <IconButton
                size="iconSm"
                className="shortcut-manage mr-3"
                label="管理关注项目"
                onClick={() => setShortcutKind("projects")}
              >
                <Star />
              </IconButton>
            </div>
            {shortcuts.isError ? (
              <div className="px-5 text-xs text-warning">
                关注项目加载失败{" "}
                <button
                  className="underline"
                  onClick={() => void shortcuts.refetch()}
                >
                  重试
                </button>
              </div>
            ) : (
              shortcuts.data?.data.projects.items.map((item) => (
                <Link
                  key={item.id}
                  to={`/projects/${item.id}`}
                  className="nav-link"
                  title={item.name}
                  onClick={close}
                >
                  <ResourceIcon
                    resource={item}
                    className="size-5 rounded-sm border-0 bg-transparent"
                  />
                  <span
                    className="sidebar-label min-w-0 flex-1 truncate"
                    aria-hidden={compact}
                  >
                    {item.name}
                  </span>
                  {item.status === "archived" && (
                    <span
                      className="sidebar-label text-[10px] text-muted"
                      aria-hidden={compact}
                    >
                      归档
                    </span>
                  )}
                </Link>
              ))
            )}
          </div>
        )}
      </div>
      <div className="border-t p-3">
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button
              className="sidebar-user flex w-full items-center gap-2 rounded-lg p-2 text-left hover:bg-surface-hover"
              aria-label={`用户菜单，${session.user.display_name}`}
            >
              <Avatar
                url={session.user.avatar?.url}
                name={session.user.display_name}
              />
              <span
                className="sidebar-label min-w-0 flex-1"
                aria-hidden={compact}
              >
                <strong className="block truncate text-xs">
                  {session.user.display_name}
                </strong>
                <small className="block truncate text-[11px] text-muted">
                  @{session.user.username}
                </small>
              </span>
              <ChevronDown
                className="sidebar-label size-4 text-muted"
                aria-hidden
              />
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              side="top"
              align="start"
              sideOffset={8}
              className="z-50 w-72 rounded-xl border bg-popover p-2 text-popover-foreground shadow-xl"
            >
              <div className="mb-2 flex items-center gap-3 rounded-lg bg-surface-subtle p-3">
                <Avatar
                  url={session.user.avatar?.url}
                  name={session.user.display_name}
                  className="size-11"
                />
                <div className="min-w-0">
                  <strong className="block truncate">
                    {session.user.display_name}
                  </strong>
                  <small className="text-muted">@{session.user.username}</small>
                </div>
                <StatusBadge tone="info">
                  {session.user.is_founder
                    ? "创始人"
                    : session.user.role === "admin"
                      ? "管理员"
                      : "普通用户"}
                </StatusBadge>
              </div>
              <MenuLink to="/account" icon={UserRound} label="个人设置" />
              {session.user.role === "admin" && (
                <MenuLink
                  to={consoleMode ? "/home" : "/admin"}
                  icon={consoleMode ? Home : Shield}
                  label={consoleMode ? "返回工作区" : "控制台"}
                />
              )}
              <DropdownMenu.Sub>
                <DropdownMenu.SubTrigger className="flex min-h-10 items-center gap-2 rounded-lg px-3 text-sm outline-none focus:bg-surface-hover data-[state=open]:bg-surface-hover">
                  {appearance === "light" ? (
                    <Sun className="size-4" aria-hidden />
                  ) : appearance === "dark" ? (
                    <Moon className="size-4" aria-hidden />
                  ) : (
                    <Monitor className="size-4" aria-hidden />
                  )}
                  <span>外观</span>
                  <span className="ml-auto text-xs text-muted">
                    {appearanceLabels[appearance]}
                  </span>
                  <ChevronRight className="size-4 text-muted" aria-hidden />
                </DropdownMenu.SubTrigger>
                <DropdownMenu.Portal>
                  <DropdownMenu.SubContent
                    sideOffset={6}
                    collisionPadding={8}
                    className="z-50 min-w-40 rounded-xl border bg-popover p-1 text-popover-foreground shadow-xl"
                  >
                    <DropdownMenu.RadioGroup
                      value={appearance}
                      onValueChange={(value) =>
                        setAppearance(value as Appearance)
                      }
                      aria-label="外观"
                    >
                      {(["light", "dark", "system"] as Appearance[]).map(
                        (value) => (
                          <DropdownMenu.RadioItem
                            key={value}
                            value={value}
                            className="flex min-h-10 items-center gap-2 rounded-lg px-3 text-sm outline-none focus:bg-surface-hover"
                          >
                            {value === "light" ? (
                              <Sun className="size-4" aria-hidden />
                            ) : value === "dark" ? (
                              <Moon className="size-4" aria-hidden />
                            ) : (
                              <Monitor className="size-4" aria-hidden />
                            )}
                            {appearanceLabels[value]}
                            <span className="ml-auto size-4">
                              <DropdownMenu.ItemIndicator>
                                <Check className="size-4" aria-hidden />
                              </DropdownMenu.ItemIndicator>
                            </span>
                          </DropdownMenu.RadioItem>
                        ),
                      )}
                    </DropdownMenu.RadioGroup>
                  </DropdownMenu.SubContent>
                </DropdownMenu.Portal>
              </DropdownMenu.Sub>
              <DropdownMenu.Separator className="my-2 h-px bg-border" />
              <DropdownMenu.Item
                className="flex min-h-10 items-center gap-2 rounded-lg px-3 text-sm outline-none focus:bg-surface-hover"
                onSelect={() => setLogout(true)}
              >
                <LogOut className="size-4" />
                退出登录
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>
    </div>
  );
  const crumbs = breadcrumbs(
    location.pathname,
    project.data?.data,
    consoleMode,
    team.data?.data.name,
  );
  return (
    <div className="app-layout" data-collapsed={collapsed}>
      <a
        href="#main-content"
        className="sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[100] focus:not-sr-only focus:rounded-lg focus:bg-surface focus:p-3"
      >
        跳至正文
      </a>
      <aside className="sidebar">{navigation(collapsed)}</aside>
      <div className="min-w-0">
        <header className="topbar">
          <div className="flex min-w-0 items-center gap-2">
            <IconButton
              className="min-[821px]:hidden"
              label="打开导航"
              onClick={() => setMobile(true)}
            >
              <Menu />
            </IconButton>
            <Breadcrumbs items={crumbs} />
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {consoleMode && (
              <IconButton label="返回工作区" onClick={() => navigate("/home")}>
                <Home />
              </IconButton>
            )}
            <DropdownMenu.Root>
              <DropdownMenu.Trigger asChild>
                <IconButton label="快速创建">
                  <Plus />
                </IconButton>
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content
                  align="end"
                  className="z-50 min-w-48 rounded-lg border bg-popover p-1 shadow-xl"
                >
                  {session.user.role === "admin" && (
                    <>
                      <MenuLink
                        to="/admin/projects?create=1"
                        icon={Folder}
                        label="创建项目"
                      />
                      <MenuLink
                        to="/admin/teams?create=1"
                        icon={Users}
                        label="创建团队"
                      />
                    </>
                  )}
                  {projectId && (
                    <MenuLink
                      to={`/projects/${projectId}?tab=releases&create=1`}
                      icon={Rocket}
                      label="创建发布"
                    />
                  )}
                  {!projectId && session.user.role !== "admin" && (
                    <div className="px-3 py-2 text-xs text-muted">
                      进入项目后可创建发布
                    </div>
                  )}
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
            <IconButton
              label={`外观：${appearanceLabels[appearance]}，点击切换`}
              title={`外观：${appearanceLabels[appearance]}`}
              onClick={cycle}
            >
              {resolved === "dark" ? (
                <Moon />
              ) : appearance === "system" ? (
                <Monitor />
              ) : (
                <Sun />
              )}
            </IconButton>
            <IconButton
              label="消息（预留能力）"
              onClick={() => setMessages(true)}
            >
              <Bell />
            </IconButton>
          </div>
        </header>
        <main id="main-content" tabIndex={-1}>
          <Outlet />
        </main>
      </div>
      <Drawer open={mobile} title="页面导航" onClose={() => setMobile(false)}>
        {navigation(false, () => setMobile(false))}
      </Drawer>
      <Modal
        open={messages}
        title="消息"
        description="此入口为后续能力预留。"
        onClose={() => setMessages(false)}
        footer={<Button onClick={() => setMessages(false)}>知道了</Button>}
      >
        <Notice>当前没有站内消息或未读通知。项目关注不会自动开启通知。</Notice>
      </Modal>
      {shortcutKind && shortcuts.data && (
        <ShortcutEditor
          kind={shortcutKind}
          initial={shortcuts.data.data}
          onClose={() => setShortcutKind(null)}
        />
      )}
      <ConfirmDialog
        open={logout}
        title="确认退出登录"
        description="退出后需要重新登录；未保存的修改不会保留。"
        confirmLabel="退出登录"
        pending={submission.pending}
        onClose={() => setLogout(false)}
        onConfirm={() => void confirmLogout()}
      >
        <ErrorNotice error={submission.error} />
      </ConfirmDialog>
    </div>
  );
}

function MenuLink({
  to,
  icon: Icon,
  label,
  description,
}: {
  to: string;
  icon: typeof Home;
  label: string;
  description?: string;
}) {
  return (
    <DropdownMenu.Item
      asChild
      className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-3 text-sm outline-none focus:bg-surface-hover"
    >
      <Link to={to}>
        <Icon className="size-4 shrink-0 text-muted" />
        <span className="min-w-0 flex-1">
          <strong className="block text-[13px] font-medium">{label}</strong>
          {description && (
            <small className="mt-0.5 block text-[11px] text-muted">
              {description}
            </small>
          )}
        </span>
      </Link>
    </DropdownMenu.Item>
  );
}

function breadcrumbs(
  path: string,
  project: Resource | undefined,
  consoleMode: boolean,
  teamName?: string,
): Crumb[] {
  if (path === "/home") return [{ label: "工作区" }, { label: "首页" }];
  if (path.startsWith("/account"))
    return [{ label: "工作区", to: "/home" }, { label: "个人设置" }];
  if (path.startsWith("/teams/"))
    return [{ label: "我的团队", to: "/teams" }, { label: "团队详情" }];
  if (project) {
    const tab = new URLSearchParams(location.search).get("tab");
    const labels: Record<string, string> = {
      releases: "发布管理",
      repositories: "Git 仓库",
      members: "成员与团队",
      settings: "项目设置",
      description: "项目介绍",
    };
    const items: Crumb[] = [
      { label: "我的项目", to: "/projects" },
      { label: project.name, to: `/projects/${project.id}` },
    ];
    if (path.includes("/variants/"))
      items.push(
        { label: "产品分支", to: `/projects/${project.id}/variants` },
        { label: "产品分支详情" },
      );
    else if (path.endsWith("/variants")) items.push({ label: "产品分支" });
    else if (tab && labels[tab]) items.push({ label: labels[tab] });
    return items;
  }
  const names: Record<string, string> = {
    "/projects": "我的项目",
    "/teams": "我的团队",
    "/admin": "系统概览",
    "/admin/users": "用户管理",
    "/admin/projects": "项目管理",
    "/admin/teams": "团队管理",
    "/admin/integrations": "服务集成",
    "/admin/remote-hosts": "远程主机",
    "/admin/email": "邮件管理",
    "/admin/sms": "短信管理",
    "/admin/dingtalk": "钉钉机器人",
    "/admin/audit": "审计日志",
    "/admin/settings": "系统设置",
    "/admin/maintenance": "临时文件",
  };
  if (path.startsWith("/admin/projects/"))
    return [
      { label: "控制台", to: "/admin" },
      { label: "项目管理", to: "/admin/projects" },
      { label: "项目详情" },
    ];
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
      {
        label: "服务集成",
        to: consoleMode ? "/admin/integrations" : "/account/integrations",
      },
      { label: "连接详情" },
    ];
  if (path.includes("/remote-hosts/"))
    return [
      {
        label: "远程主机",
        to: consoleMode ? "/admin/remote-hosts" : "/account/remote-hosts",
      },
      { label: "主机详情" },
    ];
  return [
    {
      label: consoleMode ? "控制台" : "工作区",
      to: consoleMode ? "/admin" : "/home",
    },
    { label: names[path] ?? "页面" },
  ];
}
