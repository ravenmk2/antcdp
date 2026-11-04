import { useOperationToast } from "@/components/platform/operation-toast";
import { StatusText } from "@/components/platform/status-text";
import { useEffect, useRef, useState } from "react";
import {
  useLoaderData,
  useNavigation,
  useRevalidator,
  useSearchParams,
} from "react-router";
import {
  MoreHorizontal,
  Plus,
  Search,
  ShieldCheck,
  Power,
  KeyRound,
  Trash2,
  FilterX,
} from "lucide-react";
import type { User } from "@/app/identity";
import { useIdentity, invalidateIdentity } from "@/app/identity";
import { adminLoader } from "@/lib/loaders";
import { savedPageSize, rememberPageSize } from "@/lib/page-size";
import { request, errorMessage } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
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
import { Pagination } from "@/components/platform/pagination";
import { Avatar } from "@/components/platform/avatar";
import { ErrorBox, RefreshButton } from "@/components/platform/feedback";
import { UserEditor, type UserAction, type EditTarget } from "./UserEditor";

type Counts = {
  users_total: number;
  users_active: number;
  users_disabled: number;
};
export async function loader(args: { request: Request }) {
  await adminLoader(args);
  const q = new URL(args.request.url).searchParams;
  const page = Math.max(1, Math.floor(Number(q.get("page")) || 1));
  const size = [10, 20, 50, 100].includes(Number(q.get("page_size")))
    ? Number(q.get("page_size"))
    : savedPageSize("users");
  const status = ["active", "disabled"].includes(q.get("status") || "")
    ? q.get("status")!
    : "";
  const identity = ["founder", "admin", "user"].includes(
    q.get("identity") || "",
  )
    ? q.get("identity")!
    : "";
  const search = (q.get("q") || "").trim();
  const params = new URLSearchParams({
    q: search,
    status,
    identity,
    page: String(page),
    page_size: String(size),
  });
  try {
    const [list, overview] = await Promise.all([
      request<User[]>(`/admin/users?${params}`, {
        signal: args.request.signal,
      }),
      request<Counts>("/admin/overview", { signal: args.request.signal }),
    ]);
    return {
      users: list.data,
      total: list.pagination?.total,
      hasNext: Boolean(list.pagination?.has_more),
      counts: overview.data,
      page,
      size,
      status,
      identity,
      search,
      error: "",
    };
  } catch (e) {
    if (args.request.signal.aborted) throw e;
    return {
      users: [] as User[],
      total: 0,
      hasNext: false,
      counts: null,
      page,
      size,
      status,
      identity,
      search,
      error: errorMessage(e),
    };
  }
}
export function Component() {
  const data = useLoaderData<typeof loader>();
  const identity = useIdentity();
  const revalidator = useRevalidator();
  const navigation = useNavigation();
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState(data.search);
  const composing = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const detailSequence = useRef(0);
  const [opening, setOpening] = useState(false);
  const [editor, setEditor] = useState<EditTarget>();
  const [error, setError] = useState("");
  const notify = useOperationToast();
  const pending = revalidator.state !== "idle" || navigation.state !== "idle";
  useEffect(() => {
    setQuery(data.search);
  }, [data.search]);
  useEffect(
    () => () => {
      clearTimeout(timer.current);
      detailSequence.current++;
    },
    [],
  );
  function filters(values: Record<string, string>) {
    clearTimeout(timer.current);
    setParams((previous) => {
      const next = new URLSearchParams(previous);
      next.delete("create");
      next.set("page", "1");
      for (const [k, v] of Object.entries(values)) {
        if (v) next.set(k, v);
        else next.delete(k);
      }
      return next;
    });
  }
  function search(value: string, immediate = false) {
    setQuery(value);
    clearTimeout(timer.current);
    if (composing.current) return;
    if (immediate) filters({ q: value.trim() });
    else timer.current = setTimeout(() => filters({ q: value.trim() }), 600);
  }
  async function open(mode: UserAction, user?: User) {
    if (opening) return;
    setError("");

    if (mode === "create") {
      setEditor({ mode });
      return;
    }
    const current = ++detailSequence.current;
    setOpening(true);
    try {
      const r = await request<User>(`/admin/users/${user!.id}`);
      if (current === detailSequence.current)
        setEditor({ mode, user: r.data, etag: r.etag });
    } catch (e) {
      if (current === detailSequence.current) setError(errorMessage(e));
    } finally {
      if (current === detailSequence.current) setOpening(false);
    }
  }
  useEffect(() => {
    if (params.get("create") === "1") {
      setEditor({ mode: "create" });
      const next = new URLSearchParams(params);
      next.delete("create");
      setParams(next, { replace: true });
    }
  }, [params, setParams]);
  function closeEditor() {
    setEditor(undefined);
  }
  const date = (value: string | null) =>
    value
      ? new Intl.DateTimeFormat("zh-CN", {
          timeZone: identity.settings.timezone,
          dateStyle: "medium",
          timeStyle: "short",
        }).format(new Date(value))
      : "尚无记录";
  return (
    <section aria-label="用户管理" className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">用户管理</h1>
      <ErrorBox>{error}</ErrorBox>

      <div className="min-w-0 overflow-hidden rounded-xl border bg-card">
        <div className="list-toolbar">
          <form
            className="relative flex min-w-40 flex-1 gap-2 sm:max-w-72"
            onSubmit={(e) => {
              e.preventDefault();
              search(query, true);
            }}
          >
            <Search className="pointer-events-none absolute top-3 left-3 size-4 text-muted-foreground" />
            <Input
              className="pl-9"
              aria-label="搜索用户名或显示名称"
              placeholder="搜索用户名或显示名称…"
              value={query}
              onChange={(e) => search(e.target.value)}
              onKeyDown={(e) => {
                if (
                  e.key === "Enter" &&
                  (composing.current ||
                    e.nativeEvent.isComposing ||
                    e.nativeEvent.keyCode === 229)
                )
                  e.preventDefault();
              }}
              onCompositionStart={() => {
                composing.current = true;
                clearTimeout(timer.current);
              }}
              onCompositionEnd={(e) => {
                composing.current = false;
                search(e.currentTarget.value);
              }}
            />
          </form>
          <div
            className="flex max-w-full gap-0.5 overflow-auto rounded-lg bg-muted p-1"
            aria-label="用户状态"
          >
            {[
              ["", "全部用户", data.counts?.users_total],
              ["active", "正常账号", data.counts?.users_active],
              ["disabled", "已禁用", data.counts?.users_disabled],
            ].map(([value, label, count]) => (
              <Button
                key={value}
                className="h-8 gap-1 px-2 aria-pressed:bg-card aria-pressed:text-foreground aria-pressed:shadow-sm"
                variant={data.status === value ? "secondary" : "ghost"}
                aria-pressed={data.status === value}
                onClick={() => filters({ status: String(value) })}
              >
                {label}
                <span className="tabular-nums text-muted-foreground">
                  {count ?? "—"}
                </span>
              </Button>
            ))}
          </div>

          <select
            className="h-[var(--control-height)] rounded-md border bg-background px-3 text-sm"
            aria-label="筛选用户身份"
            value={data.identity}
            onChange={(e) => filters({ identity: e.target.value })}
          >
            <option value="">全部身份</option>
            <option value="founder">创始人</option>
            <option value="admin">管理员</option>
            <option value="user">普通用户</option>
          </select>
          <Button
            variant="ghost"
            size="icon"
            aria-label="清除筛选"
            title="清除筛选"
            disabled={!data.search && !data.status && !data.identity && !query}
            onClick={() => {
              setQuery("");
              filters({ q: "", status: "", identity: "" });
            }}
          >
            <FilterX />
          </Button>
          <RefreshButton
            loading={pending}
            onClick={() => void revalidator.revalidate()}
          />
          <Button
            className="sm:ml-auto"
            onClick={() => void open("create")}
            disabled={opening}
          >
            <Plus />
            添加用户
          </Button>
        </div>
        <div aria-busy={pending} className="min-w-0">
          <ErrorBox>{data.error}</ErrorBox>
          {data.error ? (
            <Button
              className="mt-4"
              variant="outline"
              onClick={() => void revalidator.revalidate()}
            >
              重新加载
            </Button>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>用户</TableHead>
                    <TableHead>身份</TableHead>
                    <TableHead>状态</TableHead>
                    <TableHead>创建时间</TableHead>
                    <TableHead>最近登录</TableHead>
                    <TableHead className="text-right">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.users.map((user) => {
                    const self = user.id === identity.session.user.id;
                    const manage = !user.is_founder && !self;
                    return (
                      <TableRow key={user.id}>
                        <TableCell>
                          <div className="flex items-center gap-3">
                            <Avatar
                              url={user.avatar?.url}
                              name={user.display_name}
                            />
                            <div className="max-w-72 whitespace-normal break-words">
                              <div className="font-medium">
                                <span className="hidden sm:inline">
                                  {user.display_name}
                                </span>
                                <button
                                  type="button"
                                  className="min-h-9 text-left underline sm:hidden"
                                  disabled={opening || pending}
                                  onClick={() => void open("edit", user)}
                                  aria-label={"编辑 " + user.display_name}
                                >
                                  {user.display_name}
                                </button>
                                {self && (
                                  <span className="ml-2 text-xs text-muted-foreground">
                                    你
                                  </span>
                                )}
                              </div>
                              <div className="text-xs text-muted-foreground">
                                @{user.username}
                              </div>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary">
                            {user.is_founder
                              ? "创始人"
                              : user.role === "admin"
                                ? "管理员"
                                : "普通用户"}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <StatusText
                            tone={
                              user.status === "active" ? "success" : "neutral"
                            }
                          >
                            {user.status === "active" ? "正常" : "已禁用"}
                          </StatusText>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {date(user.created_at)}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {date(user.last_login_at)}
                        </TableCell>
                        <TableCell>
                          <div className="flex justify-end gap-1">
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={opening || (user.is_founder && !self)}
                              onClick={() => void open("edit", user)}
                            >
                              编辑
                            </Button>
                            {manage && (
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    disabled={opening}
                                    aria-label={`${user.display_name}的更多操作`}
                                  >
                                    <MoreHorizontal />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  <DropdownMenuItem
                                    onSelect={() => void open("role", user)}
                                  >
                                    <ShieldCheck />
                                    {user.role === "admin"
                                      ? "取消管理员身份"
                                      : "设为管理员"}
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    onSelect={() => void open("status", user)}
                                  >
                                    <Power />
                                    {user.status === "active"
                                      ? "禁用用户"
                                      : "启用用户"}
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    onSelect={() => void open("password", user)}
                                  >
                                    <KeyRound />
                                    重置密码
                                  </DropdownMenuItem>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem
                                    variant="destructive"
                                    onSelect={() => void open("delete", user)}
                                  >
                                    <Trash2 />
                                    删除用户
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
              {!data.users.length && (
                <p className="py-16 text-center text-muted-foreground">
                  没有找到匹配的用户，试试其他条件。
                </p>
              )}
              <Pagination
                page={data.page}
                size={data.size}
                {...(data.total === undefined
                  ? { pageItems: data.users.length, hasNext: data.hasNext }
                  : { total: data.total })}
                pending={pending}
                onChange={(page, size) => {
                  rememberPageSize("users", size);
                  filters({ page: String(page), page_size: String(size) });
                }}
              />
            </>
          )}
        </div>
      </div>
      {editor && (
        <UserEditor
          key={`${editor.mode}-${editor.user?.id || "new"}`}
          target={editor}
          onClose={closeEditor}
          onSaved={(message) => {
            invalidateIdentity();
            closeEditor();
            notify(message);
            void revalidator.revalidate();
          }}
        />
      )}
    </section>
  );
}
