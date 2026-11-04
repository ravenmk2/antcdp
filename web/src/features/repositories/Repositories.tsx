import { useOperationToast } from "@/components/platform/operation-toast";
import { Unlink as UnlinkAction, RefreshCw as SyncAction } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type {
  ProjectRepository,
  RepositoryPage,
  RepositoryConnection,
} from "@/shared/repositories";
import { MoreHorizontal, Plus, Search } from "lucide-react";
import { useQuery } from "@/lib/use-query";
import { useDate } from "@/lib/date";
import { NativeSelect } from "@/components/platform/native-select";
import { Pagination } from "@/components/platform/pagination";
import {
  AsyncState,
  RefreshButton,
  ErrorBox,
} from "@/components/platform/feedback";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableHeader,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { RepositoryPicker } from "./RepositoryPicker";
import { RepositoryDetail } from "./RepositoryDetail";
import { Unlink, Sync } from "./RepositoryActions";
type Action =
  | { type: "detail"; repo: ProjectRepository }
  | { type: "picker"; tag: string }
  | { type: "unlink" | "sync"; rows: ProjectRepository[]; tag: string };
export function Repositories({
  projectId,
  canManage,
}: {
  projectId: string;
  canManage: boolean;
}) {
  const base = "/projects/" + projectId + "/repositories",
    date = useDate();
  const [term, setTerm] = useState(""),
    [q, setQ] = useState(""),
    [connection, setConnection] = useState(""),
    [page, setPage] = useState(1),
    [size, setSize] = useState(20);
  const [batch, setBatch] = useState(false),
    [selected, setSelected] = useState(new Map<string, ProjectRepository>()),
    [action, setAction] = useState<Action>(),
    [notice, setNotice] = useState("");
  const params = new URLSearchParams({
    q,
    page: String(page),
    page_size: String(size),
  });
  if (connection) params.set("connection_id", connection);
  const query = useQuery<RepositoryPage>(base + "?" + params),
    directory = useQuery<{ items: RepositoryConnection[] }>(
      canManage
        ? "/admin/projects/" + projectId + "/repository-connections"
        : null,
    );
  const [known, setKnown] = useState(new Map<string, string>());
  const options = useMemo(() => {
    const map = new Map(known);
    directory.data?.items.forEach((c) => map.set(c.id, c.name));
    return [...map];
  }, [known, directory.data]);
  useEffect(() => {
    if (query.data) {
      setKnown((old) => {
        const next = new Map(old);
        for (const r of query.data!.items)
          next.set(r.connection_id, r.connection_name);
        return next;
      });
      if (!query.data.items.length && page > 1)
        setPage(Math.max(1, Math.ceil(query.data.total / size)));
    }
  }, [query.data, page, size]);
  useEffect(() => {
    const timer = setTimeout(() => {
      setQ(term.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [term]);
  function resetSelection() {
    if (selected.size) setNotice("筛选条件已改变，已清空选择。");
    setSelected(new Map());
  }
  function filterTerm(value: string) {
    setTerm(value);
    resetSelection();
  }
  function select(rows: ProjectRepository[], on: boolean) {
    setSelected((old) => {
      const next = new Map(old);
      for (const row of rows) {
        if (on) next.set(row.id, row);
        else next.delete(row.id);
      }
      return next;
    });
  }
  function start(type: "unlink" | "sync", rows: ProjectRepository[]) {
    if (canManage && rows.length && query.data?.mutation_version)
      setAction({ type, rows, tag: query.data.mutation_version });
  }
  const notify = useOperationToast();
  function saved(message: string) {
    setAction(undefined);
    setSelected(new Map());
    setNotice("");
    notify(message);
    query.refresh();
  }
  const data = query.data,
    items = data?.items || [],
    selectedOnPage = items.filter((r) => selected.has(r.id)).length;
  const loading = query.loading || term.trim() !== q;
  return (
    <section className="space-y-4" aria-label="项目 Git 仓库">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          查看关联仓库的快照、分支和克隆地址。
        </p>
        {canManage && (
          <Button
            disabled={
              !data || loading || directory.loading || !!directory.error
            }
            onClick={() =>
              setAction({ type: "picker", tag: data!.mutation_version })
            }
          >
            <Plus />
            关联仓库
          </Button>
        )}
      </div>
      {directory.error && (
        <div>
          <ErrorBox>{directory.error}</ErrorBox>
          <Button variant="ghost" onClick={directory.refresh}>
            重新读取服务连接
          </Button>
        </div>
      )}
      {notice && (
        <p role="status" className="text-sm text-muted-foreground">
          {notice}
        </p>
      )}
      <div className="min-w-0 overflow-hidden rounded-xl border bg-card">
        <div className="flex flex-wrap items-center gap-2 p-4">
          <label className="relative min-w-36 flex-1 sm:max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-3 size-4 text-muted-foreground" />
            <Input
              className="pl-9"
              type="search"
              aria-label="搜索已关联仓库"
              value={term}
              onChange={(e) => filterTerm(e.target.value)}
              placeholder="搜索仓库名称或路径"
            />
          </label>
          <NativeSelect
            className="w-auto"
            aria-label="按连接筛选"
            value={connection}
            onChange={(e) => {
              setConnection(e.target.value);
              setPage(1);
              resetSelection();
            }}
          >
            <option value="">全部连接</option>
            {options.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </NativeSelect>
          <RefreshButton loading={loading} onClick={query.refresh} />
          {canManage && (
            <Button
              className="sm:ml-auto"
              variant="outline"
              aria-pressed={batch}
              onClick={() => {
                setBatch(!batch);
                setSelected(new Map());
              }}
            >
              {batch ? "退出批量操作" : "批量操作"}
            </Button>
          )}
        </div>
        {canManage && batch && (
          <div className="flex flex-wrap items-center gap-3 border-t bg-muted/45 px-4 py-2">
            <span className="mr-auto text-sm">已选 {selected.size} 个</span>
            <Button
              size="sm"
              variant="outline"
              disabled={!selected.size || loading}
              onClick={() => start("sync", [...selected.values()])}
            >
              同步所选
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={!selected.size || loading}
                  aria-label="批量更多操作"
                >
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem
                  variant="destructive"
                  onSelect={() => start("unlink", [...selected.values()])}
                >
                  <UnlinkAction /> 解除所选关联
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
        <AsyncState
          loading={loading}
          error={query.error}
          empty={!items.length}
          onRetry={query.refresh}
        >
          <Table aria-label="已关联仓库">
            <TableHeader>
              <TableRow>
                {canManage && batch && (
                  <TableHead>
                    <Checkbox
                      aria-label="选择当前页"
                      checked={
                        selectedOnPage > 0 && selectedOnPage < items.length
                          ? "indeterminate"
                          : selectedOnPage > 0
                      }
                      onCheckedChange={(v) => select(items, v === true)}
                    />
                  </TableHead>
                )}
                <TableHead>仓库</TableHead>
                <TableHead>服务连接</TableHead>
                <TableHead>默认分支</TableHead>
                <TableHead>最近同步</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((r) => (
                <TableRow key={r.id}>
                  {canManage && batch && (
                    <TableCell>
                      <Checkbox
                        aria-label={"选择 " + r.full_path}
                        checked={selected.has(r.id)}
                        onCheckedChange={(v) => select([r], v === true)}
                      />
                    </TableCell>
                  )}
                  <TableCell>
                    <button
                      className="font-medium hover:underline"
                      onClick={() => setAction({ type: "detail", repo: r })}
                    >
                      {r.name}
                    </button>
                    {r.remote_archived && (
                      <small className="ml-2 text-muted-foreground">
                        远端已归档
                      </small>
                    )}
                    <div className="mt-1 text-xs text-muted-foreground">
                      {r.full_path}
                    </div>
                  </TableCell>
                  <TableCell>
                    {r.connection_name}
                    {!r.connection_enabled && " · 已停用"}
                  </TableCell>
                  <TableCell>{r.default_branch || "未提供"}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {date(r.last_synced_at)}
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setAction({ type: "detail", repo: r })}
                      >
                        详情
                      </Button>
                      {canManage && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              size="icon"
                              variant="ghost"
                              aria-label={r.full_path + " 更多操作"}
                            >
                              <MoreHorizontal />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              disabled={!r.connection_enabled}
                              onSelect={() => start("sync", [r])}
                            >
                              <SyncAction /> 同步信息
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              variant="destructive"
                              onSelect={() => start("unlink", [r])}
                            >
                              <UnlinkAction /> 解除关联
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </AsyncState>
        {data && !loading && (
          <Pagination
            page={page}
            size={size}
            total={data.total}
            onChange={(n, s) => {
              setPage(n);
              setSize(s);
            }}
          />
        )}
      </div>
      {action?.type === "detail" && (
        <RepositoryDetail
          base={base}
          repo={action.repo}
          onClose={() => setAction(undefined)}
        />
      )}
      {action?.type === "picker" && canManage && (
        <RepositoryPicker
          projectId={projectId}
          connections={directory.data?.items || []}
          etag={action.tag}
          onClose={() => setAction(undefined)}
          onSaved={() => saved("仓库已关联。")}
        />
      )}
      {action?.type === "unlink" && (
        <Unlink
          base={base}
          rows={action.rows}
          etag={action.tag}
          allowed={canManage}
          onClose={() => setAction(undefined)}
          onSaved={() => saved("已解除仓库关联。")}
        />
      )}
      {action?.type === "sync" && (
        <Sync
          base={base}
          rows={action.rows}
          allowed={canManage}
          onClose={() => setAction(undefined)}
          onDone={(ids) => {
            setSelected((old) => {
              const next = new Map(old);
              ids.forEach((id) => next.delete(id));
              return next;
            });
            query.refresh();
          }}
        />
      )}
    </section>
  );
}
