import { useEffect } from "react";
import { Link, useLocation, useMatches } from "react-router";
import { ChevronRight, Ellipsis } from "lucide-react";
import { Tooltip } from "radix-ui";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuItem,
  DropdownMenuContent,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { releaseDisplayName } from "@/features/delivery/release-labels";
type Named = { name: string; is_member?: boolean };
type PageData = Partial<
  Record<
    | "resource"
    | "project"
    | "selected"
    | "host"
    | "variant"
    | "profile"
    | "template"
    | "robot",
    Named | null
  >
>;
type ReleasePageData = PageData & {
  releases?: {
    release?: { name?: string; version_label: string } | null;
  } | null;
};
type Crumb = { label: string; to: string; list?: boolean };
const labels: Record<string, string> = {
  users: "用户管理",
  settings: "系统设置",
  audit: "审计日志",
  integrations: "服务集成",
  "remote-hosts": "远程主机",
  email: "邮件",
  sms: "短信",
  dingtalk: "钉钉机器人",
  account: "个人设置",
  security: "账号安全",
  variants: "产品变体",
  templates: "模板",
  "send-logs": "发送日志",
  components: "组件状态",
};
const tabs: Record<string, string> = {
  members: "成员",
  teams: "参与团队",
  projects: "加入项目",
  repositories: "Git 仓库",
  "branch-model": "分支模型",
  access: "注册与会话",
  system: "运行信息",
  maintenance: "临时文件",
};
const projectSettings: Record<string, string> = {
  general: "基本资料",
  members: "成员",
  teams: "团队授权",
  branches: "分支规则",
  credentials: "访问凭证",
};
export function trail(
  path: string,
  search: string,
  data: ReleasePageData,
): Crumb[] {
  const parts = path.split("/").filter(Boolean),
    admin = parts[0] === "admin",
    query = new URLSearchParams(search);
  const rows: Crumb[] = [
    { label: admin ? "控制台" : "工作区", to: admin ? "/admin" : "/home" },
  ];
  const tail = parts.slice(admin ? 1 : 0);
  let parent = admin ? "/admin" : "";
  for (const [i, key] of tail.entries()) {
    parent += "/" + key;
    if (key === "home") continue;
    const prev = tail[i - 1];
    let label = labels[key],
      list = false;
    if (key === "projects" || key === "teams") {
      label =
        (admin ? "" : "我的") +
        (key === "projects" ? "项目" : "团队") +
        (admin ? "管理" : "");
      list = true;
    } else if (prev === "projects" || prev === "teams") {
      label =
        data.resource?.name ||
        data.project?.name ||
        (prev === "projects" ? "项目详情" : "团队详情");
    } else if (key === "integrations" || key === "remote-hosts") {
      if (!admin)
        label =
          (tail[0] === "account" ? "个人" : "项目") +
          (key === "integrations" ? "集成凭证" : " SSH 凭证");
      list = true;
    } else if (key === "profiles") {
      label = tail[0] === "email" ? "SMTP 配置" : "短信配置";
      list = true;
    } else if (key === "templates") {
      label = tail[0] === "email" ? "邮件模板" : "短信模板";
      list = true;
    } else if (key === "send-logs" || key === "dingtalk" || key === "variants")
      list = true;
    else if (!label) {
      label =
        data.selected?.name ||
        data.host?.name ||
        data.profile?.name ||
        data.template?.name ||
        data.robot?.name ||
        (key === "new"
          ? "创建模板"
          : prev === "send-logs"
            ? "发送记录"
            : "详情");
    }
    rows.push({ label, to: parent, list });
  }
  if (
    !admin &&
    tail[0] === "projects" &&
    ["integrations", "remote-hosts"].includes(tail[2] || "") &&
    data.project?.is_member === false
  ) {
    const projectList = rows.find((row) => row.to === "/projects");
    const project = rows.find((row) => row.to === `/projects/${tail[1]}`);
    if (projectList) {
      projectList.label = "项目管理";
      projectList.to = "/admin/projects";
    }
    if (project) project.to = `/admin/projects/${tail[1]}`;
  }
  if (tail.at(-1) === "variants" && data.variant) {
    const listQuery = new URLSearchParams(query);
    for (const k of [
      "variant",
      "vview",
      "epage",
      "esize",
      "release",
      "rq",
      "rstatus",
      "rpage",
      "rsize",
    ])
      listQuery.delete(k);
    rows[rows.length - 1]!.to =
      parent + (listQuery.size ? "?" + listQuery : "");
    const variantQuery = new URLSearchParams(query);
    for (const k of ["vview", "release", "rq", "rstatus", "rpage", "rsize"])
      variantQuery.delete(k);
    rows.push({ label: data.variant.name, to: path + "?" + variantQuery });
    if (query.get("vview") === "releases") {
      const releases = new URLSearchParams(query);
      releases.delete("release");
      rows.push({ label: "发布管理", to: path + "?" + releases });
      if (data.releases?.release)
        rows.push({
          label: releaseDisplayName(data.releases.release),
          to: path + search,
        });
    }
  } else if (tail[0] === "projects" && tail.length === 2 && data.resource) {
    const tab = query.get("tab") || "overview";
    const primary: Record<string, string> = {
      description: "项目介绍",
      releases: "发布",
      repositories: "仓库",
    };
    const aliases: Record<string, string> = {
      members: "members",
      teams: "teams",
      "branch-model": "branches",
    };
    if (primary[tab]) rows.push({ label: primary[tab], to: path + search });
    else if (tab === "settings" || aliases[tab]) {
      const selected = aliases[tab] || query.get("section") || "general";
      const section = Object.hasOwn(projectSettings, selected)
        ? selected
        : "general";
      rows.push({ label: "项目设置", to: path + "?tab=settings" });
      rows.push({
        label: projectSettings[section]!,
        to: path + "?tab=settings&section=" + section,
      });
    }
  } else if (data.host && query.has("tab")) {
    const hostTabs: Record<string, string> = {
      settings: "主机配置",
      credentials: admin ? "系统凭证" : "SSH 凭证",
      keys: "主机公钥",
    };
    const tab = query.get("tab")!;
    if (hostTabs[tab] && (admin || tab === "credentials"))
      rows.push({ label: hostTabs[tab], to: path + search });
  } else if (
    ((data.resource &&
      tail[0] === "teams" &&
      ["members", "projects"].includes(query.get("tab") || "")) ||
      (tail.at(-1) === "settings" &&
        ["access", "system", "maintenance"].includes(
          query.get("tab") || "",
        ))) &&
    tabs[query.get("tab") || ""]
  )
    rows.push({ label: tabs[query.get("tab")!]!, to: path + search });
  return rows;
}

