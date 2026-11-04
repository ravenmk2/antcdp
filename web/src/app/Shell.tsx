import { Breadcrumbs } from "./Breadcrumbs";
import { RecentResources, RecentResourceTracker } from "./recent-resources";
import {
  ProjectNavigation,
  projectRouteContext,
  projectSection,
} from "@/features/collaboration/ProjectNavigation";
import type { Resource } from "@/shared/collaboration";
import {
  NavigationGuard,
  useNavigateAfterSave,
} from "@/components/platform/navigation-guard";
import { useEffect, useRef, useState } from "react";
import {
  Link,
  NavLink,
  Outlet,
  useLoaderData,
  useLocation,
  useMatches,
  useRevalidator,
} from "react-router";
import {
  ArrowRight,
  Home,
  Users,
  Folder,
  Menu,
  Moon,
  Sun,
  Monitor,
  LogOut,
  ChevronDown,
  LayoutDashboard,
  Settings,
  ScrollText,
  PanelLeftClose,
  PanelLeftOpen,
  UserRound,
  Palette,
  Cable,
  Server,
  Mail,
  MessageSquare,
  Bot,
} from "lucide-react";
import {
  PinnedResources,
  ShortcutsProvider,
  ShortcutGroups,
  ShortcutFeedback,
} from "@/features/collaboration/Shortcuts";
import { IdentityContext, type Identity } from "./identity";
import { useAppearance } from "./appearance";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetDescription,
  SheetHeader,
} from "@/components/ui/sheet";
import { Avatar } from "@/components/platform/avatar";
import { FormDialog } from "@/components/platform/form-dialog";
import { ErrorBox } from "@/components/platform/feedback";
import { api, errorMessage, resetCSRF } from "@/lib/api";
import { appHref } from "@/lib/navigation";

