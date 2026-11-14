import { useState } from "react";
import { Link, useSearchParams } from "react-router";
import { ArrowRight, Folder, SearchX, Star, Users } from "lucide-react";
import { useAuth } from "@/app/auth";
import { Button, IconButton } from "@/components/button";
import { DescriptionPreview } from "@/components/description-preview";
import { AsyncBoundary, ErrorNotice, StatusBadge } from "@/components/feedback";
import { StandaloneInput, StandaloneSelect } from "@/components/fields";
import { Pagination } from "@/components/pagination";
import { PageHeader } from "@/components/layout";
import { ResourceIcon } from "@/components/resource-icon";
import { TableToolbar } from "@/components/table-toolbar";
import { useApiQuery } from "@/hooks/use-api";
import { usePageSize } from "@/hooks/use-page-size";
import { useDebouncedSearch } from "@/hooks/use-search";
import { formatDate } from "@/lib/utils";
import type { Page, Resource, ResourceKind } from "@/types/collaboration";
import { ShortcutEditor } from "@/areas/workspace/pages/shortcuts";
import { useWorkspaceShortcut } from "@/areas/workspace/pages/use-workspace-shortcut";

export function WorkspaceProjectList() {
  return <WorkspaceResourceList kind="projects" />;
}

export function WorkspaceTeamList() {
  return <WorkspaceResourceList kind="teams" />;
}

function WorkspaceResourceList({ kind }: { kind: ResourceKind }) {
  const auth = useAuth();
  const [params, setParams] = useSearchParams();
  const [preferredSize, setPreferredSize] = usePageSize(kind);
  const [manage, setManage] = useState(false);
  const project = kind === "projects";
  const title = project ? "我的项目" : "我的团队";
  const ended = project ? "archived" : "dissolved";
  const q = params.get("q") ?? "";
  const requestedStatus = params.get("status") ?? "active";
  const status = ["active", ended, "all"].includes(requestedStatus)
    ? requestedStatus
    : "active";
  const size = [10, 20, 50, 100].includes(Number(params.get("page_size")))
    ? Number(params.get("page_size"))
    : preferredSize;
  const page = Math.max(1, Math.floor(Number(params.get("page")) || 1));
  const shortcut = useWorkspaceShortcut(kind);

  function update(values: Record<string, string>, reset = true) {
    setParams((current) => {
      const next = new URLSearchParams(current);
      if (reset) next.set("page", "1");
      for (const [key, value] of Object.entries(values)) {
        if (value) next.set(key, value);
        else next.delete(key);
      }
      return next;
    });
  }

  const search = useDebouncedSearch(q, (value) => update({ q: value }));
  const path = `/${kind}?${new URLSearchParams({
    scope: "mine",
    q,
    status,
    page: String(page),
    page_size: String(size),
  })}`;
  const list = useApiQuery<Page<Resource>>(
    [kind, "mine", q, status, page, size],
    path,
  );
  const activeCount = useApiQuery<Page<Resource>>(
    [kind, "mine", q, "active-count"],
    `/${kind}?scope=mine&status=active&page=1&page_size=1&q=${encodeURIComponent(q)}`,
  );
  const endedCount = useApiQuery<Page<Resource>>(
    [kind, "mine", q, "ended-count"],
    `/${kind}?scope=mine&status=${ended}&page=1&page_size=1&q=${encodeURIComponent(q)}`,
  );
  const filtered = Boolean(q || status !== "active");

  function shortcutButton(resource: Resource) {
    const selected = shortcut.selected(resource.id);
    const action = project
      ? selected
        ? "取消关注"
        : "关注"
      : selected
        ? "取消固定"
        : "固定";
    return (
      <IconButton
        size="iconSm"
        className={selected ? "star-active" : undefined}
        label={`${action} ${resource.name}`}
        aria-pressed={selected}
        pending={shortcut.pendingId === resource.id}
        disabled={
          !shortcut.shortcuts.data || shortcut.pending || shortcut.uncertain
        }
        onClick={() => void shortcut.toggle(resource)}
      >
        <Star />
      </IconButton>
    );
  }

  return (
    <div className="page workspace-directory-page">
      <PageHeader
        title={title}
        description={
          project
            ? "查看你参与的项目，关注常用项目以便快速进入。"
            : "查看你加入的团队、协作成员与关联项目。"
        }
      />
      <section
        className={
          project
            ? "workspace-directory-panel workspace-project-directory-shell"
            : "panel workspace-directory-panel"
        }
      >
        <TableToolbar
          onReset={() => {
            search.setValue("");
            update({ q: "", status: "active" });
          }}
          onRefresh={() => void list.refetch()}
          refreshing={list.isFetching}
          actions={
            <Button
              variant="outline"
              disabled={!shortcut.shortcuts.data}
              onClick={() => setManage(true)}
            >
              <Star />
              {project ? "管理关注" : "管理固定"}
            </Button>
          }
        >
          <form
            className="flex shrink-0 items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              search.submit();
            }}
          >
            <StandaloneInput
              aria-label={`搜索${title}`}
              placeholder="搜索名称、编码或摘要"
              value={search.value}
              onChange={(event) => search.setValue(event.target.value)}
              onCompositionStart={() => {
                search.composing.current = true;
              }}
              onCompositionEnd={search.compositionEnd}
            />
          </form>
          <StandaloneSelect
            aria-label="状态筛选"
            value={status}
            onValueChange={(value) => update({ status: value })}
          >
            <option value="active">
              正常 · {activeCount.data?.data.total ?? "—"}
            </option>
            <option value={ended}>
              {project ? "已归档" : "已解散"} ·{" "}
              {endedCount.data?.data.total ?? "—"}
            </option>
            <option value="all">全部</option>
          </StandaloneSelect>
        </TableToolbar>
        {Boolean(shortcut.error) && (
          <div className="workspace-shortcut-feedback">
            <ErrorNotice error={shortcut.error} />
            <Button
              variant="outline"
              size="sm"
              pending={shortcut.shortcuts.isFetching}
              onClick={() => void shortcut.reload()}
            >
              重新读取快捷方式
            </Button>
          </div>
        )}
        <AsyncBoundary
          loading={list.isPending}
          error={list.error}
          onRetry={() => void list.refetch()}
          empty={!list.data?.data.items.length}
          emptyTitle={
            filtered ? "没有匹配的结果" : `暂无${project ? "项目" : "团队"}`
          }
          emptyDescription={
            filtered
              ? "请调整关键词或状态筛选。"
              : "请联系项目或团队管理员加入。"
          }
          emptyIcon={filtered ? SearchX : project ? Folder : Users}
        >
          {list.data &&
            (project ? (
              <div className="workspace-project-directory">
                {list.data.data.items.map((item) => (
                  <ProjectCard
                    key={item.id}
                    project={item}
                    timezone={auth.settings.timezone}
                    shortcut={shortcutButton(item)}
                  />
                ))}
              </div>
            ) : (
              <ul className="workspace-team-directory">
                {list.data.data.items.map((item) => (
                  <TeamRow
                    key={item.id}
                    team={item}
                    timezone={auth.settings.timezone}
                    shortcut={shortcutButton(item)}
                  />
                ))}
              </ul>
            ))}
        </AsyncBoundary>
        {list.data && (
          <Pagination
            page={page}
            size={size}
            total={list.data.data.total}
            pending={list.isFetching}
            onChange={(nextPage, nextSize) => {
              if (nextSize !== size) setPreferredSize(nextSize);
              setParams((current) => {
                const next = new URLSearchParams(current);
                next.set("page", String(nextPage));
                next.set("page_size", String(nextSize));
                return next;
              });
            }}
          />
        )}
      </section>
      {manage && shortcut.shortcuts.data && (
        <ShortcutEditor
          kind={kind}
          initial={shortcut.shortcuts.data.data}
          onClose={() => setManage(false)}
        />
      )}
    </div>
  );
}

