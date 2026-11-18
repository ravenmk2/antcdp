import { useState } from "react";
import { Link, useSearchParams } from "react-router";
import { Folder, Search, SearchX, Star, Users } from "lucide-react";
import { useAuth } from "@/app/auth";
import { Button, IconButton } from "@/components/button";
import { DescriptionPreview } from "@/components/description-preview";
import { AsyncBoundary, ErrorNotice, StatusBadge } from "@/components/feedback";
import { StandaloneInput, StandaloneSelect } from "@/components/fields";
import { Pagination } from "@/components/pagination";
import { PageHeader } from "@/components/layout";
import { ResourceIcon } from "@/components/resource-icon";
import { SimpleTable } from "@/components/table";
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
    const action = selected ? "取消关注" : "关注";
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
      <PageHeader title={title} variant="divided" />
      <TableToolbar
        className="border-0"
        toolbarClassName="px-0 py-4"
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
            管理关注
          </Button>
        }
      >
        <form
          className="relative flex items-center"
          onSubmit={(event) => {
            event.preventDefault();
            search.submit();
          }}
        >
          <Search
            aria-hidden
            className="pointer-events-none absolute left-3 size-4 text-muted"
          />
          <StandaloneInput
            className="pl-9"
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
          filtered ? "请调整关键词或状态筛选。" : "请联系项目或团队管理员加入。"
        }
        emptyIcon={filtered ? SearchX : project ? Folder : Users}
      >
        {list.data && (
          <SimpleTable
            label={title}
            className="workspace-resource-table"
            headers={[
              project ? "项目名称" : "团队名称",
              "摘要",
              "我的角色",
              "成员",
              "状态",
              "最近更新",
              "关注",
            ]}
          >
            {list.data.data.items.map((item) => (
              <ResourceRow
                key={item.id}
                resource={item}
                kind={kind}
                timezone={auth.settings.timezone}
                shortcut={shortcutButton(item)}
              />
            ))}
          </SimpleTable>
        )}
      </AsyncBoundary>
      {list.data && (
        <Pagination
          className="border-0 bg-transparent px-0 pt-4"
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

function ResourceRow({
  resource,
  kind,
  timezone,
  shortcut,
}: {
  resource: Resource;
  kind: ResourceKind;
  timezone: string;
  shortcut: React.ReactNode;
}) {
  const project = kind === "projects";
  const active = resource.status === "active";
  return (
    <tr>
      <td>
        <Link
          to={`/${kind}/${resource.id}`}
          aria-label={resource.name}
          className="group inline-flex max-w-full items-center gap-3 rounded-md"
        >
          <ResourceIcon
            resource={resource}
            projectId={project ? resource.id : undefined}
            className="size-9 shrink-0"
          />
          <span className="min-w-0">
            <strong
              className="block truncate font-semibold text-foreground group-hover:text-primary"
              title={resource.name}
            >
              {resource.name}
            </strong>
            <small
              className="mt-0.5 block truncate font-mono text-xs text-muted"
              title={resource.code}
            >
              {resource.code}
            </small>
          </span>
        </Link>
      </td>
      <td>
        {resource.summary ? (
          <div className="flex items-center gap-1">
            <span className="line-clamp-2">{resource.summary}</span>
            <DescriptionPreview
              name={resource.name}
              description={resource.summary}
              label={project ? "项目摘要" : "团队摘要"}
            />
          </div>
        ) : (
          <span className="text-faint" aria-label="暂无摘要">
            —
          </span>
        )}
      </td>
      <td>{roleLabel(resource, kind)}</td>
      <td className="tabular-nums">{resource.member_count} 位成员</td>
      <td>
        <StatusBadge tone={active ? "success" : "neutral"}>
          {active ? "正常" : project ? "已归档" : "已解散"}
        </StatusBadge>
      </td>
      <td>
        <time
          className="whitespace-nowrap tabular-nums"
          dateTime={resource.updated_at}
        >
          {formatDate(resource.updated_at, timezone)}
        </time>
      </td>
      <td>{shortcut}</td>
    </tr>
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