export function Shell() {
  const identity = useLoaderData() as Identity;
  const location = useLocation();
  const matches = useMatches();
  const projectContext = projectRouteContext(
    location.pathname,
    (matches.at(-1)?.loaderData || {}) as {
      resource?: Resource;
      project?: Resource;
    },
    identity.session.user.role === "admin",
  );
  const revalidator = useRevalidator();
  const { appearance, setAppearance } = useAppearance();
  const [menu, setMenu] = useState(false);
  const [logoutOpen, setLogoutOpen] = useState(false);
  const siteName = identity.settings.site_name;
  const logoSize = siteName ? "size-10" : "size-8";
  useEffect(() => {
    const visible = () => {
      if (
        document.visibilityState === "visible" &&
        revalidator.state === "idle"
      )
        void revalidator.revalidate();
    };
    document.addEventListener("visibilitychange", visible);
    return () => document.removeEventListener("visibilitychange", visible);
  }, [revalidator]);

  const consoleMode = location.pathname.startsWith("/admin");
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem("antcdp.sidebar-collapsed") === "true";
    } catch {
      return false;
    }
  });
  function toggleSidebar() {
    setCollapsed(!collapsed);
    try {
      localStorage.setItem("antcdp.sidebar-collapsed", String(!collapsed));
    } catch {
      /* Local preference is optional. */
    }
  }
  const accountNavigation = useRef<"pointer" | "keyboard" | null>(null);
  function followAccountLink(event: React.MouseEvent<HTMLAnchorElement>) {
    if (
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    )
      return;
    accountNavigation.current = event.detail ? "pointer" : "keyboard";
    setMenu(false);
  }
  const nav = (compact: boolean, mobile = false) => (
    <div className="flex h-full flex-col">
      <div
        className={`mb-5 flex min-h-12 items-center gap-1 ${compact ? "justify-center" : "justify-between"}`}
      >
        {!compact && (
          <Link
            to="/home"
            onClick={() => setMenu(false)}
            aria-label="AntCDP 首页"
            title="返回工作区"
            className={
              "flex min-h-12 min-w-0 items-center gap-2 px-2 " +
              (mobile ? "pr-7" : "")
            }
          >
            <img
              src="/logo.svg"
              className={`${logoSize} shrink-0 dark:hidden`}
              alt=""
            />
            <img
              src="/logo-inverse.svg"
              className={`hidden ${logoSize} shrink-0 dark:block`}
              alt=""
            />
            <span className={compact ? "sr-only" : "min-w-0"}>
              <span
                className={`block font-semibold tracking-tight ${siteName ? "text-lg" : "text-2xl"}`}
              >
                AntCDP
              </span>
              {siteName && siteName !== "AntCDP" && (
                <span
                  className="block truncate text-[13px] text-muted-foreground"
                  title={siteName}
                >
                  {siteName}
                </span>
              )}
            </span>
          </Link>
        )}
        {!mobile && (
          <Button
            size="icon"
            variant="ghost"
            className="size-11 shrink-0 text-muted-foreground hover:text-foreground"
            aria-expanded={!collapsed}
            aria-controls="desktop-sidebar"
            aria-label={collapsed ? "展开侧栏" : "收起侧栏"}
            title={collapsed ? "展开侧栏" : "收起侧栏"}
            onClick={toggleSidebar}
          >
            {collapsed ? (
              <PanelLeftOpen className="size-[18px]" />
            ) : (
              <PanelLeftClose className="size-[18px]" />
            )}
          </Button>
        )}
      </div>
      <nav className="space-y-1" aria-label="主导航">
        {(consoleMode
          ? [
              {
                label: "概览",
                items: [
                  {
                    to: "/admin",
                    label: "系统概览",
                    Icon: LayoutDashboard,
                    end: true,
                  },
                ],
              },
              {
                label: "组织与协作",
                items: [
                  { to: "/admin/projects", label: "项目管理", Icon: Folder },
                  { to: "/admin/teams", label: "团队管理", Icon: Users },
                  { to: "/admin/users", label: "用户管理", Icon: UserRound },
                ],
              },
              {
                label: "服务与连接",
                items: [
                  { to: "/admin/integrations", label: "服务集成", Icon: Cable },
                  {
                    to: "/admin/remote-hosts",
                    label: "远程主机",
                    Icon: Server,
                  },
                  { to: "/admin/email", label: "邮件", Icon: Mail },
                  { to: "/admin/sms", label: "短信", Icon: MessageSquare },
                  { to: "/admin/dingtalk", label: "钉钉机器人", Icon: Bot },
                ],
              },
              {
                label: "平台维护",
                items: [
                  { to: "/admin/settings", label: "系统设置", Icon: Settings },
                  { to: "/admin/audit", label: "审计日志", Icon: ScrollText },
                ],
              },
            ]
          : [
              {
                label: "工作区",
                items: [
                  { to: "/home", label: "首页", Icon: Home, end: true },
                  { to: "/projects", label: "我的项目", Icon: Folder },
                  { to: "/teams", label: "我的团队", Icon: Users },
                ],
              },
            ]
        ).map((group, index) => (
          <div key={group.label} className={index ? "mt-4 border-t pt-3" : ""}>
            {consoleMode && index > 0 && (
              <p
                className={
                  compact
                    ? "sr-only"
                    : "mb-1 px-3 text-[13px] font-medium text-muted-foreground"
                }
              >
                {group.label}
              </p>
            )}
            {group.items.map(({ to, label, Icon, ...item }) => (
              <NavLink
                key={to}
                to={to}
                title={label}
                aria-label={label}
                end={"end" in item && item.end}
                onClick={() => setMenu(false)}
                className={`sidebar-link flex min-h-12 items-center gap-3 rounded-lg px-3 py-2.5 text-sm ${compact ? "justify-center" : ""}`}
              >
                <Icon className="size-[19px] shrink-0" />
                {!compact && label}
              </NavLink>
            ))}
          </div>
        ))}
      </nav>
      {!consoleMode && (
        <ShortcutGroups
          kinds={["projects"]}
          compact={compact}
          onNavigate={() => setMenu(false)}
        />
      )}
      <div className="mt-auto border-t pt-3">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              aria-label={`用户菜单，${identity.session.user.display_name}，@${identity.session.user.username}`}
              title={`${identity.session.user.display_name} · @${identity.session.user.username}`}
              className="sidebar-account h-auto w-full justify-center px-2 py-2.5"
            >
              <Avatar
                url={identity.session.user.avatar?.url}
                name={identity.session.user.display_name}
              />
              <span
                className={
                  compact
                    ? "sr-only"
                    : "min-w-0 flex-1 truncate text-left text-sm"
                }
              >
                {identity.session.user.display_name}
                <span className="block text-[13px] font-normal text-muted-foreground">
                  @{identity.session.user.username}
                </span>
              </span>
              {!compact && <ChevronDown className="size-4" />}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            side="top"
            sideOffset={8}
            className="account-popup w-64 p-2"
            onCloseAutoFocus={(event) => {
              const source = accountNavigation.current;
              accountNavigation.current = null;
              if (!source) return;
              event.preventDefault();
              document.getElementById("main-content")?.focus({
                preventScroll: true,
                focusVisible: source === "keyboard",
              });
            }}
          >
            <DropdownMenuItem asChild>
              <Link to="/account" onClick={followAccountLink}>
                <UserRound />
                个人设置
              </Link>
            </DropdownMenuItem>
            {identity.session.user.role === "admin" && (
              <DropdownMenuItem asChild>
                <Link
                  to={consoleMode ? "/home" : "/admin"}
                  onClick={followAccountLink}
                >
                  {consoleMode ? <Home /> : <LayoutDashboard />}
                  {consoleMode ? "返回工作区" : "打开控制台"}
                </Link>
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <Palette />
                外观
                <span className="ml-auto text-[13px] text-muted-foreground">
                  {
                    { light: "浅色", dark: "深色", system: "跟随系统" }[
                      appearance
                    ]
                  }
                </span>
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {[
                  ["light", "浅色", Sun],
                  ["dark", "深色", Moon],
                  ["system", "跟随系统", Monitor],
                ].map(([value, label, Icon]) => {
                  const AppearanceIcon = Icon as typeof Sun;
                  return (
                    <DropdownMenuItem
                      key={value as string}
                      onSelect={() => setAppearance(value as string)}
                    >
                      <AppearanceIcon className="size-4" />
                      {label as string}
                      {appearance === value && (
                        <span className="ml-auto">✓</span>
                      )}
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuItem onSelect={() => setLogoutOpen(true)}>
              <LogOut className="size-4" />
              退出登录
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
  return (
    <IdentityContext value={identity}>
      <NavigationGuard key={identity.session.user.id}>
        <ShortcutsProvider>
          <RecentResourceTracker user={identity.session.user.id} />
          <div
            className={
              "min-h-dvh md:grid " +
              (collapsed
                ? "md:grid-cols-[68px_minmax(0,1fr)]"
                : "md:grid-cols-[248px_minmax(0,1fr)]")
            }
          >
            <a
              href="#main-content"
              onClick={(event) => {
                event.preventDefault();
                document.getElementById("main-content")?.focus();
              }}
              className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-card focus:p-3"
            >
              跳至正文
            </a>
            <aside
              id="desktop-sidebar"
              className={
                "sticky top-0 hidden h-dvh overflow-y-auto border-r bg-[var(--sidebar)] py-4 md:block " +
                (collapsed ? "px-2" : "px-4")
              }
            >
              {nav(collapsed)}
            </aside>
            <div className="project-shell-container">
              {projectContext ? (
                <ProjectNavigation
                  key={projectContext.project.id + ":" + projectContext.admin}
                  project={projectContext.project}
                  admin={projectContext.admin}
                  active={projectSection(location.pathname, location.search)}
                  mobileTrigger={
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-11 shrink-0 text-muted-foreground md:hidden"
                      aria-label="打开导航"
                      onClick={() => setMenu(true)}
                    >
                      <Menu className="size-[18px]" />
                    </Button>
                  }
                />
              ) : (
                <header className="flex h-12 items-center gap-2 border-b border-border/70 bg-background px-5 md:px-8 2xl:px-10">
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-11 text-muted-foreground hover:text-foreground md:hidden"
                    aria-label="打开导航"
                    onClick={() => setMenu(true)}
                  >
                    <Menu className="size-[18px]" />
                  </Button>
                  <Breadcrumbs
                    user={identity.session.user.id}
                    siteName={siteName}
                  />
                </header>
              )}
              <main
                id="main-content"
                tabIndex={-1}
                className="min-w-0 w-full p-5 md:p-8 2xl:px-10"
              >
                {projectContext && (
                  <Breadcrumbs
                    user={identity.session.user.id}
                    siteName={siteName}
                    mode="project"
                  />
                )}
                <ShortcutFeedback />
                <Outlet />
              </main>
            </div>
          </div>
          <Sheet open={menu} onOpenChange={setMenu}>
            <SheetContent
              side="left"
              className="w-72 overflow-y-auto bg-[var(--sidebar)] p-5"
            >
              <SheetHeader className="sr-only">
                <SheetTitle>主导航</SheetTitle>
                <SheetDescription>页面导航与账号设置</SheetDescription>
              </SheetHeader>
              {nav(false, true)}
            </SheetContent>
          </Sheet>
          {logoutOpen && <LogoutDialog onClose={() => setLogoutOpen(false)} />}
        </ShortcutsProvider>
      </NavigationGuard>
    </IdentityContext>
  );
}

function LogoutDialog({ onClose }: { onClose: () => void }) {
  const [pending, setPending] = useState(false),
    [error, setError] = useState("");
  const locked = useRef(false),
    afterSave = useNavigateAfterSave();
  async function logout() {
    if (locked.current) return;
    locked.current = true;
    setPending(true);
    setError("");
    try {
      await api("/auth/logout", {});
      resetCSRF();
      afterSave(appHref("/login"));
    } catch (e) {
      setError(errorMessage(e));
      locked.current = false;
      setPending(false);
    }
  }
  return (
    <FormDialog
      compact
      open
      title="退出登录"
      description="退出后需要重新登录；未保存的修改不会保留。"
      pending={pending}
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" disabled={pending} onClick={onClose}>
            取消
          </Button>
          <Button disabled={pending} onClick={() => void logout()}>
            {pending ? "正在退出…" : "退出登录"}
          </Button>
        </>
      }
    >
      <ErrorBox>{error}</ErrorBox>
    </FormDialog>
  );
}

export function HomePage() {
  const identity = useLoaderData() as Identity;
  return (
    <div className="max-w-[var(--overview-max-width)]">
      <div
        className="mb-5 h-1 w-9 rounded-full bg-[var(--brand)]"
        aria-hidden="true"
      />
      <h1 className="break-words text-2xl font-semibold tracking-tight">
        欢迎回来，{identity.session.user.display_name}。
      </h1>

      <p className="mt-2 text-sm text-muted-foreground">
        继续最近访问的项目，或从侧栏进入你的协作空间。
      </p>
      <div className="mt-8 grid items-start gap-8 xl:grid-cols-[minmax(0,1fr)_280px]">
        <div className="min-w-0">
          <RecentResources
            key={identity.session.user.id}
            user={identity.session.user.id}
          />
          <PinnedResources />
        </div>
        <aside className="space-y-4 border-t pt-6 xl:border-t-0 xl:border-l xl:pt-0 xl:pl-6">
          <h2 className="font-semibold">开始协作</h2>
          <p className="text-sm leading-6 text-muted-foreground">
            项目承载仓库、环境与发布；团队用来组织成员和项目访问。
          </p>
          <Link
            to="/teams"
            className="flex items-center gap-2 text-sm hover:underline"
          >
            查看我的团队
            <ArrowRight className="size-4" />
          </Link>
          {identity.session.user.role !== "admin" && (
            <p className="border-t pt-4 text-sm leading-6 text-muted-foreground">
              还没有参与的项目？请联系项目或团队管理员加入。
            </p>
          )}
        </aside>
      </div>
      {import.meta.env.DEV && (
        <Link to="/components" className="mt-8 inline-block text-sm underline">
          组件状态展示
        </Link>
      )}
      <a className="sr-only" href={appHref("/home")}>
        当前首页
      </a>
    </div>
  );
}