export function breadcrumbLayout(rows: Crumb[], narrow = false) {
  const visible = new Set<number>();
  if (narrow || rows.length <= 4) {
    rows.forEach((_, i) => {
      if (!narrow || i >= rows.length - 2) visible.add(i);
    });
  } else {
    // Keep the working context, while every skipped route remains in the menu.
    const project = rows.findIndex((c) =>
      /^\/(?:admin\/)?projects\/\d+$/.test(c.to),
    );
    const variant = rows.findIndex((c) => {
      const [path, query] = c.to.split("?");
      const params = new URLSearchParams(query);
      return (
        /^\/(?:admin\/)?projects\/\d+\/variants$/.test(path!) &&
        params.has("variant") &&
        !params.has("vview")
      );
    });
    for (const i of [project, variant, rows.length - 1])
      if (i >= 0) visible.add(i);
    for (let i = rows.length - 2; visible.size < 3 && i >= 0; i--)
      visible.add(i);
  }
  return {
    visible: rows.filter((_, i) => visible.has(i)),
    collapsed: rows.filter((_, i) => !visible.has(i)),
  };
}

export function projectBreadcrumbRows(
  rows: Crumb[],
  pathname: string,
  search: string,
) {
  const projectIndex = rows.findIndex((row) =>
    /^\/(?:admin\/)?projects\/\d+$/.test(row.to),
  );
  if (projectIndex < 0) return rows;
  const params = new URLSearchParams(search);
  if (/\/variants$/.test(pathname)) {
    // Release detail owns its context-sensitive return link and object heading.
    return params.has("variant") && !params.has("release")
      ? rows.slice(projectIndex + 1)
      : [];
  }
  if (/\/(integrations|remote-hosts)(\/|$)/.test(pathname))
    return [
      {
        label: "访问凭证",
        to: rows[projectIndex]!.to + "?tab=settings&section=credentials",
      },
      ...rows.slice(projectIndex + 1),
    ];
  return [];
}

