import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Trash2, Users } from "lucide-react";
import { request } from "@/api/client";
import { Button } from "@/components/button";
import { DescriptionPreview } from "@/components/description-preview";
import { AsyncBoundary, ErrorNotice, StatusBadge } from "@/components/feedback";
import { StandaloneInput, StandaloneSelect } from "@/components/fields";
import { PageHeader } from "@/components/layout";
import { OverlayPresence } from "@/components/overlay-presence";
import { Pagination } from "@/components/pagination";
import { ResourceIcon } from "@/components/resource-icon";
import {
  RowAction,
  RowActions,
  RowActionSeparator,
} from "@/components/row-actions";
import { DataTable, type DataColumn } from "@/components/table";
import { TableToolbar } from "@/components/table-toolbar";
import { ResourceCreateEditor } from "@/features/collaboration/resource-create-editor";
import { TeamProfileEditor } from "@/areas/console/pages/teams/team-profile-editor";
import { useApiQuery } from "@/hooks/use-api";
import { useSubmission } from "@/hooks/use-form";
import { usePageSize } from "@/hooks/use-page-size";
import { useDebouncedSearch } from "@/hooks/use-search";
import { formatDate } from "@/lib/utils";
import type { Page, Resource, ResourceKind } from "@/types/collaboration";
import { TeamDissolveDialog } from "@/areas/console/pages/teams/team-dissolve-dialog";

