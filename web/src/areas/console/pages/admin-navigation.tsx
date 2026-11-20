import { useCallback, useEffect, useId, useRef, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router";
import { Menu as DropdownMenu } from "@base-ui/react/menu";
import {
  Bot,
  Building2,
  Cable,
  BrainCircuit,
  ChevronDown,
  Folder,
  LayoutDashboard,
  Mail,
  MessageSquare,
  ScrollText,
  Server,
  Settings,
  UserRound,
  Users,
  Globe,
  BookOpen,
  ChartNoAxesCombined,
  Search,
  Box,
} from "lucide-react";
import {
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { Modal, OverlayCancelButton } from "@/components/overlays";
import { StandaloneInput } from "@/components/fields";
import { Button } from "@/components/button";

const overview = { to: "/admin", label: "系统概览", icon: LayoutDashboard };
const consoleGroups = [
  {
    id: "platform",
    label: "账号与组织",
    icon: Building2,
    items: [
      { to: "/admin/users", label: "用户管理", icon: UserRound },
      { to: "/admin/robots", label: "机器人账号", icon: Bot },
      { to: "/admin/teams", label: "团队管理", icon: Users },
      { to: "/admin/projects", label: "项目管理", icon: Folder },
    ],
  },
  {
    id: "agents",
    label: "助手与模型",
    icon: Bot,
    items: [
      { to: "/admin/agents", label: "助手管理", icon: Bot },
      {
        to: "/admin/agent-usage",
        label: "运行与用量",
        icon: ChartNoAxesCombined,
      },
      { to: "/admin/models", label: "模型管理", icon: BrainCircuit },
      { to: "/admin/skills", label: "技能库", icon: BookOpen },
      { to: "/admin/mcp-servers", label: "MCP 服务", icon: Cable },
      { to: "/admin/web-access", label: "网络检索", icon: Globe },
    ],
  },
  {
    id: "resources",
    label: "连接与环境",
    icon: Cable,
    items: [
      { to: "/admin/integrations", label: "服务集成", icon: Cable },
      { to: "/admin/remote-hosts", label: "远程主机", icon: Server },
      { to: "/admin/sandboxes", label: "沙箱配置", icon: Server },
      { to: "/admin/cloud-computers", label: "云电脑", icon: Box },
    ],
  },
  {
    id: "messages",
    label: "消息通知",
    icon: MessageSquare,
    items: [
      { to: "/admin/email", label: "邮件管理", icon: Mail },
      { to: "/admin/sms", label: "短信管理", icon: MessageSquare },
      { to: "/admin/dingtalk", label: "钉钉机器人", icon: Bot },
    ],
  },
  {
    id: "maintenance",
    label: "系统维护",
    icon: Settings,
    items: [
      { to: "/admin/audit", label: "审计日志", icon: ScrollText },
      { to: "/admin/settings", label: "系统设置", icon: Settings },
    ],
  },
];
const preferenceKey = "antcdp.admin-navigation-groups";
const menuItems = [
  { ...overview, group: "" },
  ...consoleGroups.flatMap((group) =>
    group.items.map((item) => ({ ...item, group: group.label })),
  ),
];
const searchKeywords: Record<string, string> = {
  "/admin/users": "真人用户",
  "/admin/remote-hosts": "ssh host",
  "/admin/models": "model provider llm",
  "/admin/web-access": "search fetch web",
  "/admin/mcp-servers": "mcp http",
  "/admin/skills": "skill skills zip",
  "/admin/agents": "agent",
  "/admin/agent-usage": "usage tokens",
};

function recentMenus(key: string): string[] {
  try {
    const saved: unknown = JSON.parse(sessionStorage.getItem(key) ?? "[]");
    if (Array.isArray(saved))
      return saved.filter((to) => menuItems.some((item) => item.to === to));
  } catch {}
  return [];
}

function initialExpanded(activeGroup: string | undefined) {
  let stored: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(
      localStorage.getItem(preferenceKey) ?? "{}",
    );
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed))
      stored = parsed as Record<string, unknown>;
  } catch {}
  return Object.fromEntries(
    consoleGroups.map(({ id }) => [
      id,
      id === activeGroup || stored[id] === true,
    ]),
  );
}