function CrumbLabel({
  crumb,
  current,
  to,
}: {
  crumb: Crumb;
  current: boolean;
  to: string;
}) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        {current ? (
          <span
            aria-current="page"
            tabIndex={0}
            className="block min-w-0 truncate rounded-sm py-1 font-medium text-foreground"
          >
            {crumb.label}
          </span>
        ) : (
          <Link
            to={to}
            className="block min-w-0 truncate rounded-sm py-1 text-muted-foreground hover:text-foreground hover:underline"
          >
            {crumb.label}
          </Link>
        )}
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          side="bottom"
          align="start"
          sideOffset={6}
          collisionPadding={16}
          className="z-50 max-w-[min(32rem,calc(100vw-2rem))] rounded-md border bg-popover px-3 py-2 text-[13px] leading-relaxed break-words text-popover-foreground shadow-sm"
        >
          {crumb.label}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

export function Breadcrumbs({
  user,
  siteName,
  mode = "full",
}: {
  user: string;
  siteName?: string;
  mode?: "full" | "project";
}) {
  const { pathname, search } = useLocation(),
    matches = useMatches(),
    data = (matches.at(-1)?.loaderData || {}) as ReleasePageData;
  const rows = trail(pathname, search, data),
    last = rows.at(-1)!;
  const visibleRows =
    mode === "project" ? projectBreadcrumbRows(rows, pathname, search) : rows;
  const desktop = breadcrumbLayout(visibleRows),
    narrow = breadcrumbLayout(visibleRows, true);
  const pageTitle =
    pathname === "/home"
      ? "首页"
      : pathname === "/admin"
        ? "系统概览"
        : last.label;
  useEffect(() => {
    document.title = siteName ? `${siteName} · ${pageTitle}` : "AntCDP";
  }, [pageTitle, siteName]);
  const prefix = "antcdp.crumb." + user + ":";
  useEffect(() => {
    if (last.list) {
      try {
        sessionStorage.setItem(prefix + last.to, search);
      } catch {
        /* Storage is optional. */
      }
    }
  }, [last.list, last.to, search, prefix]);
  if (!visibleRows.length) return null;
  function href(c: Crumb) {
    if (!c.list || c.to.includes("?")) return c.to;
    const q = new URLSearchParams(search);
    if (
      /^\/(?:admin\/)?projects\/\d+$/.test(pathname) &&
      q.get("tab") === "releases"
    ) {
      for (const key of [
        "q",
        "status",
        "page",
        "page_size",
        "variant_id",
        "variant_name",
      ])
        q.delete(key);
    }
    q.delete("tab");
    q.delete("section");
    q.delete("edit");
    q.delete("create");
    try {
      return (
        c.to +
        (sessionStorage.getItem(prefix + c.to) ??
          (c.to === pathname.split("/").slice(0, -1).join("/") && q.size
            ? "?" + q
            : ""))
      );
    } catch {
      return c.to;
    }
  }
  function ancestors(collapsed: Crumb[], className: string) {
    if (!collapsed.length) return null;
    return (
      <li className={"shrink-0 " + className}>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-11 text-muted-foreground hover:text-foreground"
              aria-label="展开上级导航"
            >
              <Ellipsis className="size-[18px]" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            className="max-w-[min(32rem,calc(100vw-2rem))]"
          >
            {collapsed.map((c) => (
              <DropdownMenuItem key={c.to} asChild>
                <Link
                  to={href(c)}
                  className="min-h-10 text-[13px] whitespace-normal break-words"
                >
                  {c.label}
                </Link>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </li>
    );
  }
  return (
    <Tooltip.Provider delayDuration={400}>
      <nav
        aria-label="面包屑"
        className={"min-w-0 flex-1" + (mode === "project" ? " mb-5" : "")}
      >
        <ol className="flex min-w-0 max-w-5xl items-center gap-1 text-[13px] leading-5 sm:gap-2">
          {ancestors(narrow.collapsed, "lg:hidden")}
          {ancestors(desktop.collapsed, "hidden lg:block")}
          {visibleRows.map((c, i) => {
            const onDesktop = desktop.visible.includes(c),
              onNarrow = narrow.visible.includes(c);
            if (!onDesktop && !onNarrow) return null;
            return (
              <li
                key={c.to}
                className={
                  (onNarrow ? "flex" : "hidden") +
                  (onDesktop ? " lg:flex" : " lg:hidden") +
                  " min-w-0 items-center gap-1 sm:gap-2 " +
                  (i === visibleRows.length - 1
                    ? "max-w-[26rem] flex-1"
                    : "max-w-[35%] shrink-[2] lg:max-w-56")
                }
              >
                {i > 0 && (
                  <ChevronRight
                    aria-hidden
                    className="size-3 shrink-0 text-muted-foreground"
                  />
                )}
                <CrumbLabel crumb={c} current={c === last} to={href(c)} />
              </li>
            );
          })}
        </ol>
      </nav>
    </Tooltip.Provider>
  );
}
