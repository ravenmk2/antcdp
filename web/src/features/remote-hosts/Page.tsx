import { useOperationToast } from "@/components/platform/operation-toast";
import { EnabledStatus } from "@/components/platform/status-text";
import { Power as ActionPower, Trash2 as ActionTrash2 } from "lucide-react";
import { useState } from "react";
import {
  Link,
  useLoaderData,
  useSearchParams,
  useRevalidator,
  type LoaderFunctionArgs,
} from "react-router";
import { Server, Plus, MoreHorizontal, ArrowRight } from "lucide-react";
import { AccountFrame } from "@/features/account/AccountFrame";
import type { RemoteHost, Diagnostic } from "@/shared/remote-hosts";
import type { Resource } from "@/shared/collaboration";
import { identityLoader, adminLoader } from "@/lib/loaders";
import { request, errorMessage } from "@/lib/api";
import { useQuery } from "@/lib/use-query";
import { appHref } from "@/lib/navigation";
import { writeReviewMessage } from "@/lib/write-error";
import {
  useNavigateAfterSave,
  useNavigationProtection,
} from "@/components/platform/navigation-guard";
import { useSubmission } from "@/components/platform/use-submission";
import { Pagination } from "@/components/platform/pagination";
import { NativeSelect } from "@/components/platform/native-select";
import {
  AsyncState,
  EmptyState,
  ErrorBox,
  RefreshButton,
} from "@/components/platform/feedback";
import { FormDialog } from "@/components/platform/form-dialog";
import { CopyButton } from "@/components/platform/copy-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { CreateHost, EditHost } from "./HostForm";
import { Credentials } from "./Credentials";
import { HostKeys } from "./HostKeys";
import { DiagnosticResult } from "./Diagnostics";
export async function loader(args: LoaderFunctionArgs) {
  const admin = new URL(args.request.url).pathname.includes("/admin/"),
    pid = args.params.projectId,
    id = args.params.hostId,
    identity = await (admin ? adminLoader(args) : identityLoader(args));
  if ([pid, id].some((v) => v && !/^[1-9]\d*$/.test(v)))
    throw new Response("对象不存在", { status: 404 });
  const opts = { signal: args.request.signal },
    project = pid
      ? (await request<Resource>("/projects/" + pid, opts)).data
      : undefined;
  if (
    project &&
    identity.session.user.role !== "admin" &&
    project.direct_role !== "admin"
  )
    throw new Response("仅项目管理员可维护项目 SSH 凭证", { status: 403 });
  const {
    data: { items },
  } = await request<{ items: RemoteHost[] }>("/remote-hosts", opts);
  let host = id ? items.find((h) => h.id === id) : undefined,
    tag = "";
  if (id && !host) throw new Response("主机不存在", { status: 404 });
  if (host && admin) {
    const full = await request<RemoteHost>(
      "/admin/remote-hosts/" + host.id,
      opts,
    );
    host = full.data;
    tag = full.etag;
  }
  const list = admin
    ? "/admin/remote-hosts"
    : pid
      ? "/projects/" + pid + "/remote-hosts"
      : "/account/remote-hosts";
  return { admin, pid, project, items, host, tag, list };
}
type Data = Awaited<ReturnType<typeof loader>>;
export function Component() {
  const data = useLoaderData<typeof loader>();
  const [params] = useSearchParams();
  const content = data.host ? (
    <Detail
      key={data.list + data.host.id + (params.get("tab") || "settings")}
      data={data}
      host={data.host}
    />
  ) : (
    <Directory key={data.list} data={data} />
  );
  return !data.admin && !data.pid ? (
    <AccountFrame>{content}</AccountFrame>
  ) : (
    content
  );
}
function Directory({ data }: { data: Data }) {
  const [params, setParams] = useSearchParams(),
    [create, setCreate] = useState(false),
    after = useNavigateAfterSave(),
    r = useRevalidator();
  const status = params.get("status") || "",
    q = params.get("q") || "",
    size = [10, 20, 50, 100].includes(Number(params.get("page_size")))
      ? Number(params.get("page_size"))
      : 20;
  const items = data.items.filter(
    (h) =>
      (!status || h.enabled === (status === "enabled")) &&
      [h.name, h.code, h.description, h.config?.host]
        .join(" ")
        .toLowerCase()
        .includes(q.trim().toLowerCase()),
  );
  const page = Math.max(
    1,
    Math.min(
      Math.floor(Number(params.get("page")) || 1),
      Math.ceil(items.length / size),
    ),
  );
  function filter(values: Record<string, string>) {
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete("page");
      for (const [k, v] of Object.entries(values)) {
        if (v) next.set(k, v);
        else next.delete(k);
      }
      return next;
    });
  }
  return (
    <section className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">
          {data.admin
            ? "远程主机"
            : data.pid
              ? "项目 SSH 凭证"
              : "个人 SSH 凭证"}
        </h1>
      </div>
      {!data.admin && (
        <p className="text-sm text-muted-foreground">
          选择主机，管理{data.pid ? `项目「${data.project?.name}」` : "你个人"}
          的 SSH 凭证。主机地址与公钥信任由系统管理员维护。
        </p>
      )}
      <div className="overflow-hidden rounded-xl border bg-card">
        <div className="list-toolbar">
          <form
            className="flex min-w-40 flex-1 gap-2 sm:max-w-md"
            onSubmit={(e) => {
              e.preventDefault();
              filter({
                q: String(new FormData(e.currentTarget).get("q") || ""),
              });
            }}
          >
            <Input
              key={q}
              name="q"
              aria-label="搜索主机"
              placeholder="搜索主机名称或编码"
              defaultValue={q}
            />
            <Button variant="outline">搜索</Button>
          </form>
          <NativeSelect
            aria-label="主机状态"
            className="w-auto"
            value={status}
            onChange={(e) => filter({ status: e.target.value })}
          >
            <option value="">全部状态</option>
            <option value="enabled">已启用</option>
            <option value="disabled">已停用</option>
          </NativeSelect>
          <Button
            variant="ghost"
            disabled={!q && !status}
            onClick={() => filter({ q: "", status: "" })}
          >
            清除筛选
          </Button>
          <RefreshButton
            loading={r.state !== "idle"}
            onClick={() => void r.revalidate()}
          />
          {data.admin && (
            <Button className="sm:ml-auto" onClick={() => setCreate(true)}>
              <Plus />
              创建主机
            </Button>
          )}{" "}
        </div>
        <Table aria-label="远程主机">
          <TableHeader>
            <TableRow>
              <TableHead>主机</TableHead>
              <TableHead>说明</TableHead>
              <TableHead>状态</TableHead>
              <TableHead>操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.slice((page - 1) * size, page * size).map((h) => (
              <TableRow key={h.id}>
                <TableCell>
                  <div className="flex items-center gap-3">
                    <Server className="size-5 shrink-0 text-muted-foreground" />
                    <div>
                      <Link
                        className="font-medium hover:underline"
                        to={data.list + "/" + h.id + "?" + params}
                      >
                        {h.name}
                      </Link>
                      <small className="mt-1 block text-muted-foreground">
                        {h.code}
                      </small>
                    </div>
                  </div>
                </TableCell>
                <TableCell className="max-w-sm whitespace-normal">
                  {h.description || "—"}
                </TableCell>
                <TableCell>
                  <EnabledStatus enabled={h.enabled} />
                </TableCell>
                <TableCell>
                  <Link
                    to={data.list + "/" + h.id + "?" + params}
                    className="hover:underline"
                  >
                    查看
                  </Link>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {!items.length && (
          <EmptyState
            title={q || status ? "没有匹配的主机" : "还没有远程主机"}
            description={
              q || status
                ? "调整搜索条件，或清除筛选查看全部主机。"
                : data.admin
                  ? "添加 SSH 主机地址，核对主机身份后按需配置访问凭证。"
                  : "请联系系统管理员添加主机，之后可在这里管理当前范围的 SSH 凭证。"
            }
            action={
              q || status ? (
                <Button
                  variant="outline"
                  onClick={() => filter({ q: "", status: "" })}
                >
                  清除筛选
                </Button>
              ) : data.admin ? (
                <Button onClick={() => setCreate(true)}>创建主机</Button>
              ) : undefined
            }
          />
        )}
        <Pagination
          page={page}
          size={size}
          total={items.length}
          onChange={(p, s) => filter({ page: String(p), page_size: String(s) })}
        />
      </div>
      {create && (
        <CreateHost
          onClose={() => setCreate(false)}
          onSaved={(h) => after(appHref(data.list + "/" + h.id))}
        />
      )}
    </section>
  );
}
function Detail({ data, host: h }: { data: Data; host: RemoteHost }) {
  const r = useRevalidator(),
    after = useNavigateAfterSave();
  const [params, setParams] = useSearchParams();
  const requestedTab = params.get("tab");
  const tab =
    data.admin &&
    ["settings", "keys", "credentials"].includes(requestedTab || "")
      ? requestedTab
      : data.admin
        ? "settings"
        : "credentials";
  function setTab(value: string) {
    setParams((previous) => {
      const next = new URLSearchParams(previous);
      next.set("tab", value);
      return next;
    });
  }
  const [edit, setEdit] = useState(false),
    [op, setOp] = useState<"toggle" | "delete">();
  const path = "/admin/remote-hosts/" + h.id,
    scope = data.admin ? "/admin" : data.pid ? "/projects/" + data.pid : "/me",
    credentialPath = scope + "/remote-hosts/" + h.id + "/credentials";
  function refreshed() {
    setEdit(false);
    setOp(undefined);
    void r.revalidate();
  }
  const notify = useOperationToast();
  return (
    <section className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="break-words text-2xl font-semibold">{h.name}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <span>
              <EnabledStatus enabled={h.enabled} /> · SSH
            </span>
            <code className="break-all">{h.code}</code>
            <CopyButton value={h.code} label="复制主机编码" />
            <span>
              ·{" "}
              {data.admin
                ? "系统主机"
                : data.pid
                  ? `项目：${data.project?.name}`
                  : "个人凭证"}
            </span>
          </div>
        </div>
        {data.admin && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                disabled={edit}
                aria-label="主机更多操作"
              >
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => setOp("toggle")}>
                <ActionPower />
                {h.enabled ? "停用主机" : "启用主机"}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                onSelect={() => setOp("delete")}
              >
                <ActionTrash2 />
                删除主机
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {data.admin && tab === "settings" && !edit && (
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border bg-muted/30 px-5 py-4">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">
              {!h.enabled
                ? "主机已停用"
                : h.config?.host_keys?.length
                  ? "主机地址与信任公钥已保存"
                  : "下一步：核对主机身份"}
            </p>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              {!h.enabled
                ? "启用主机后可测试连接和验证凭证；已保存的配置仍然保留。"
                : h.config?.host_keys?.length
                  ? "可测试 SSH 连接，再按需添加凭证并验证登录身份。已保存公钥不代表当前连接验证通过。"
                  : "先从可信来源核对 SSH 公钥，加入信任后再验证登录凭证。"}
            </p>
          </div>
          {h.enabled && (
            <Button
              variant="outline"
              onClick={() =>
                setTab(h.config?.host_keys?.length ? "credentials" : "keys")
              }
            >
              {h.config?.host_keys?.length ? "管理 SSH 凭证" : "核对主机公钥"}
              <ArrowRight />
            </Button>
          )}
        </div>
      )}

      {data.admin && (
        <nav
          className="flex flex-wrap gap-1 border-b pb-2"
          aria-label="主机功能"
        >
          {[
            ["settings", "主机配置"],
            ["credentials", "系统凭证"],
            ["keys", "主机公钥"],
          ].map(([key, label]) => (
            <Button
              key={key}
              size="sm"
              variant={tab === key ? "secondary" : "ghost"}
              aria-pressed={tab === key}
              onClick={() => setTab(key!)}
            >
              {label}
            </Button>
          ))}
        </nav>
      )}
      {data.admin && (
        <div hidden={tab !== "settings"}>
          {edit ? (
            <EditHost
              host={h}
              tag={data.tag}
              onClose={() => setEdit(false)}
              onSaved={() => {
                notify("主机资料已保存。");
                refreshed();
              }}
            />
          ) : (
            <Settings
              host={h}
              tag={data.tag}
              path={path}
              onEdit={() => setEdit(true)}
            />
          )}
        </div>
      )}
      {tab === "keys" && data.admin && (
        <HostKeys
          host={h}
          etag={data.tag}
          path={path}
          onSaved={() => {
            notify("主机信任列表已更新。");
            void r.revalidate();
          }}
        />
      )}
      {tab === "credentials" && (
        <Credentials
          connection={h}
          base={credentialPath}
          system={data.admin}
          readonly={data.project?.status === "archived"}
        />
      )}
      {op && (
        <Command
          host={h}
          tag={data.tag}
          path={path}
          action={op}
          onClose={() => setOp(undefined)}
          onSaved={() => {
            if (op === "delete") after(appHref(data.list));
            else {
              notify("主机状态已更新。");
              refreshed();
            }
          }}
        />
      )}
    </section>
  );
}
function Settings({
  host: h,
  tag,
  path,
  onEdit,
}: {
  host: RemoteHost;
  tag: string;
  path: string;
  onEdit: () => void;
}) {
  const diagnosis = useQuery<{ latest: Diagnostic | null }>(
      path + "/diagnostics",
      tag,
    ),
    test = useSubmission(),
    [error, setError] = useState("");
  useNavigationProtection(test.pending ? "pending" : undefined);
  return (
    <div className="max-w-3xl space-y-4">
      <section className="space-y-5 rounded-xl border bg-card p-5">
        <header className="flex items-center justify-between gap-3">
          <h2 className="font-semibold">主机配置</h2>
          <Button
            variant="outline"
            size="sm"
            disabled={test.pending}
            onClick={onEdit}
          >
            编辑配置
          </Button>
        </header>
        <dl className="grid gap-4 text-sm sm:grid-cols-2">
          {[
            ["主机名 / IP", h.config?.host],
            ["SSH 端口", h.config?.port],
            ["已信任公钥", (h.config?.host_keys?.length || 0) + " 把"],
            ["说明", h.description || "—"],
          ].map(([label, v]) => (
            <div key={label}>
              <dt className="text-xs text-muted-foreground">{label}</dt>
              <dd className="mt-1 break-all">{v}</dd>
            </div>
          ))}
        </dl>
      </section>
      <div className="flex items-center gap-3">
        <Button
          variant="outline"
          disabled={test.pending || test.blocked || !h.enabled}
          onClick={() => {
            setError("");
            void test.submit(
              async () => {
                await request(path + "/test", {
                  method: "POST",
                  etag: tag,
                  body: {},
                });
                diagnosis.refresh();
              },
              (e) => setError(errorMessage(e)),
            );
          }}
        >
          {test.pending ? "正在检测…" : "测试 SSH 连接"}
        </Button>
        <RefreshButton
          loading={diagnosis.loading}
          onClick={diagnosis.refresh}
        />
      </div>
      <ErrorBox>{error}</ErrorBox>
      <AsyncState
        loading={diagnosis.loading}
        error={diagnosis.error}
        onRetry={diagnosis.refresh}
      >
        <DiagnosticResult value={diagnosis.data?.latest || null} />
      </AsyncState>
    </div>
  );
}
function Command({
  host,
  tag,
  path,
  action,
  onClose,
  onSaved,
}: {
  host: RemoteHost;
  tag: string;
  path: string;
  action: "toggle" | "delete";
  onClose: () => void;
  onSaved: () => void;
}) {
  const [snapshot] = useState({ etag: tag, enabled: host.enabled }),
    [error, setError] = useState(""),
    save = useSubmission(),
    remove = action === "delete";
  return (
    <FormDialog
      compact
      open
      title={remove ? "删除主机" : snapshot.enabled ? "停用主机" : "启用主机"}
      description={host.name}
      pending={save.pending}
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" disabled={save.pending} onClick={onClose}>
            取消
          </Button>
          <Button
            variant={remove ? "destructive" : "default"}
            disabled={save.pending || save.blocked}
            onClick={() =>
              void save.submit(
                async () => {
                  await request(path, {
                    method: remove ? "DELETE" : "PATCH",
                    etag: snapshot.etag,
                    body: remove ? undefined : { enabled: !snapshot.enabled },
                  });
                  onSaved();
                },
                (e) => setError(errorMessage(e)),
              )
            }
          >
            确认
          </Button>
        </>
      }
    >
      <ErrorBox>{error}</ErrorBox>
      {save.blocked && <p role="alert">{writeReviewMessage}</p>}
      <p>
        {remove
          ? "删除前须移除全部 SSH 凭证。已保存的主机信任将一并移除。"
          : snapshot.enabled
            ? "停用后暂停 SSH 验证，凭证和公钥仍然保留。"
            : "启用后可以进行 SSH 探测与凭证验证。"}
      </p>
    </FormDialog>
  );
}
