import { useOperationToast } from "@/components/platform/operation-toast";
import { Star, Users as ShortcutUsers } from "lucide-react";
import {
  createContext,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Link, NavLink, useLocation } from "react-router";
import { Pin, Plus, ChevronUp, ChevronDown } from "lucide-react";
import type { Kind, Resource, Page } from "@/shared/collaboration";
import { request, errorMessage } from "@/lib/api";
import { useQuery } from "@/lib/use-query";
import { writeRequiresReview, writeReviewMessage } from "@/lib/write-error";
import { FormDrawer } from "@/components/platform/form-drawer";
import { Pagination } from "@/components/platform/pagination";
import { ErrorBox, AsyncState } from "@/components/platform/feedback";
import { Button } from "@/components/ui/button";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { ResourceIcon } from "./ResourceIcon";
type Group = { items: Resource[]; etag: string };
type Groups = Record<Kind, Group>;
const Context = createContext<{
  data?: Groups;
  pending: boolean;
  error?: string;
  refresh: () => void;
  manage: (kind: Kind) => void;
  toggle: (kind: Kind, resource: Resource) => void;
} | null>(null);
export function useShortcuts() {
  const value = useContext(Context);
  if (!value) throw new Error("Missing shortcuts provider");
  return value;
}
export function ShortcutsProvider({ children }: { children: ReactNode }) {
  const location = useLocation(),
    query = useQuery<Groups>("/me/sidebar-shortcuts", location.pathname);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [manager, setManager] = useState<{ kind: Kind; group: Group }>();
  const notify = useOperationToast();
  const locked = useRef(false);
  async function manage(kind: Kind) {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await request<Groups>("/me/sidebar-shortcuts");
      setManager({ kind, group: result.data[kind] });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  async function toggle(kind: Kind, resource: Resource) {
    if (locked.current || !query.data || !resource.is_member) return;
    const expected = query.data[kind].items.some((r) => r.id === resource.id);
    locked.current = true;
    setBusy(true);
    setError("");

    try {
      const latest = (await request<Groups>("/me/sidebar-shortcuts")).data[
          kind
        ],
        actual = latest.items.some((r) => r.id === resource.id);
      if (actual !== expected) {
        const label = kind === "projects" ? "关注" : "固定";
        notify(`${label}状态已在其他位置改变，请核对。`, "warning");
        setError(`${label}状态已在其他位置改变，请重新操作。`);
        return;
      }
      const ids = latest.items
        .filter((r) => r.id !== resource.id)
        .map((r) => r.id);
      if (!actual) ids.push(resource.id);
      await request(`/me/sidebar-shortcuts/${kind}`, {
        method: "PUT",
        etag: latest.etag,
        body: { ids },
      });
      notify(
        kind === "projects"
          ? actual
            ? "已取消关注。"
            : "已关注项目，可从侧栏进入。"
          : actual
            ? "已取消固定。"
            : "已固定到首页。",
      );
    } catch (e) {
      const review = writeRequiresReview(e);
      notify(
        review ? "快捷方式状态需核对。" : "快捷方式更新失败。",
        review ? "warning" : "danger",
      );
      setError(errorMessage(e));
    } finally {
      query.refresh();
      locked.current = false;
      setBusy(false);
    }
  }
  return (
    <Context
      value={{
        data: query.data,
        pending: query.loading || busy,
        error: error || query.error,
        refresh: () => {
          setError("");

          query.refresh();
        },
        manage: (kind) => void manage(kind),
        toggle: (kind, r) => void toggle(kind, r),
      }}
    >
      {children}
      {manager && (
        <ShortcutManager
          key={manager.kind}
          kind={manager.kind}
          initial={manager.group}
          onClose={() => setManager(undefined)}
          onSaved={() => {
            setManager(undefined);
            query.refresh();
            notify(
              manager.kind === "projects"
                ? "关注项目已保存。"
                : "快捷方式已保存。",
            );
          }}
        />
      )}
    </Context>
  );
}
export function ShortcutGroups({
  onNavigate,
  compact = false,
  kinds = ["projects", "teams"],
}: {
  onNavigate?: () => void;
  compact?: boolean;
  kinds?: readonly Kind[];
}) {
  const store = useShortcuts();
  return (
    <div className="my-3 max-h-[42dvh] space-y-3 overflow-y-auto">
      {kinds.map((kind) => (
        <section
          key={kind}
          aria-label={kind === "projects" ? "关注项目" : "团队快捷方式"}
        >
          <div
            className={
              compact
                ? "flex justify-center"
                : "group mb-1 flex items-center justify-between px-3"
            }
          >
            <h2
              className={
                compact
                  ? "sr-only"
                  : "text-[13px] font-medium text-muted-foreground"
              }
            >
              {kind === "projects" ? "关注项目" : "固定团队"}
            </h2>
            <Button
              variant="ghost"
              size="icon"
              className={
                compact
                  ? "size-9"
                  : "size-7 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:group-focus-within:opacity-100"
              }
              disabled={store.pending}
              aria-label={
                kind === "projects" ? "管理关注项目" : "管理团队快捷方式"
              }
              onClick={() => store.manage(kind)}
            >
              {compact ? (
                kind === "projects" ? (
                  <Star />
                ) : (
                  <ShortcutUsers />
                )
              ) : (
                <Plus className="size-3.5" />
              )}
            </Button>
          </div>
          {store.data?.[kind].items.map((r) => (
            <NavLink
              key={r.id}
              to={`/${kind}/${r.id}`}
              aria-label={r.name}
              title={r.name}
              onClick={onNavigate}
              className={`sidebar-link flex min-h-10 items-center gap-2 rounded-[6px] px-3 py-2 text-sm leading-5 ${compact ? "justify-center" : ""}`}
            >
              <ResourceIcon
                navigation
                iconKey={r.icon_key}
                fileId={r.icon_file_id}
                team={kind === "teams"}
              />
              {!compact && <span className="min-w-0 truncate">{r.name}</span>}
              {!compact && r.status === "archived" && (
                <span className="ml-auto text-[13px] text-muted-foreground">
                  归档
                </span>
              )}
            </NavLink>
          ))}
          {!compact &&
            !store.pending &&
            store.data &&
            !store.data[kind].items.length && (
              <button
                type="button"
                onClick={() => store.manage(kind)}
                className="px-3 py-1 text-left text-[13px] text-muted-foreground hover:text-foreground hover:underline"
              >
                {kind === "projects"
                  ? "暂无关注项目，选择项目"
                  : "选择常用团队固定到这里"}
              </button>
            )}
        </section>
      ))}
      {store.error && (
        <Button
          variant="ghost"
          className="w-full text-[13px]"
          onClick={store.refresh}
        >
          重新读取快捷方式
        </Button>
      )}
    </div>
  );
}
export function ShortcutFeedback() {
  const store = useShortcuts();
  if (!store.error) return null;
  return (
    <div className="mb-4 space-y-2">
      <ErrorBox>{store.error}</ErrorBox>
    </div>
  );
}
export function PinnedResources() {
  const store = useShortcuts();
  const groups = ["projects", "teams"] as const;
  const empty =
    store.data && groups.every((kind) => !store.data![kind].items.length);
  return (
    <section className="mt-8" aria-label="常用协作空间">
      <h2 className="mb-3 flex items-center gap-2 text-base font-semibold">
        <Star className="size-4 text-muted-foreground" />
        常用协作空间
      </h2>
      {!store.data && !store.error && (
        <p role="status" className="text-sm text-muted-foreground">
          正在读取常用协作空间…
        </p>
      )}
      {empty && (
        <div className="rounded-lg border border-dashed px-5 py-5">
          <p className="text-sm font-medium">让常用项目触手可及</p>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            关注的项目和固定的团队都可从首页进入；关注项目也会显示在侧栏。
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => store.manage("projects")}
              disabled={store.pending}
            >
              选择关注项目
            </Button>
            <Button variant="ghost" size="sm" asChild>
              <Link to="/projects">浏览我的项目</Link>
            </Button>
          </div>
        </div>
      )}
      <div className="grid gap-x-6 sm:grid-cols-2">
        {groups.map((kind) =>
          store.data?.[kind].items.length ? (
            <div key={kind} className="min-w-0">
              <h3 className="mb-1 text-[13px] text-muted-foreground">
                {kind === "projects" ? "关注项目" : "固定团队"}
              </h3>
              <ul className="divide-y">
                {store.data[kind].items.map((item) => (
                  <li key={item.id}>
                    <Link
                      className="flex items-center gap-3 rounded-md px-2 py-3 hover:bg-muted"
                      to={`/${kind}/${item.id}`}
                    >
                      <ResourceIcon
                        iconKey={item.icon_key}
                        fileId={item.icon_file_id}
                        team={kind === "teams"}
                      />
                      <span className="min-w-0 break-words text-sm font-medium">
                        {item.name}
                      </span>
                      {item.status === "archived" && (
                        <span className="ml-auto text-[13px] text-muted-foreground">
                          已归档
                        </span>
                      )}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ) : null,
        )}
      </div>
    </section>
  );
}
export function PinButton({
  kind,
  resource,
  menuItem = false,
}: {
  kind: Kind;
  resource: Resource;
  menuItem?: boolean;
}) {
  const store = useShortcuts(),
    pinned = store.data?.[kind].items.some((r) => r.id === resource.id);
  if (!resource.is_member) return null;
  const label =
    kind === "projects"
      ? pinned
        ? "取消关注"
        : "关注项目"
      : pinned
        ? "取消固定"
        : "固定到首页";
  const Icon = kind === "projects" ? Star : Pin;
  if (menuItem)
    return (
      <DropdownMenuItem
        disabled={store.pending || !store.data}
        onSelect={() => store.toggle(kind, resource)}
      >
        <Icon className={pinned ? "fill-current" : ""} />
        {label}
      </DropdownMenuItem>
    );
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={label}
      aria-pressed={!!pinned}
      disabled={store.pending || !store.data}
      onClick={() => store.toggle(kind, resource)}
    >
      <Icon className={pinned ? "fill-current" : ""} />
    </Button>
  );
}
function ShortcutManager({
  kind,
  initial,
  onClose,
  onSaved,
}: {
  kind: Kind;
  initial: Group;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [selected, setSelected] = useState(initial.items),
    [q, setQ] = useState(""),
    [page, setPage] = useState(1),
    [size, setSize] = useState(20);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [blocked, setBlocked] = useState(false),
    locked = useRef(false);
  const query = useQuery<Page>(
    `/${kind}?scope=mine&status=all&page=${page}&page_size=${size}&q=${encodeURIComponent(q)}`,
  );
  const dirty =
    selected.map((r) => r.id).join(",") !==
    initial.items.map((r) => r.id).join(",");
  function move(index: number, direction: number) {
    setSelected((old) => {
      const next = [...old],
        other = index + direction;
      if (other < 0 || other >= next.length) return old;
      [next[index], next[other]] = [next[other]!, next[index]!];
      return next;
    });
  }
  async function save() {
    if (locked.current || blocked) return;
    locked.current = true;
    setBusy(true);
    setError("");
    try {
      await request(`/me/sidebar-shortcuts/${kind}`, {
        method: "PUT",
        etag: initial.etag,
        body: { ids: selected.map((r) => r.id) },
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
  return (
    <FormDrawer
      title={kind === "projects" ? "管理关注项目" : "管理团队快捷方式"}
      description="选择你参与的对象并调整顺序，保存后在不同设备间同步。"
      dirty={dirty}
      pending={busy}
      onClose={onClose}
      footer={(close) => (
        <>
          <Button variant="outline" disabled={busy} onClick={() => close()}>
            取消
          </Button>
          <Button
            disabled={busy || blocked || !dirty}
            onClick={() => void save()}
          >
            {busy
              ? "正在保存…"
              : kind === "projects"
                ? "保存关注项目"
                : "保存快捷方式"}
          </Button>
        </>
      )}
    >
      <ErrorBox>{error}</ErrorBox>
      {blocked && (
        <p role="alert" className="text-sm">
          {writeReviewMessage}关闭后重新打开以读取最新顺序。
        </p>
      )}
      <section className="space-y-3">
        <h3 className="font-medium">已选 {selected.length} / 200</h3>
        <div className="max-h-72 space-y-2 overflow-y-auto">
          {selected.map((r, i) => (
            <div
              key={r.id}
              className="flex items-center gap-2 rounded-lg border p-2"
            >
              <span className="min-w-0 flex-1 truncate text-sm">{r.name}</span>
              <Button
                variant="ghost"
                size="icon"
                disabled={busy || i === 0}
                aria-label={`上移${r.name}`}
                onClick={() => move(i, -1)}
              >
                <ChevronUp />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                disabled={busy || i === selected.length - 1}
                aria-label={`下移${r.name}`}
                onClick={() => move(i, 1)}
              >
                <ChevronDown />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() =>
                  setSelected((s) => s.filter((x) => x.id !== r.id))
                }
              >
                {kind === "projects" ? "取消关注" : "取消固定"}
              </Button>
            </div>
          ))}
        </div>
      </section>
      <section className="space-y-4">
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setQ(String(new FormData(e.currentTarget).get("q") || ""));
            setPage(1);
          }}
        >
          <Input
            name="q"
            aria-label={
              kind === "projects" ? "搜索可关注项目" : "搜索可固定对象"
            }
            placeholder="搜索我参与的对象"
            disabled={busy}
          />
          <Button variant="outline" disabled={busy}>
            搜索
          </Button>
        </form>
        <AsyncState
          loading={query.loading}
          error={query.error}
          empty={!query.data?.items.length}
          onRetry={query.refresh}
        >
          {query.data?.items.map((r) => (
            <label
              key={r.id}
              className="flex items-center gap-3 rounded-lg border p-3 text-sm"
            >
              <Checkbox
                checked={selected.some((s) => s.id === r.id)}
                disabled={
                  busy ||
                  (selected.length >= 200 &&
                    !selected.some((s) => s.id === r.id))
                }
                onCheckedChange={(checked) =>
                  setSelected((s) =>
                    checked ? [...s, r] : s.filter((x) => x.id !== r.id),
                  )
                }
              />
              <ResourceIcon
                iconKey={r.icon_key}
                fileId={r.icon_file_id}
                team={kind === "teams"}
              />
              <span>
                {r.name}
                <span className="ml-2 text-[13px] text-muted-foreground">
                  {r.code}
                </span>
              </span>
            </label>
          ))}
        </AsyncState>
        {query.data && (
          <Pagination
            page={page}
            size={size}
            total={query.data.total}
            pending={query.loading || busy}
            onChange={(p, n) => {
              setPage(p);
              setSize(n);
            }}
          />
        )}
      </section>
    </FormDrawer>
  );
}
