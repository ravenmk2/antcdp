import { OverlayPresence } from "@/components/overlay-presence";
import { TableToolbar } from "@/components/table-toolbar";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import type { DataColumn } from "@/components/table";
import { Plus, Star } from "lucide-react";
import { request } from "@/api/client";
import { useSession } from "@/app/auth";
import { Button } from "@/components/button";
import { AsyncBoundary, StatusBadge } from "@/components/feedback";
import { IconButton as ActionButton } from "@/components/button";
import { StandaloneInput, StandaloneSelect } from "@/components/fields";
import { PageHeader } from "@/components/layout";
import { Pagination } from "@/components/pagination";
import { ResourceIcon } from "@/components/resource-icon";
import { DataTable } from "@/components/table";
import { useApiQuery } from "@/hooks/use-api";
import { usePageSize } from "@/hooks/use-page-size";
import { useDebouncedSearch } from "@/hooks/use-search";
import { useSubmission } from "@/hooks/use-form";
import { formatDate } from "@/lib/utils";
import type {
  Page,
  Resource,
  ResourceKind,
  Shortcuts,
} from "@/types/collaboration";
import { ResourceEditor } from "./resource-editor";

export function ResourceList({ kind }: { kind: ResourceKind }) {
  const session = useSession();
  const location = useLocation();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const admin = location.pathname.startsWith("/admin");
  const scope = admin ? "all" : "mine";
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
  const shortcuts = useApiQuery<Shortcuts>(
    ["shortcuts", session.user.id],
    "/me/sidebar-shortcuts",
    { enabled: !admin },
  );
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
  const path = `/${kind}?${new URLSearchParams({ scope, q, status, page: String(page), page_size: String(size) })}`;
  const list = useApiQuery<Page<Resource>>(
    [kind, scope, q, status, page, size],
    path,
  );
  const activeCount = useApiQuery<Page<Resource>>(
    [kind, scope, q, "active-count"],
    `/${kind}?scope=${scope}&status=active&page=1&page_size=1&q=${encodeURIComponent(q)}`,
  );
  const endedCount = useApiQuery<Page<Resource>>(
    [kind, scope, q, "ended-count"],
    `/${kind}?scope=${scope}&status=${ended}&page=1&page_size=1&q=${encodeURIComponent(q)}`,
  );
  const title = admin
    ? kind === "projects"
      ? "项目管理"
      : "团队管理"
    : kind === "projects"
      ? "我的项目"
      : "我的团队";
  async function toggleShortcut(resource: Resource) {
    if (!shortcuts.data) return;
    const group = shortcuts.data.data[kind];
    const ids = group.items.map((item) => item.id);
    const next = ids.includes(resource.id)
      ? ids.filter((id) => id !== resource.id)
      : [...ids, resource.id];
    await submission.run(() =>
      request(`/me/sidebar-shortcuts/${kind}`, {
        method: "PUT",
        etag: group.etag,
        body: { ids: next },
      }).then(() => undefined),
    );
    await queryClient.invalidateQueries({ queryKey: ["shortcuts"] });
  }
  const columns: DataColumn<Resource>[] = [
    ...(!admin
      ? ([
          {
            id: "shortcut",
            header: "",
            cell: ({ row }: { row: { original: Resource } }) => {
              const selected = shortcuts.data?.data[kind].items.some(
                (item) => item.id === row.original.id,
              );
              return (
                <ActionButton
                  size="iconSm"
                  className={selected ? "star-active" : ""}
                  label={`${selected ? (kind === "projects" ? "取消关注" : "取消固定") : kind === "projects" ? "关注" : "固定"} ${row.original.name}`}
                  disabled={submission.pending}
                  onClick={(event) => {
                    event.stopPropagation();
                    void toggleShortcut(row.original);
                  }}
                >
                  <Star />
                </ActionButton>
              );
            },
          },
        ] as DataColumn<Resource>[])
      : []),
    {
      id: "resource",
      header: kind === "projects" ? "项目" : "团队",
      cell: ({ row }) => (
        <div className="flex min-w-56 items-center gap-3">
          <ResourceIcon resource={row.original} />
          <div className="min-w-0">
            <Link
              className="font-medium text-foreground hover:text-primary"
              to={`${admin ? "/admin" : ""}/${kind}/${row.original.id}`}
            >
              {row.original.name}
            </Link>
            <div className="mono mt-1 text-[11px] text-muted">
              {row.original.code}
            </div>
            {row.original.summary && (
              <div
                className="mt-1 max-w-md truncate text-xs text-muted"
                title={row.original.summary}
              >
                {row.original.summary}
              </div>
            )}
          </div>
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
      header: admin ? "资料权限" : "我的身份",
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
              : admin
                ? "系统管理"
                : "—",
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
          {formatDate(
            row.original.updated_at,
            session.user ? undefined : undefined,
          )}
        </span>
      ),
    },
    {
      id: "actions",
      header: "",
      cell: ({ row }) => (
        <Link
          className="link text-xs"
          to={`${admin ? "/admin" : ""}/${kind}/${row.original.id}`}
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
        description={
          admin
            ? `管理全部${kind === "projects" ? "项目，包括你未参与的对象" : "团队及直接成员"}。`
            : `仅展示你通过直接成员或团队关系参与的${kind === "projects" ? "项目" : "团队"}。`
        }
      />
      <section className="panel">
        <TableToolbar
          onReset={() => {
            search.setValue("");
            update({ q: "", status: "active" });
          }}
          onRefresh={() => void list.refetch()}
          refreshing={list.isFetching}
          actions={
            admin && (
              <Button
                className="flex items-center gap-2"
                onClick={() => setCreate(true)}
              >
                <Plus />
                创建{kind === "projects" ? "项目" : "团队"}
              </Button>
            )
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
              : admin
                ? "可通过右上角创建入口开始。"
                : "请联系项目或团队管理员加入。"
          }
        >
          {list.data && (
            <DataTable
              actionColumn="actions"
              data={list.data.data.items}
              columns={columns}
              label={title}
              rowKey={(row) => row.id}
              onRowClick={(row) =>
                navigate(`${admin ? "/admin" : ""}/${kind}/${row.id}`)
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
      <OverlayPresence>
        {create && admin && (
          <ResourceEditor
            kind={kind}
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