export function AdminNavigation({
  compact,
  close,
}: {
  compact: boolean;
  close?: () => void;
}) {
  const { pathname } = useLocation();
  const listId = useId();
  const activeGroup = consoleGroups.find((group) =>
    group.items.some(
      (item) => pathname === item.to || pathname.startsWith(`${item.to}/`),
    ),
  )?.id;
  const [navigation, setNavigation] = useState(() => ({
    pathname,
    expanded: initialExpanded(activeGroup),
  }));
  // A real route change reveals its destination, while a manual collapse on the
  // current route stays collapsed. Other groups keep their explicit preference.
  if (navigation.pathname !== pathname) {
    setNavigation({
      pathname,
      expanded: {
        ...navigation.expanded,
        ...(activeGroup ? { [activeGroup]: true } : {}),
      },
    });
  }
  useEffect(() => {
    try {
      localStorage.setItem(preferenceKey, JSON.stringify(navigation.expanded));
    } catch {}
  }, [navigation.expanded]);
  return (
    <nav aria-label="主导航" className="admin-navigation py-2">
      <NavLink
        to={overview.to}
        end
        title={overview.label}
        className="nav-link admin-nav-overview font-normal"
        onClick={close}
      >
        <overview.icon className="size-[18px] shrink-0" aria-hidden />
        <span className={compact ? "sr-only" : undefined}>
          {overview.label}
        </span>
      </NavLink>
      {consoleGroups.map((group) => {
        const active = activeGroup === group.id;
        const expanded = navigation.expanded[group.id];
        const label = (
          <>
            <group.icon className="size-[18px] shrink-0" aria-hidden />
            <span className={compact ? "sr-only" : "min-w-0 flex-1 text-left"}>
              {group.label}
            </span>
            {!compact && (
              <ChevronDown
                className={`size-4 shrink-0 text-muted transition-transform ${expanded ? "" : "-rotate-90"}`}
                aria-hidden
              />
            )}
          </>
        );
        const items = group.items.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            title={item.label}
            className="nav-link admin-nav-item text-sm font-normal focus:text-navigation"
            onClick={close}
          >
            <item.icon className="size-4 shrink-0" aria-hidden />
            <span>{item.label}</span>
          </NavLink>
        ));
        return compact ? (
          <DropdownMenu.Root key={group.id}>
            <DropdownMenu.Trigger
              render={
                <button
                  type="button"
                  className="admin-nav-group"
                  data-section-active={active}
                  title={group.label}
                >
                  {label}
                </button>
              }
            />
            <DropdownMenuContent
              side="right"
              align="start"
              sideOffset={10}
              collisionPadding={12}
              className="admin-nav-popup w-56 p-2"
              aria-label={group.label}
            >
              <div className="px-3 py-2 text-xs font-medium text-navigation">
                {group.label}
              </div>
              {items.map((item) => (
                <DropdownMenuItem key={item.key} render={item} />
              ))}
            </DropdownMenuContent>
          </DropdownMenu.Root>
        ) : (
          <div key={group.id} className="mb-1">
            <button
              type="button"
              className="admin-nav-group"
              aria-expanded={expanded}
              aria-controls={`${listId}-${group.id}`}
              data-section-active={active}
              onClick={() =>
                setNavigation((current) => ({
                  ...current,
                  expanded: {
                    ...current.expanded,
                    [group.id]: !current.expanded[group.id],
                  },
                }))
              }
            >
              {label}
            </button>
            <div id={`${listId}-${group.id}`} hidden={!expanded}>
              {items}
            </div>
          </div>
        );
      })}
    </nav>
  );
}