function ProjectCard({
  project,
  timezone,
  shortcut,
}: {
  project: Resource;
  timezone: string;
  shortcut: React.ReactNode;
}) {
  return (
    <article className="workspace-project-card">
      <div className="workspace-project-card-header">
        <ResourceIcon resource={project} className="size-11" />
        <div className="min-w-0 flex-1">
          <Link
            to={`/projects/${project.id}`}
            className="workspace-project-name"
            title={project.name}
          >
            {project.name}
          </Link>
          <span className="mono workspace-resource-code">{project.code}</span>
        </div>
        {shortcut}
      </div>
      <div className="workspace-project-summary">
        {project.summary ? (
          <>
            <p>{project.summary}</p>
            <DescriptionPreview
              name={project.name}
              description={project.summary}
              label="项目摘要"
            />
          </>
        ) : (
          <p className="workspace-summary-empty">尚未填写项目摘要。</p>
        )}
      </div>
      <div className="workspace-project-card-meta">
        <StatusBadge tone={project.status === "active" ? "success" : "neutral"}>
          {project.status === "active" ? "正常" : "已归档"}
        </StatusBadge>
        <span>{roleLabel(project, "projects")}</span>
        <span>{project.member_count} 位成员</span>
      </div>
      <footer className="workspace-project-card-footer">
        最近更新 {formatDate(project.updated_at, timezone)}
        <Link
          to={`/projects/${project.id}`}
          className="link inline-flex items-center gap-1"
        >
          进入项目 <ArrowRight />
        </Link>
      </footer>
    </article>
  );
}

function TeamRow({
  team,
  timezone,
  shortcut,
}: {
  team: Resource;
  timezone: string;
  shortcut: React.ReactNode;
}) {
  return (
    <li className="workspace-team-row">
      <div className="workspace-team-shortcut">{shortcut}</div>
      <Link
        to={`/teams/${team.id}`}
        className="workspace-team-identity"
        aria-label={team.name}
      >
        <ResourceIcon resource={team} className="size-10" />
        <span className="min-w-0">
          <strong className="block truncate" title={team.name}>
            {team.name}
          </strong>
          <small className="mono workspace-resource-code">{team.code}</small>
        </span>
      </Link>
      <div className="workspace-team-summary">
        {team.summary && (
          <>
            <p>{team.summary}</p>
            <DescriptionPreview
              name={team.name}
              description={team.summary}
              label="团队摘要"
            />
          </>
        )}
      </div>
      <div className="workspace-team-meta">
        <span>{roleLabel(team, "teams")}</span>
        <span>{team.member_count} 位成员</span>
        <span>更新于 {formatDate(team.updated_at, timezone)}</span>
      </div>
      <StatusBadge tone={team.status === "active" ? "success" : "neutral"}>
        {team.status === "active" ? "正常" : "已解散"}
      </StatusBadge>
      <Link
        to={`/teams/${team.id}`}
        className="workspace-team-open"
        aria-label={`进入 ${team.name}`}
      >
        <ArrowRight />
      </Link>
    </li>
  );
}

function roleLabel(resource: Resource, kind: ResourceKind) {
  const project = kind === "projects";
  if (resource.direct_role === "admin")
    return project ? "项目管理员" : "团队管理员";
  if (resource.direct_role === "member")
    return project ? "项目成员" : "团队成员";
  return resource.is_member ? "团队继承成员" : "成员";
}
