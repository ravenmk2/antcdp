import { Pagination } from "@/components/platform/pagination";
import { useEffect, useRef, useState } from "react";
import type {
  RemoteRepository,
  RepositoryGroup,
  RepositoryConnection,
  CursorPage,
} from "@/shared/repositories";
import { Folder, ChevronRight, X } from "lucide-react";
import { useQuery } from "@/lib/use-query";
import { request, errorMessage } from "@/lib/api";
import { writeRequiresReview, writeReviewMessage } from "@/lib/write-error";
import { FormDrawer } from "@/components/platform/form-drawer";
import { NativeSelect } from "@/components/platform/native-select";
import { AsyncState, ErrorBox } from "@/components/platform/feedback";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";

type Selection = Map<string, RemoteRepository>;
function useSearch(value: string) {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value.trim()), 300);
    return () => clearTimeout(timer);
  }, [value]);
  return { q: settled, waiting: settled !== value.trim() };
}
export function RepositoryPicker({
  projectId,
  connections,
  etag,
  onClose,
  onSaved,
}: {
  projectId: string;
  connections: RepositoryConnection[];
  etag: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [tag] = useState(etag),
    [connection, setConnection] = useState(
      connections.find((c) => c.enabled)?.id || "",
    ),
    [change, setChange] = useState("");
  const [selected, setSelected] = useState<Selection>(new Map()),
    [showSelected, setShowSelected] = useState(false);
  const [busy, setBusy] = useState(false),
    [blocked, setBlocked] = useState(false),
    [error, setError] = useState("");
  const locked = useRef(false);
  function switchTo(id: string) {
    setConnection(id);
    setSelected(new Map());
    setShowSelected(false);
    setChange("");
    setError("");
  }
  function select(items: RemoteRepository[], on: boolean) {
    const next = new Map(selected);
    for (const item of items) {
      if (on && !item.already_linked) next.set(item.repo_id, item);
      else next.delete(item.repo_id);
    }
    if (next.size > 100) {
      setError("每批最多关联 100 个仓库。");
      return;
    }
    setSelected(next);
    setError("");
  }
  async function save() {
    if (
      locked.current ||
      blocked ||
      !tag ||
      !selected.size ||
      !connection ||
      change
    )
      return;
    locked.current = true;
    setBusy(true);
    setError("");
    try {
      await request("/projects/" + projectId + "/repositories", {
        method: "POST",
        etag: tag,
        body: { connection_id: connection, repo_ids: [...selected.keys()] },
      });
      onSaved();
    } catch (e) {
      setError(errorMessage(e));
      setBlocked(writeRequiresReview(e));
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  const directory =
    "/admin/projects/" + projectId + "/repository-connections/" + connection;
  return (
    <FormDrawer
      title="关联 Git 仓库"
      description="先选择服务连接，再从远端目录中挑选仓库。"
      dirty={!!selected.size}
      pending={busy}
      onClose={onClose}
      footer={(close) => (
        <>
          <Button
            variant="ghost"
            className="mr-auto"
            disabled={busy}
            onClick={() => setShowSelected(!showSelected)}
          >
            {showSelected ? "返回目录" : "查看已选"} · {selected.size}
          </Button>
          <Button variant="outline" disabled={busy} onClick={() => close()}>
            取消
          </Button>
          <Button
            disabled={busy || blocked || !selected.size || !!change || !tag}
            onClick={() => void save()}
          >
            {busy ? "正在关联…" : "确认关联"}
          </Button>
        </>
      )}
    >
      <label className="block max-w-md space-y-2 text-sm font-medium">
        <span>服务连接</span>
        <NativeSelect
          value={connection}
          disabled={busy || blocked}
          onChange={(e) =>
            selected.size ? setChange(e.target.value) : switchTo(e.target.value)
          }
        >
          {!connection && <option value="">没有可用的连接</option>}
          {connections.map((c) => (
            <option key={c.id} value={c.id} disabled={!c.enabled}>
              {c.name}
              {!c.enabled && " · 已停用"}
            </option>
          ))}
        </NativeSelect>
      </label>
      {change && (
        <section
          role="alert"
          className="space-y-3 rounded-lg border bg-muted p-4"
        >
          <p>切换连接会清空已选的 {selected.size} 个仓库。</p>
          <Button variant="outline" onClick={() => setChange("")}>
            保留选择
          </Button>{" "}
          <Button onClick={() => switchTo(change)}>清空并切换</Button>
        </section>
      )}
      <ErrorBox>{error}</ErrorBox>
      {blocked && (
        <p role="alert">{writeReviewMessage}关闭后核对项目已关联列表。</p>
      )}
      <fieldset disabled={busy || blocked || !!change} className="min-w-0">
        <div hidden={showSelected}>
          {connection && (
            <Directory
              key={connection}
              base={directory}
              selected={selected}
              onSelect={select}
            />
          )}
        </div>
        {showSelected && (
          <section>
            <h3 className="mb-3 font-medium">
              已选仓库 · {selected.size} / 100
            </h3>
            {selected.size === 0 && (
              <p className="text-sm text-muted-foreground">尚未选择仓库。</p>
            )}
            <ul className="divide-y">
              {[...selected.values()].map((r) => (
                <li
                  key={r.repo_id}
                  className="flex items-center justify-between gap-2 py-2"
                >
                  <span className="break-all">{r.full_path}</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={"移除 " + r.full_path}
                    onClick={() => select([r], false)}
                  >
                    <X />
                  </Button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </fieldset>
    </FormDrawer>
  );
}
function Directory({
  base,
  selected,
  onSelect,
}: {
  base: string;
  selected: Selection;
  onSelect: (items: RemoteRepository[], on: boolean) => void;
}) {
  const [trail, setTrail] = useState<RepositoryGroup[]>([]),
    [scope, setScope] = useState("all"),
    [recursive, setRecursive] = useState(false),
    [term, setTerm] = useState(""),
    [groupTerm, setGroupTerm] = useState("");
  const [open, setOpen] = useState(false);
  const current = trail.at(-1),
    search = useSearch(term),
    groupSearch = useSearch(groupTerm);
  const groupQuery = new URLSearchParams();
  if (groupSearch.q) groupQuery.set("q", groupSearch.q);
  else if (current) groupQuery.set("parent_id", current.id);
  const query = new URLSearchParams({ q: search.q });
  if (scope === "group" && current) {
    query.set("container_id", current.id);
    query.set("recursive", String(recursive));
  }
  function goto(next: RepositoryGroup[]) {
    setTrail(next);
    setGroupTerm("");
    setScope(next.length ? "group" : "all");
    setRecursive(false);
    setOpen(false);
  }
  return (
    <div className="space-y-3">
      <nav
        aria-label="组路径"
        className="flex flex-wrap items-center gap-1 text-sm"
      >
        <Button size="sm" variant="ghost" onClick={() => goto([])}>
          全部分组
        </Button>
        {trail.map((g, i) => (
          <span className="inline-flex items-center" key={g.id}>
            <ChevronRight className="size-3" />
            <Button
              size="sm"
              variant="ghost"
              onClick={() => goto(trail.slice(0, i + 1))}
            >
              {g.name}
            </Button>
          </span>
        ))}
      </nav>
      <Button
        variant="outline"
        className="lg:hidden"
        onClick={() => setOpen(!open)}
      >
        {open ? "收起分组" : "浏览分组"}
      </Button>
      <div className="grid gap-4 lg:grid-cols-[minmax(11rem,1fr)_minmax(0,2.2fr)]">
        <section
          className={
            (open ? "block" : "hidden") +
            " min-w-0 rounded-lg border p-3 lg:block"
          }
        >
          <h3 className="mb-2 font-medium">分组</h3>
          <Input
            aria-label="搜索分组"
            type="search"
            value={groupTerm}
            onChange={(e) => setGroupTerm(e.target.value)}
            placeholder="搜索分组"
          />
          <div className="mt-3 max-h-[42dvh] overflow-y-auto">
            {groupSearch.waiting ? (
              <p role="status">正在搜索…</p>
            ) : (
              <Groups
                key={groupQuery.toString()}
                path={base + "/containers?" + groupQuery}
                onEnter={(g) => goto(groupSearch.q ? [g] : [...trail, g])}
              />
            )}
          </div>
        </section>
        <section className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Input
              aria-label="搜索远端仓库"
              type="search"
              placeholder="搜索远端仓库"
              className="min-w-32 flex-1"
              value={term}
              onChange={(e) => setTerm(e.target.value)}
            />
            <NativeSelect
              aria-label="搜索范围"
              className="w-auto"
              value={scope}
              onChange={(e) => setScope(e.target.value)}
            >
              <option value="all">全部仓库</option>
              <option value="group" disabled={!current}>
                当前组
              </option>
            </NativeSelect>
          </div>
          {scope === "group" && (
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={recursive}
                onCheckedChange={(v) => setRecursive(v === true)}
              />
              包含子组
            </label>
          )}
          {search.waiting ? (
            <p role="status">正在搜索…</p>
          ) : (
            <Results
              key={query.toString()}
              path={base + "/repos?" + query}
              selected={selected}
              onSelect={onSelect}
            />
          )}
        </section>
      </div>
    </div>
  );
}
function Groups({
  path,
  onEnter,
}: {
  path: string;
  onEnter: (g: RepositoryGroup) => void;
}) {
  const [cursors, setCursors] = useState([""]);
  return cursors.map((cursor, i) => (
    <GroupPage
      key={cursor}
      path={path + "&cursor=" + encodeURIComponent(cursor)}
      onEnter={onEnter}
      last={i === cursors.length - 1}
      more={(c) => setCursors((old) => (old.includes(c) ? old : [...old, c]))}
    />
  ));
}
function GroupPage({
  path,
  onEnter,
  last,
  more,
}: {
  path: string;
  onEnter: (g: RepositoryGroup) => void;
  last: boolean;
  more: (c: string) => void;
}) {
  const query = useQuery<CursorPage<RepositoryGroup>>(path);
  return (
    <AsyncState
      loading={query.loading}
      error={query.error}
      onRetry={query.refresh}
      empty={!query.data?.items.length}
    >
      {query.data?.items.map((g) => (
        <button
          key={g.id}
          onClick={() => onEnter(g)}
          className="flex w-full items-start gap-2 rounded-md p-2 text-left text-sm hover:bg-muted"
        >
          <Folder className="mt-1 size-4 shrink-0" />
          <span className="min-w-0 break-all">
            {g.name}
            <small className="block text-muted-foreground">{g.full_path}</small>
          </span>
        </button>
      ))}
      {last && query.data?.next_cursor && (
        <Button variant="ghost" onClick={() => more(query.data!.next_cursor!)}>
          加载更多分组
        </Button>
      )}
    </AsyncState>
  );
}
function Results({
  path,
  selected,
  onSelect,
}: {
  path: string;
  selected: Selection;
  onSelect: (items: RemoteRepository[], on: boolean) => void;
}) {
  const [cursors, setCursors] = useState([""]),
    [size, setSize] = useState(20),
    cursor = cursors.at(-1)!;
  const query = useQuery<CursorPage<RemoteRepository>>(
      path + "&limit=" + size + "&cursor=" + encodeURIComponent(cursor),
    ),
    items = query.data?.items || [],
    available = items.filter((r) => !r.already_linked);
  const count = available.filter((r) => selected.has(r.repo_id)).length;
  return (
    <>
      <div className="overflow-hidden rounded-lg border">
        <label className="flex items-center gap-3 bg-muted/60 px-3 py-2 text-sm">
          <Checkbox
            disabled={!available.length}
            checked={
              count > 0 && count !== available.length
                ? "indeterminate"
                : count > 0
            }
            onCheckedChange={(v) => onSelect(available, v === true)}
          />
          选择当前页
        </label>
        <div className="max-h-[42dvh] overflow-y-auto">
          <AsyncState
            loading={query.loading}
            error={query.error}
            onRetry={query.refresh}
            empty={!items.length}
          >
            {items.map((r) => (
              <label
                className="flex items-center gap-3 border-t px-3 py-2.5 text-sm"
                key={r.repo_id}
              >
                <Checkbox
                  checked={selected.has(r.repo_id)}
                  disabled={r.already_linked}
                  onCheckedChange={(v) => onSelect([r], v === true)}
                />
                <span className="min-w-0 flex-1 break-all">
                  <strong className="font-medium">{r.name}</strong>
                  <small className="block text-muted-foreground">
                    {r.full_path}
                  </small>
                </span>
                {r.already_linked && <small>已关联</small>}
              </label>
            ))}
          </AsyncState>
        </div>
      </div>
      {query.data && (
        <Pagination
          page={cursors.length}
          size={size}
          pageItems={items.length}
          hasNext={Boolean(query.data.next_cursor)}
          pending={query.loading}
          onChange={(page, newSize) => {
            if (newSize !== size) {
              setSize(newSize);
              setCursors([""]);
            } else if (page < cursors.length)
              setCursors((old) => old.slice(0, -1));
            else if (query.data?.next_cursor)
              setCursors([...cursors, query.data.next_cursor]);
          }}
        />
      )}
    </>
  );
}