export function AdminMenuSearch({
  userId,
  onNavigate,
}: {
  userId: string;
  onNavigate?: () => void;
}) {
  const { pathname } = useLocation();
  const currentMenu =
    menuItems.find(
      (item) =>
        item.to === pathname ||
        (item.to !== overview.to && pathname.startsWith(`${item.to}/`)),
    )?.to ?? (pathname === "/admin/" ? overview.to : undefined);
  const recentKey = `antcdp.console.recent-menus.${userId}`;
  const [recent, setRecent] = useState<string[]>([]);
  const [dialog, setDialog] = useState<{
    returnFocus: HTMLElement | null;
  } | null>(null);
  const searchButton = useRef<HTMLButtonElement>(null);
  const [search, setSearch] = useState(""),
    [active, setActive] = useState(0);
  const navigate = useNavigate(),
    listId = useId();
  useEffect(() => {
    if (!currentMenu) return;
    try {
      const paths = recentMenus(recentKey).filter((to) => to !== currentMenu);
      sessionStorage.setItem(
        recentKey,
        JSON.stringify([currentMenu, ...paths].slice(0, 6)),
      );
    } catch {}
  }, [currentMenu, recentKey]);
  const openSearch = useCallback(
    (returnFocus: HTMLElement | null) => {
      setSearch("");
      setActive(0);
      setRecent(recentMenus(recentKey).filter((to) => to !== currentMenu));
      setDialog({ returnFocus });
    },
    [currentMenu, recentKey],
  );
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.key.toLowerCase() !== "k" ||
        !(event.ctrlKey || event.metaKey)
      )
        return;
      // Editors own their link shortcut; normal pages expose menu search.
      if (
        (event.target as HTMLElement | null)?.closest(
          "textarea,[contenteditable=true]",
        )
      )
        return;
      event.preventDefault();
      const focused = document.activeElement;
      openSearch(
        focused instanceof HTMLElement && focused !== document.body
          ? focused
          : searchButton.current,
      );
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [openSearch]);
  const query = search.trim().toLowerCase();
  const showRecent = !query && recent.length > 0;
  const options = showRecent
    ? recent.flatMap((to) => menuItems.filter((item) => item.to === to))
    : menuItems.filter((item) =>
        `${item.label} ${item.group} ${searchKeywords[item.to] ?? ""}`
          .toLowerCase()
          .includes(query),
      );
  function choose(to: string) {
    setDialog(null);
    onNavigate?.();
    void navigate(to);
  }
  return (
    <>
      <Button
        ref={searchButton}
        variant="ghost"
        size="sm"
        className="border-border bg-surface-subtle max-[620px]:px-2 min-[1200px]:min-w-52"
        aria-label="搜索控制台菜单"
        aria-keyshortcuts="Control+K Meta+K"
        title="搜索菜单（Ctrl K / Cmd K）"
        onClick={(event) => openSearch(event.currentTarget)}
      >
        <Search aria-hidden />
        <span className="max-[620px]:hidden">搜索菜单</span>
        <kbd className="rounded border border-border bg-surface px-1.5 font-sans text-[11px] max-[1000px]:hidden min-[1200px]:ms-11">
          Ctrl K
        </kbd>
      </Button>
      {dialog && (
        <Modal
          open
          title="搜索控制台菜单"
          onClose={() => setDialog(null)}
          restoreFocusTo={dialog.returnFocus}
          footer={<OverlayCancelButton>关闭</OverlayCancelButton>}
        >
          <StandaloneInput
            autoFocus
            aria-label="菜单名称或技术词"
            placeholder="搜索功能，例如模型、MCP、SSH…"
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={
              options[active] ? `${listId}-${active}` : undefined
            }
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setActive(0);
            }}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return;
              if (
                options.length &&
                (event.key === "ArrowDown" || event.key === "ArrowUp")
              ) {
                event.preventDefault();
                const offset = event.key === "ArrowDown" ? 1 : -1;
                const next =
                  (active + offset + options.length) % options.length;
                setActive(next);
                document
                  .getElementById(`${listId}-${next}`)
                  ?.scrollIntoView?.({ block: "nearest" });
              }
              if (event.key === "Enter" && options[active]) {
                event.preventDefault();
                choose(options[active].to);
              }
            }}
          />
          {showRecent && (
            <div className="mt-4 px-3 text-xs text-muted">最近访问</div>
          )}
          <div
            id={listId}
            role="listbox"
            aria-label={showRecent ? "最近访问" : "匹配菜单"}
            className="mt-2 max-h-[50vh] overflow-y-auto"
          >
            {options.map((item, index) => (
              <button
                type="button"
                role="option"
                aria-selected={index === active}
                id={`${listId}-${index}`}
                key={item.to}
                tabIndex={-1}
                className={`flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left text-sm ${index === active ? "bg-primary/10 text-primary" : "hover:bg-surface-hover"}`}
                onMouseEnter={() => setActive(index)}
                onClick={() => choose(item.to)}
              >
                <item.icon className="size-4" />
                <span className="flex-1">{item.label}</span>
                <span className="text-xs text-muted">{item.group}</span>
              </button>
            ))}
            {options.length === 0 && (
              <p className="py-8 text-center text-sm text-muted">
                没有匹配的功能入口。
              </p>
            )}
          </div>
        </Modal>
      )}
    </>
  );
}
