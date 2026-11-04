import { StatusText } from "@/components/platform/status-text";
import { useState } from "react";
import {
  Link,
  useLoaderData,
  useNavigation,
  useSearchParams,
  type LoaderFunctionArgs,
} from "react-router";
import { type Kind, type Page, statusLabel } from "@/shared/collaboration";
import { identityLoader, adminLoader } from "@/lib/loaders";
import { request } from "@/lib/api";
import { appHref } from "@/lib/navigation";
import { useNavigateAfterSave } from "@/components/platform/navigation-guard";
import { Pagination } from "@/components/platform/pagination";
import { NativeSelect } from "@/components/platform/native-select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableHeader,
  TableHead,
  TableBody,
  TableCell,
  TableRow,
} from "@/components/ui/table";
import { ResourceIcon } from "./ResourceIcon";
import { ResourceEditor } from "./ResourceEditor";
import { PinButton } from "./Shortcuts";
import { EmptyState } from "@/components/platform/feedback";
export async function loader(args: LoaderFunctionArgs) {
  const url = new URL(args.request.url),
    kind: Kind = /\/teams\/?$/.test(url.pathname) ? "teams" : "projects",
    admin = url.pathname.includes("/admin/");
  await (admin ? adminLoader(args) : identityLoader(args));
  const end = kind === "projects" ? "archived" : "dissolved",
    q = url.searchParams.get("q") || "",
    status = ["active", end, "all"].includes(
      url.searchParams.get("status") || "",
    )
      ? url.searchParams.get("status")!
      : "active";
  const page = Math.max(
      1,
      Math.floor(Number(url.searchParams.get("page")) || 1),
    ),
    size = [10, 20, 50, 100].includes(Number(url.searchParams.get("page_size")))
      ? Number(url.searchParams.get("page_size"))
      : 20,
    unmanaged = admin && url.searchParams.get("unmanaged") === "true";
  const common = `scope=${admin ? "all" : "mine"}&q=${encodeURIComponent(q)}&unmanaged=${unmanaged}`;
  const [result, active, ended] = await Promise.all([
    request<Page>(
      `/${kind}?${common}&status=${status}&page=${page}&page_size=${size}`,
      { signal: args.request.signal },
    ),
    request<Page>(`/${kind}?${common}&status=active&page=1&page_size=1`, {
      signal: args.request.signal,
    }),
    request<Page>(`/${kind}?${common}&status=${end}&page=1&page_size=1`, {
      signal: args.request.signal,
    }),
  ]);
  return {
    kind,
    admin,
    end,
    q,
    status,
    page,
    size,
    unmanaged,
    data: result.data,
    counts: {
      active: active.data.total,
      [end]: ended.data.total,
      all: active.data.total + ended.data.total,
    },
  };
}
export function Component() {
  const data = useLoaderData<typeof loader>();
  return <ListContent key={data.kind + data.admin} data={data} />;
}
function ListContent({ data }: { data: Awaited<ReturnType<typeof loader>> }) {
  const [, setParams] = useSearchParams(),
    navigation = useNavigation(),
    afterSave = useNavigateAfterSave();
  const [editor, setEditor] = useState(false),
    label = data.kind === "projects" ? "项目" : "团队",
    base = `${data.admin ? "/admin" : ""}/${data.kind}`;
  const pending = navigation.state !== "idle";
  function filter(values: Record<string, string>) {
    setParams((previous) => {
      const next = new URLSearchParams(previous);
      next.delete("page");
      for (const [k, v] of Object.entries(values)) {
        if (v) next.set(k, v);
        else next.delete(k);
      }
      return next;
    });
  }
  return (
    <section className="space-y-6">
      <h1 className="text-2xl font-semibold">
        {data.admin ? `${label}管理` : `我的${label}`}
      </h1>
      <div
        className={
          data.kind === "projects" && !data.admin
            ? "space-y-4"
            : "overflow-hidden rounded-xl border bg-card"
        }
      >
        <div
          className={
            data.kind === "projects" && !data.admin
              ? "flex flex-wrap items-center gap-3"
              : "list-toolbar"
          }
        >
          <form
            className="flex max-w-lg flex-1 gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              filter({
                q: String(new FormData(e.currentTarget).get("q") || ""),
              });
            }}
          >
            <Input
              key={data.q}
              name="q"
              defaultValue={data.q}
              aria-label={`搜索${label}`}
              placeholder={`搜索${label}名称、编码或摘要`}
            />
            <Button variant="outline">搜索</Button>
          </form>
          <NativeSelect
            className="w-auto"
            aria-label={`${label}状态`}
            value={data.status}
            onChange={(e) => filter({ status: e.target.value })}
          >
            <option value="active">正常 · {data.counts.active}</option>
            <option value={data.end}>
              {statusLabel(data.end)} · {data.counts[data.end]}
            </option>
            <option value="all">全部 · {data.counts.all}</option>
          </NativeSelect>
          {data.admin && (
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={data.unmanaged}
                onCheckedChange={(checked) =>
                  filter({ unmanaged: checked ? "true" : "" })
                }
              />
              没有可用管理员
            </label>
          )}
          {data.admin && (
            <Button className="sm:ml-auto" onClick={() => setEditor(true)}>
              创建{label}
            </Button>
          )}{" "}
        </div>
        {data.kind === "projects" && !data.admin ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {data.data.items.map((r) => (
              <article
                key={r.id}
                className="group rounded-xl border bg-card p-5 transition-colors hover:border-input"
              >
                <div className="flex items-start justify-between gap-3">
                  <ResourceIcon
                    iconKey={r.icon_key}
                    fileId={r.icon_file_id}
                    large
                  />
                  <PinButton kind={data.kind} resource={r} />
                </div>
                <h2 className="mt-4 text-lg font-medium">
                  <Link className="hover:underline" to={`${base}/${r.id}`}>
                    {r.name}
                  </Link>
                </h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  {r.code} ·{" "}
                  {r.status === "active" ? (
                    statusLabel(r.status)
                  ) : (
                    <StatusText tone="neutral">
                      {statusLabel(r.status)}
                    </StatusText>
                  )}
                </p>
                <p className="mt-3 line-clamp-3 min-h-10 text-sm text-muted-foreground">
                  {r.summary || "尚未填写摘要。"}
                </p>
                <div className="mt-6 flex justify-between text-xs text-muted-foreground">
                  <span>{r.member_count} 位成员</span>
                  <span>{r.direct_role === "admin" ? "管理员" : "成员"}</span>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div>
            <Table aria-label={`${label}列表`}>
              <TableHeader>
                <TableRow>
                  <TableHead>{label}</TableHead>
                  <TableHead>成员</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead>我的身份</TableHead>
                  <TableHead>操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.data.items.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <ResourceIcon
                          iconKey={r.icon_key}
                          fileId={r.icon_file_id}
                          team={data.kind === "teams"}
                        />
                        <div>
                          <Link
                            to={`${base}/${r.id}`}
                            className="font-medium hover:underline"
                          >
                            {r.name}
                          </Link>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {r.code}
                          </p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>{r.member_count}</TableCell>
                    <TableCell>
                      {r.status === "active" ? (
                        statusLabel(r.status)
                      ) : (
                        <StatusText tone="neutral">
                          {statusLabel(r.status)}
                        </StatusText>
                      )}
                    </TableCell>
                    <TableCell>
                      {r.direct_role === "admin"
                        ? "管理员"
                        : r.is_member
                          ? "成员"
                          : "未加入"}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Link
                          to={`${base}/${r.id}`}
                          className="text-sm hover:underline"
                        >
                          查看
                        </Link>
                        <PinButton kind={data.kind} resource={r} />
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        {!data.data.items.length && (
          <EmptyState
            title={
              data.q || data.unmanaged || data.status !== "active"
                ? `没有符合条件的${label}`
                : data.admin
                  ? `还没有${label}`
                  : `尚未加入${label}`
            }
            description={
              data.q || data.unmanaged || data.status !== "active"
                ? "调整搜索或筛选条件后再试。"
                : data.admin
                  ? `创建${label}后，再添加成员并配置协作内容。`
                  : `加入后，相关${label}会显示在这里。请联系管理员添加成员或授予团队访问权限。`
            }
            action={
              data.q || data.unmanaged || data.status !== "active" ? (
                <Button
                  variant="outline"
                  onClick={() =>
                    filter({ q: "", unmanaged: "", status: "active" })
                  }
                >
                  清除筛选
                </Button>
              ) : data.admin ? (
                <Button onClick={() => setEditor(true)}>创建{label}</Button>
              ) : undefined
            }
          />
        )}
        <Pagination
          page={data.page}
          size={data.size}
          total={data.data.total}
          pending={pending}
          onChange={(page, size) =>
            filter({ page: String(page), page_size: String(size) })
          }
        />
      </div>
      {editor && (
        <ResourceEditor
          kind={data.kind}
          onClose={() => setEditor(false)}
          onSaved={(r) => afterSave(appHref(`${base}/${r.id}`))}
        />
      )}
    </section>
  );
}