export function ResourceList({ kind }: { kind: ResourceKind }) {
  const [editing, setEditing] = useState<Resource | null>(null);
  const [dissolving, setDissolving] = useState<Resource | null>(null);
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [preferredSize, setPreferredSize] = usePageSize(kind);
  const q = params.get("q") ?? "";
  const ended = kind === "projects" ? "archived" : "dissolved";
  const requestedStatus = params.get("status") ?? "active";
  const status = ["active", ended, "all"].includes(requestedStatus)
    ? requestedStatus
    : "active";
  const size = [10, 20, 50, 100].includes(Number(params.get("page_size")))
    ? Number(params.get("page_size"))
    : preferredSize;
  const page = Math.max(1, Math.floor(Number(params.get("page")) || 1));
  const [create, setCreate] = [
    params.get("create") === "1",
    (value: boolean) => update({ create: value ? "1" : "" }, false),
  ];
  const queryClient = useQueryClient();
  const submission = useSubmission();

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
  const path = `/${kind}?${new URLSearchParams({ scope: "all", q, status, page: String(page), page_size: String(size) })}`;
  const list = useApiQuery<Page<Resource>>(
    [kind, "all", q, status, page, size],
    path,
  );
  const activeCount = useApiQuery<Page<Resource>>(
    [kind, "all", q, "active-count"],
    `/${kind}?scope=all&status=active&page=1&page_size=1&q=${encodeURIComponent(q)}`,
  );
  const endedCount = useApiQuery<Page<Resource>>(
    [kind, "all", q, "ended-count"],
    `/${kind}?scope=all&status=${ended}&page=1&page_size=1&q=${encodeURIComponent(q)}`,
  );
  const title = kind === "projects" ? "项目管理" : "团队管理";
  const columns: DataColumn<Resource>[] = [
    {
      id: "resource",
      header: kind === "projects" ? "项目" : "团队",
      cell: ({ row }) => (
        <div className="flex min-w-56 items-center gap-3">
          <ResourceIcon resource={row.original} />
          <div className="min-w-0">
            <Link
              className="inline-block max-w-lg break-all font-medium text-foreground hover:text-primary"
              to={`/admin/${kind}/${row.original.id}`}
            >
              {row.original.name}
            </Link>
            <div className="mono mt-1 text-[11px] text-muted">
              {row.original.code}
            </div>
            {row.original.summary && kind !== "teams" && (
              <div
                className="mt-1 max-w-md truncate text-xs text-muted"
                title={row.original.summary}
              >
                {row.original.summary}
              </div>
            )}
          </div>
          {kind === "teams" && row.original.summary && (
            <DescriptionPreview
              name={row.original.name}
              description={row.original.summary}
              label="团队摘要"
            />
          )}
        </div>
      ),
    },
    {
      id: "members",
      header: "成员",
      cell: ({ row }) => `${row.original.member_count} 人`,
    },
    {
      id: "role",
      header: "资料权限",
      cell: ({ row }) =>
        row.original.direct_role === "admin"
          ? kind === "projects"
            ? "项目管理员"
            : "团队管理员"
          : row.original.direct_role === "member"
            ? kind === "projects"
              ? "项目成员"
              : "团队成员"
            : row.original.is_member
              ? "团队继承成员"
              : "系统管理",
    },
    {
      id: "status",
      header: "状态",
      cell: ({ row }) => (
        <StatusBadge
          tone={row.original.status === "active" ? "success" : "neutral"}
        >
          {row.original.status === "active"
            ? "正常"
            : row.original.status === "archived"
              ? "已归档"
              : "已解散"}
        </StatusBadge>
      ),
    },
    {
      id: "updated",
      header: "最近更新",
      cell: ({ row }) => (
        <span className="text-xs text-muted">
          {formatDate(row.original.updated_at)}
        </span>
      ),
    },
    {
      id: "actions",
      header: "操作",
      cell: ({ row }) =>
        kind === "teams" ? (
          <RowActions label={row.original.name} disabled={submission.pending}>
            <RowAction icon={<Users />} to={`/admin/teams/${row.original.id}`}>
              管理成员
            </RowAction>
            <RowAction
              icon={<Pencil />}
              disabled={!row.original.can_manage}
              onSelect={() => {
                void submission.run(async () => {
                  const response = await request<Resource>(
                    `/teams/${row.original.id}`,
                  );
                  setEditing(response.data);
                });
              }}
            >
              编辑资料
            </RowAction>
            <RowActionSeparator />
            <RowAction
              icon={<Trash2 />}
              variant="destructive"
              disabled={row.original.status !== "active"}
              onSelect={() => setDissolving(row.original)}
            >
              解散团队
            </RowAction>
          </RowActions>
        ) : (
          <Link
            className="link text-xs"
            to={`/admin/${kind}/${row.original.id}`}
          >
            查看
          </Link>
        ),
    },
  ];

  return (
    <div className="page">
      <PageHeader
        title={title}
        description={`管理全部${kind === "projects" ? "项目，包括你未参与的对象" : "团队及直接成员"}。`}
      />
      <ErrorNotice error={submission.error} />
      <section className="panel">
        <TableToolbar
          onReset={() => {
            search.setValue("");
            update({ q: "", status: "active" });
          }}
          onRefresh={() => void list.refetch()}
          refreshing={list.isFetching}
          actions={
            <Button
              className="flex items-center gap-2"
              onClick={() => setCreate(true)}
            >
              <Plus />
              创建{kind === "projects" ? "项目" : "团队"}
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
              {kind === "projects" ? "已归档" : "已解散"} ·{" "}
              {endedCount.data?.data.total ?? "—"}
            </option>
            <option value="all">全部</option>
          </StandaloneSelect>
        </TableToolbar>
        <AsyncBoundary
          loading={list.isPending}
          error={list.error}
          onRetry={() => void list.refetch()}
          empty={!list.data?.data.items.length}
          emptyTitle={
            q || status !== "active"
              ? "没有匹配的结果"
              : `暂无${kind === "projects" ? "项目" : "团队"}`
          }
          emptyDescription={
            q || status !== "active"
              ? "请调整筛选条件。"
              : "可通过右上角创建入口开始。"
          }
        >
          {list.data && (
            <DataTable
              actionColumn="actions"
              data={list.data.data.items}
              columns={
                kind === "teams"
                  ? columns.filter((column) => column.id !== "role")
                  : columns
              }
              label={title}
              rowKey={(row) => row.id}
              onRowClick={
                kind === "teams"
                  ? undefined
                  : (row) => navigate(`/admin/${kind}/${row.id}`)
              }
            />
          )}
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
      {dissolving && (
        <TeamDissolveDialog
          team={dissolving}
          onClose={() => setDissolving(null)}
        />
      )}
      <OverlayPresence>
        {editing && (
          <TeamProfileEditor
            team={editing}
            onClose={() => setEditing(null)}
            onSaved={() => {
              setEditing(null);
              void queryClient.invalidateQueries({ queryKey: ["teams"] });
              void queryClient.invalidateQueries({
                queryKey: ["team", editing.id],
              });
            }}
          />
        )}
      </OverlayPresence>
      <OverlayPresence>
        {create && (
          <ResourceCreateEditor
            kind={kind}
            separateDescription={kind === "teams"}
            onClose={() => setCreate(false)}
            onSaved={(resource) => {
              setCreate(false);
              void queryClient.invalidateQueries({ queryKey: [kind] });
              navigate(`/admin/${kind}/${resource.id}`);
            }}
          />
        )}
      </OverlayPresence>
    </div>
  );
}
