import { useState, type ReactNode } from "react";
import {
  ChevronDown,
  FileText,
  FolderGit2,
  GitBranch,
  LayoutDashboard,
  LogOut,
  MoreHorizontal,
  RefreshCw,
  Rocket,
  Settings2,
} from "lucide-react";
import { Link, useRevalidator } from "react-router";
import type { Page, Resource } from "@/shared/collaboration";
import { useQuery } from "@/lib/use-query";
import { useNavigateAfterSave } from "@/components/platform/navigation-guard";
import { AsyncState } from "@/components/platform/feedback";
import { FormDialog } from "@/components/platform/form-dialog";
import { Pagination } from "@/components/platform/pagination";
import { StatusText } from "@/components/platform/status-text";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ResourceIcon } from "./ResourceIcon";
import { ResourceCommand } from "./ResourceCommand";
import { PinButton, useShortcuts } from "./Shortcuts";
import "./project-navigation.css";

export type ProjectSection =
  | "overview"
  | "description"
  | "releases"
  | "variants"
  | "repositories"
  | "settings";
export function projectRoot(project: Pick<Resource, "id">, admin: boolean) {
  return `${admin ? "/admin" : ""}/projects/${project.id}`;
}
export function projectSection(
  pathname: string,
  search: string,
): ProjectSection {
  const params = new URLSearchParams(search);
  if (/\/variants$/.test(pathname))
    return params.get("vview") === "releases" ? "releases" : "variants";
  if (/\/(integrations|remote-hosts)(\/|$)/.test(pathname)) return "settings";
  const tab = params.get("tab") || "overview";
  if (["description", "releases", "repositories"].includes(tab))
    return tab as ProjectSection;
  return ["settings", "members", "teams", "branch-model"].includes(tab)
    ? "settings"
    : "overview";
}
export function projectRouteContext(
  pathname: string,
  data: { resource?: Resource; project?: Resource },
  systemAdmin: boolean,
) {
  const match = /^\/(admin\/)?projects\/([1-9]\d*)(?:\/|$)/.exec(pathname);
  if (!match) return null;
  const project = data.project || data.resource;
  if (!project || project.id !== match[2]) return null;
  // Credential URLs retain their workspace shape for non-member administrators.
  return {
    project,
    admin: !!match[1] || (systemAdmin && project.is_member === false),
  };
}
export function ProjectNavigation({
  project,
  admin,
  active,
  mobileTrigger,
}: {
  project: Resource;
  admin: boolean;
  active: ProjectSection;
  mobileTrigger?: ReactNode;
}) {
  const root = projectRoot(project, admin),
    revalidator = useRevalidator(),
    shortcuts = useShortcuts(),
    afterSave = useNavigateAfterSave();
  const [switching, setSwitching] = useState(false),
    [leaving, setLeaving] = useState(false);
  return (
    <>
      <header className="project-shell-header">
        <div className="project-shell-identity">
          {mobileTrigger}
          <Button
            variant="ghost"
            className="project-switch-trigger"
            aria-label={`切换项目，当前 ${project.name}`}
            aria-haspopup="dialog"
            aria-expanded={switching}
            onClick={() => setSwitching(true)}
            title={project.name}
          >
            <ResourceIcon
              iconKey={project.icon_key}
              fileId={project.icon_file_id}
            />
            <span className="min-w-0 truncate">{project.name}</span>
            <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
          </Button>
          {project.status !== "active" && (
            <span className="project-shell-archived">已归档</span>
          )}
        </div>
        <nav className="project-shell-nav" aria-label="项目导航">
          {(
            [
              ["overview", "概览", root, LayoutDashboard],
              ["releases", "发布", root + "?tab=releases", Rocket],
              ["variants", "变体", root + "/variants", GitBranch],
              ["repositories", "仓库", root + "?tab=repositories", FolderGit2],
              ["description", "介绍", root + "?tab=description", FileText],
              ["settings", "设置", root + "?tab=settings", Settings2],
            ] as const
          ).map(([key, label, href, Icon]) => (
            <Link
              key={key}
              to={href}
              aria-current={active === key ? "page" : undefined}
            >
              <Icon aria-hidden="true" />
              {label}
            </Link>
          ))}
        </nav>
        <div className="project-shell-actions">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="项目更多操作">
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <PinButton kind="projects" resource={project} menuItem />
              <DropdownMenuItem
                disabled={revalidator.state !== "idle"}
                onSelect={() => void revalidator.revalidate()}
              >
                <RefreshCw />
                刷新项目
              </DropdownMenuItem>
              {project.direct_role && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => setLeaving(true)}>
                    <LogOut />
                    退出项目
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>
      {switching && (
        <ProjectPicker
          project={project}
          admin={admin}
          onClose={() => setSwitching(false)}
        />
      )}
      {leaving && (
        <ResourceCommand
          kind="projects"
          resource={project}
          command={{ action: "leave" }}
          consoleMode={admin}
          onClose={() => setLeaving(false)}
          onSaved={() => {
            setLeaving(false);
            shortcuts.refresh();
            afterSave(`${admin ? "/admin" : ""}/projects`);
          }}
        />
      )}
    </>
  );
}
function ProjectPicker({
  project,
  admin,
  onClose,
}: {
  project: Resource;
  admin: boolean;
  onClose: () => void;
}) {
  const [q, setQ] = useState(""),
    [page, setPage] = useState(1),
    [size, setSize] = useState(20);
  const query = useQuery<Page>(
    `/projects?scope=${admin ? "all" : "mine"}&status=all&page=${page}&page_size=${size}&q=${encodeURIComponent(q)}`,
  );
  return (
    <FormDialog
      open
      compact
      title="切换项目"
      onClose={onClose}
      footer={
        <Button variant="ghost" asChild>
          <Link to={`${admin ? "/admin" : ""}/projects`} onClick={onClose}>
            所有项目
          </Link>
        </Button>
      }
    >
      <p className="min-w-0 break-words text-sm text-muted-foreground">
        当前：{project.name}
        <span className="mt-1 block break-all text-[13px]">{project.code}</span>
      </p>
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          setQ(String(new FormData(event.currentTarget).get("q") || "").trim());
          setPage(1);
        }}
      >
        <Input
          name="q"
          aria-label="搜索项目"
          placeholder="搜索项目名称或编码"
        />
        <Button variant="outline">搜索</Button>
      </form>
      <div className="project-switch-results">
        <AsyncState
          loading={query.loading}
          error={query.error}
          empty={!query.data?.items.length}
          onRetry={query.refresh}
        >
          <ul className="divide-y" aria-label="可访问项目">
            {query.data?.items.map((item) => (
              <li key={item.id}>
                <Link
                  className="project-switch-result"
                  to={projectRoot(item, admin)}
                  onClick={onClose}
                  aria-label={`切换到 ${item.name}，${item.code}${item.status !== "active" ? "，已归档" : ""}`}
                  aria-current={item.id === project.id ? "page" : undefined}
                >
                  <ResourceIcon
                    iconKey={item.icon_key}
                    fileId={item.icon_file_id}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block break-words font-medium">
                      {item.name}
                    </span>
                    <span className="block break-all text-[13px] text-muted-foreground">
                      {item.code}
                    </span>
                  </span>
                  {item.id === project.id && (
                    <span className="text-[13px] text-muted-foreground">
                      当前
                    </span>
                  )}
                  {item.status !== "active" && (
                    <StatusText tone="neutral">已归档</StatusText>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        </AsyncState>
      </div>
      {query.data && (
        <Pagination
          page={page}
          size={size}
          total={query.data.total}
          pending={query.loading}
          onChange={(next, nextSize) => {
            setPage(next);
            setSize(nextSize);
          }}
        />
      )}
    </FormDialog>
  );
}
