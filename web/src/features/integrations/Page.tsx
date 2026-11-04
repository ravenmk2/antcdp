import { EnabledStatus } from "@/components/platform/status-text";
import { useState } from "react";
import {
  Link,
  useLoaderData,
  useSearchParams,
  useRevalidator,
  type LoaderFunctionArgs,
} from "react-router";
import { Boxes, Plus, ArrowRight, MoreHorizontal, Trash2 } from "lucide-react";
import { AccountFrame } from "@/features/account/AccountFrame";
import {
  type Capability,
  type Diagnostic,
  type ServiceConnection,
} from "@/shared/integrations";
import { serviceUI } from "@/shared/integration-providers";
import type { Resource } from "@/shared/collaboration";
import { adminLoader, identityLoader } from "@/lib/loaders";
import { request, errorMessage } from "@/lib/api";
import { useQuery } from "@/lib/use-query";
import { appHref } from "@/lib/navigation";
import { writeReviewMessage } from "@/lib/write-error";
import { useSubmission } from "@/components/platform/use-submission";
import { useNavigateAfterSave } from "@/components/platform/navigation-guard";
import { Pagination } from "@/components/platform/pagination";
import {
  AsyncState,
  EmptyState,
  ErrorBox,
  RefreshButton,
} from "@/components/platform/feedback";
import { CopyButton } from "@/components/platform/copy-button";
import { NativeSelect } from "@/components/platform/native-select";
import { FormDialog } from "@/components/platform/form-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ConnectionEditor } from "./ConnectionEditor";
import { Credentials } from "./Credentials";
import { Webhook } from "./Webhook";
import { DiagnosticResult } from "./Diagnostics";
export async function loader(args: LoaderFunctionArgs) {
  const path = new URL(args.request.url).pathname,
    admin = path.includes("/admin/"),
    pid = args.params.projectId,
    id = args.params.connectionId;
  const identity = await (admin ? adminLoader(args) : identityLoader(args));
  if ([pid, id].some((v) => v && !/^[1-9]\d*$/.test(v)))
    throw new Response("对象不存在", { status: 404 });
  const opts = { signal: args.request.signal };
  const project = pid
    ? (await request<Resource>("/projects/" + pid, opts)).data
    : undefined;
  if (
    project &&
    identity.session.user.role !== "admin" &&
    project.direct_role !== "admin"
  )
    throw new Response("仅项目管理员可以维护项目凭证", { status: 403 });
  const [types, directory] = await Promise.all([
    request<{ items: Capability[] }>("/service-types", opts),
    request<{ items: ServiceConnection[] }>("/service-connections", opts),
  ]);
  const items = directory.data.items,
    capabilities = types.data.items.filter((t) =>
      Object.hasOwn(serviceUI, t.service_type),
    );
  let selected = id ? items.find((c) => c.id === id) : undefined,
    tag = "";
  if (id && !selected) throw new Response("连接不存在", { status: 404 });
  if (admin && selected) {
    const r = await request<ServiceConnection>(
      "/admin/service-connections/" + selected.service_type + "/" + id,
      opts,
    );
    selected = r.data;
    tag = r.etag;
  }
  const list = admin
    ? "/admin/integrations"
    : pid
      ? "/projects/" + pid + "/integrations"
      : "/account/integrations";
  return { admin, pid, project, items, capabilities, selected, tag, list };
}
type Data = Awaited<ReturnType<typeof loader>>;
export function Component() {
  const data = useLoaderData<typeof loader>();
  const content = data.selected ? (
    <Detail
      key={data.list + data.selected.id}
      data={data}
      connection={data.selected}
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
    revalidator = useRevalidator(),
    afterSave = useNavigateAfterSave();
  const type = params.get("type") || "",
    q = params.get("q") || "",
    status = params.get("status") || "",
    size = [10, 20, 50, 100].includes(Number(params.get("page_size")))
      ? Number(params.get("page_size"))
      : 20;
  const items = data.items.filter(
    (c) =>
      (!type || type === c.service_type) &&
      (!status || c.enabled === (status === "enabled")) &&
      [c.name, c.code, c.description]
        .join(" ")
        .toLowerCase()
        .includes(q.trim().toLowerCase()),
  );
  const page = Math.min(
    Math.max(1, Math.floor(Number(params.get("page")) || 1)),
    Math.max(1, Math.ceil(items.length / size)),
  );
  const title = data.admin
    ? "服务集成"
    : data.pid
      ? "项目集成凭证"
      : "个人集成凭证";
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
    <section className="space-y-6">
      <h1 className="text-2xl font-semibold">{title}</h1>
      {!data.admin && (
        <p className="text-sm text-muted-foreground">
          选择一个服务连接，管理
          {data.pid ? `项目「${data.project?.name}」` : "你个人"}
          的访问凭证。连接地址由系统管理员维护。
        </p>
      )}
      <div className="min-w-0 overflow-hidden rounded-xl border bg-card">
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
              aria-label="搜索连接"
              defaultValue={q}
              placeholder="搜索名称、编码或说明"
            />
            <Button variant="outline">搜索</Button>
          </form>
          <NativeSelect
            className="w-auto"
            aria-label="服务类型筛选"
            value={type}
            onChange={(e) => filter({ type: e.target.value })}
          >
            <option value="">全部服务类型</option>
            {[
              ...new Set([
                ...data.capabilities.map((t) => t.service_type),
                ...data.items.map((c) => c.service_type),
              ]),
            ].map((k) => (
              <option key={k} value={k}>
                {data.capabilities.find((t) => t.service_type === k)?.name || k}{" "}
                · {data.items.filter((c) => c.service_type === k).length}
              </option>
            ))}
          </NativeSelect>
          <NativeSelect
            className="w-auto"
            aria-label="连接状态"
            value={status}
            onChange={(e) => filter({ status: e.target.value })}
          >
            <option value="">全部状态</option>
            <option value="enabled">已启用</option>
            <option value="disabled">已停用</option>
          </NativeSelect>
          <Button
            variant="ghost"
            disabled={!q && !type && !status}
            onClick={() => filter({ q: "", type: "", status: "" })}
          >
            清除筛选
          </Button>
          <RefreshButton
            loading={revalidator.state !== "idle"}
            onClick={() => void revalidator.revalidate()}
          />
          {data.admin && (
            <Button
              className="sm:ml-auto"
              disabled={!data.capabilities.length}
              onClick={() => setCreate(true)}
            >
              <Plus />
              创建连接
            </Button>
          )}{" "}
        </div>
        <ul className="divide-y">
          {items.slice((page - 1) * size, page * size).map((c) => (
            <li key={c.id}>
              <Link
                to={data.list + "/" + c.id + "?" + params}
                className="flex items-center gap-4 px-4 py-4 hover:bg-muted/40"
              >
                <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-muted">
                  {Object.hasOwn(serviceUI, c.service_type) ? (
                    <img
                      alt=""
                      className="size-6 object-contain dark:rounded-sm dark:bg-white/90 dark:p-0.5"
                      src={"/service-icons/" + c.service_type + ".svg"}
                    />
                  ) : (
                    <Boxes className="size-5" />
                  )}
                </span>
                <span className="min-w-0 flex-1 break-words">
                  <strong className="font-medium">{c.name}</strong>
                  <small className="mt-1 block text-muted-foreground">
                    {c.service_type} · {c.code}
                  </small>
                  {c.description && (
                    <span className="mt-1 block text-sm text-muted-foreground">
                      {c.description}
                    </span>
                  )}
                </span>
                <small className="shrink-0">
                  <EnabledStatus enabled={c.enabled} />
                </small>
              </Link>
            </li>
          ))}
        </ul>
        {!items.length && (
          <EmptyState
            title={
              q || type || status ? "没有匹配的服务连接" : "还没有服务连接"
            }
            description={
              q || type || status
                ? "调整搜索条件，或清除筛选查看全部连接。"
                : data.admin
                  ? "先连接 GitLab 等外部服务，再按实际需要配置访问凭证或 Webhook。"
                  : "请联系系统管理员创建服务连接，之后可在这里添加当前范围的凭证。"
            }
            action={
              q || type || status ? (
                <Button
                  variant="outline"
                  onClick={() => filter({ q: "", type: "", status: "" })}
                >
                  清除筛选
                </Button>
              ) : data.admin && data.capabilities.length ? (
                <Button onClick={() => setCreate(true)}>创建连接</Button>
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
        <ConnectionEditor
          capabilities={data.capabilities}
          onClose={() => setCreate(false)}
          onSaved={(c) => afterSave(appHref(data.list + "/" + c.id))}
        />
      )}
    </section>
  );
}
function Detail({
  data,
  connection: c,
}: {
  data: Data;
  connection: ServiceConnection;
}) {
  const [params, setParams] = useSearchParams(),
    r = useRevalidator(),
    [action, setAction] = useState<"edit" | "delete">(),
    afterSave = useNavigateAfterSave();
  const cap = data.capabilities.find((t) => t.service_type === c.service_type),
    provider = "/admin/service-connections/" + c.service_type + "/" + c.id,
    scope = data.admin ? "/admin" : data.pid ? "/projects/" + data.pid : "/me",
    base =
      scope +
      "/service-connections/" +
      c.service_type +
      "/" +
      c.id +
      "/credentials";
  const tabs = [
    ...(data.admin ? [["connection", "连接设置"]] : []),
    ...(cap?.credentials ? [["credentials", "访问凭证"]] : []),
    ...(data.admin && cap?.webhook.supported
      ? [["webhook", "Webhook 接收设置"]]
      : []),
  ];
  const tab =
    tabs.find(([key]) => key === params.get("tab"))?.[0] || tabs[0]?.[0];
  function selectTab(key: string) {
    setParams((previous) => {
      const next = new URLSearchParams(previous);
      next.set("tab", key);
      return next;
    });
  }
  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="min-w-0 break-words text-2xl font-semibold">{c.name}</h1>
        <span className="rounded-md bg-muted px-2 py-1 text-xs">
          {cap?.name || c.service_type}
        </span>
      </div>
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        {c.code}
        <CopyButton value={c.code} label="复制连接编码" />
        <EnabledStatus enabled={c.enabled} />
        <span>
          ·{" "}
          {data.admin
            ? "系统连接"
            : data.pid
              ? `项目：${data.project?.name}`
              : "个人凭证"}
        </span>
      </div>
      {c.description && (
        <p className="max-w-3xl break-words text-sm">{c.description}</p>
      )}
      {!c.enabled && (
        <p role="status" className="rounded-lg bg-muted p-3">
          连接已停用，验证和接收当前不可用。
        </p>
      )}
      {data.admin &&
        tab === "connection" &&
        c.enabled &&
        (cap?.credentials || cap?.webhook.supported) && (
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border bg-muted/30 px-5 py-4">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">连接配置已保存</p>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                {cap?.credentials
                  ? "访问远端资源时，在访问凭证中添加认证并验证。"
                  : cap?.connection_test
                    ? "可先测试连接，确认服务地址可达。"
                    : "根据实际用途选择需要的连接能力。"}
                {cap?.webhook.supported
                  ? "需要接收事件时，再配置 Webhook。"
                  : ""}
              </p>
            </div>
            <Button
              variant="outline"
              onClick={() =>
                selectTab(cap?.credentials ? "credentials" : "webhook")
              }
            >
              {cap?.credentials ? "管理访问凭证" : "配置 Webhook"}
              <ArrowRight />
            </Button>
          </div>
        )}
      <nav aria-label="连接功能" className="flex flex-wrap gap-1 border-b pb-2">
        {tabs.map(([key, label]) => (
          <Button
            size="sm"
            key={key}
            aria-pressed={tab === key}
            variant={tab === key ? "secondary" : "ghost"}
            onClick={() => selectTab(key!)}
          >
            {label}
          </Button>
        ))}
      </nav>
      {tab === "connection" && data.admin && (
        <ConnectionDetails
          c={c}
          tag={data.tag}
          path={provider}
          canTest={!!cap?.connection_test}
          onEdit={() => setAction("edit")}
          onDelete={() => setAction("delete")}
        />
      )}
      {tab === "credentials" && (
        <Credentials
          base={base}
          system={data.admin}
          connection={c}
          readonly={data.project?.status === "archived"}
        />
      )}
      {tab === "webhook" && cap && (
        <Webhook
          base={provider + "/webhook"}
          enabled={c.enabled}
          methods={cap.webhook.verification_methods}
        />
      )}
      {!data.admin && !cap?.credentials && (
        <EmptyState
          title="此连接暂不支持访问凭证"
          description="当前服务没有提供独立凭证能力，可返回列表选择其他连接。"
          action={
            <Button variant="outline" asChild>
              <Link to={data.list}>返回连接列表</Link>
            </Button>
          }
        />
      )}
      {action === "edit" && (
        <ConnectionEditor
          capabilities={data.capabilities}
          connection={c}
          etag={data.tag}
          onClose={() => setAction(undefined)}
          onSaved={() => {
            setAction(undefined);
            void r.revalidate();
          }}
        />
      )}
      {action === "delete" && (
        <DeleteConnection
          c={c}
          path={provider}
          etag={data.tag}
          onClose={() => setAction(undefined)}
          onSaved={() => afterSave(appHref(data.list))}
        />
      )}
    </section>
  );
}
function ConnectionDetails({
  c,
  tag,
  path,
  canTest,
  onEdit,
  onDelete,
}: {
  c: ServiceConnection;
  tag: string;
  path: string;
  canTest: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const query = useQuery<{ latest: Diagnostic | null }>(
      path + "/diagnostics",
      tag,
    ),
    [error, setError] = useState(""),
    test = useSubmission(),
    adapter = serviceUI[c.service_type];
  return (
    <div className="max-w-3xl space-y-4">
      <div className="space-y-5 rounded-xl border bg-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">连接配置</h2>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={!adapter || test.pending}
              onClick={onEdit}
            >
              编辑连接
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  size="icon"
                  variant="ghost"
                  disabled={test.pending}
                  aria-label="连接更多操作"
                >
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem variant="destructive" onSelect={onDelete}>
                  <Trash2 />
                  删除连接
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
        <dl className="grid gap-4 sm:grid-cols-2">
          {adapter?.connectionFields.map((f) => (
            <div key={f.key}>
              <dt className="text-xs text-muted-foreground">{f.label}</dt>
              <dd className="mt-1 break-all text-sm">
                {f.key === "custom_ca_pem"
                  ? c.config?.custom_ca_pem
                    ? "已配置"
                    : "使用系统信任"
                  : String(
                      c.config?.[f.key as keyof typeof c.config] ?? "未设置",
                    )}
              </dd>
            </div>
          ))}
        </dl>
      </div>
      {canTest && (
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            disabled={!c.enabled || test.pending || test.blocked}
            onClick={() => {
              setError("");
              void test.submit(
                async () => {
                  await request(path + "/test", {
                    method: "POST",
                    etag: tag,
                    body: {},
                  });
                  query.refresh();
                },
                (e) => setError(errorMessage(e)),
              );
            }}
          >
            {test.pending ? "正在检测…" : "测试连接"}
          </Button>
          <RefreshButton loading={query.loading} onClick={query.refresh} />
        </div>
      )}
      <ErrorBox>{error}</ErrorBox>
      <AsyncState
        loading={query.loading}
        error={query.error}
        onRetry={query.refresh}
      >
        <DiagnosticResult value={query.data?.latest || null} />
      </AsyncState>
    </div>
  );
}
function DeleteConnection({
  c,
  path,
  etag,
  onSaved,
  onClose,
}: {
  c: ServiceConnection;
  path: string;
  etag: string;
  onSaved: () => void;
  onClose: () => void;
}) {
  const [tag] = useState(etag),
    [error, setError] = useState(""),
    save = useSubmission();
  return (
    <FormDialog
      compact
      open
      title="删除服务连接"
      description={c.name}
      pending={save.pending}
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" disabled={save.pending} onClick={onClose}>
            取消
          </Button>
          <Button
            variant="destructive"
            disabled={save.pending || save.blocked}
            onClick={() => {
              void save.submit(
                async () => {
                  await request(path, { method: "DELETE", etag: tag });
                  onSaved();
                },
                (e) => setError(errorMessage(e)),
              );
            }}
          >
            确认删除
          </Button>
        </>
      }
    >
      <ErrorBox>{error}</ErrorBox>
      {save.blocked && <p role="alert">{writeReviewMessage}</p>}
      <p>
        请先移除关联仓库与凭证。删除后 Webhook 接收地址失效，远端 Hook
        需单独维护。
      </p>
    </FormDialog>
  );
}
