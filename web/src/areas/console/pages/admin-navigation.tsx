import { useEffect, useId, useRef, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router";
import { Menu as DropdownMenu } from "@base-ui/react/menu";
import {
  Bot,
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

const consoleGroups = [
  {
    id: "platform",
    label: "平台管理",
    icon: LayoutDashboard,
    items: [
      { to: "/admin", label: "系统概览", icon: LayoutDashboard, end: true },
      { to: "/admin/users", label: "真人用户", icon: UserRound },
      { to: "/admin/robots", label: "机器人账号", icon: Bot },
      { to: "/admin/projects", label: "项目管理", icon: Folder },
      { to: "/admin/teams", label: "团队管理", icon: Users },
    ],
  },
  {
    id: "resources",
    label: "连接与资源",
    icon: Cable,
    items: [
      { to: "/admin/integrations", label: "服务集成", icon: Cable },
      { to: "/admin/remote-hosts", label: "远程主机", icon: Server },
      { to: "/admin/models", label: "模型管理", icon: BrainCircuit },
      { to: "/admin/web-access", label: "网络检索", icon: Globe },
    ],
  },
  {
    id: "agents",
    label: "智能体",
    icon: Bot,
    items: [
      { to: "/admin/agents", label: "智能体管理", icon: Bot },
      { to: "/admin/mcp-servers", label: "MCP 服务", icon: Cable },
      { to: "/admin/skills", label: "技能库", icon: BookOpen },
      { to: "/admin/cloud-computers", label: "云电脑", icon: Box },
      {
        to: "/admin/agent-usage",
        label: "运行与用量",
        icon: ChartNoAxesCombined,
      },
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
    group.items.some((item) =>
      "end" in item && item.end
        ? pathname === item.to
        : pathname === item.to || pathname.startsWith(`${item.to}/`),
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
    <nav aria-label="主导航" className="admin-navigation py-3">
      <MenuSearch compact={compact} close={close} />
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
            end={"end" in item && item.end}
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
          <div key={group.id} className="mb-2">
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

function MenuSearch({
  compact,
  close,
}: {
  compact: boolean;
  close?: () => void;
}) {
  const [dialog, setDialog] = useState<{
    returnFocus: HTMLElement | null;
  } | null>(null);
  const searchButton = useRef<HTMLButtonElement>(null);
  const [search, setSearch] = useState(""),
    [active, setActive] = useState(0);
  const navigate = useNavigate(),
    listId = useId();
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
      setSearch("");
      setActive(0);
      const focused = document.activeElement;
      setDialog({
        returnFocus:
          focused instanceof HTMLElement && focused !== document.body
            ? focused
            : searchButton.current,
      });
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, []);
  const keywords: Record<string, string> = {
    "/admin/remote-hosts": "ssh host",
    "/admin/models": "model provider llm",
    "/admin/web-access": "search fetch web",
    "/admin/mcp-servers": "mcp http",
    "/admin/skills": "skill skills zip",
    "/admin/agents": "agent",
    "/admin/agent-usage": "usage tokens",
  };
  const options = consoleGroups
    .flatMap((group) =>
      group.items.map((item) => ({ ...item, group: group.label })),
    )
    .filter((item) =>
      `${item.label} ${item.group} ${keywords[item.to] ?? ""}`
        .toLowerCase()
        .includes(search.trim().toLowerCase()),
    );
  function choose(to: string) {
    setDialog(null);
    close?.();
    void navigate(to);
  }
  return (
    <div className={compact ? "mb-2 px-[10px]" : "mb-2 px-2"}>
      <Button
        ref={searchButton}
        variant="ghost"
        className={
          compact
            ? "min-h-[44px] w-full px-0 text-navigation hover:text-navigation"
            : "w-full justify-start text-navigation hover:text-navigation"
        }
        aria-label="搜索控制台菜单"
        title="搜索菜单（Ctrl K / Cmd K）"
        onClick={(event) => {
          setSearch("");
          setActive(0);
          setDialog({ returnFocus: event.currentTarget });
        }}
      >
        <Search className="size-4" />
        {!compact && (
          <>
            <span className="flex-1 text-left">搜索菜单</span>
            <kbd className="text-[10px] text-muted">Ctrl K</kbd>
          </>
        )}
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
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                setActive((old) =>
                  options.length
                    ? (old +
                        (event.key === "ArrowDown" ? 1 : options.length - 1)) %
                      options.length
                    : 0,
                );
              }
              if (event.key === "Enter" && options[active]) {
                event.preventDefault();
                choose(options[active].to);
              }
            }}
          />
          <div
            id={listId}
            role="listbox"
            aria-label="匹配菜单"
            className="mt-4 max-h-[50vh] overflow-y-auto"
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
    </div>
  );
}
