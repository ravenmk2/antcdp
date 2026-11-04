import { ReleasePanel } from "./ReleasePanel";
import { EmptyState, ErrorBox } from "@/components/platform/feedback";
import { reason } from "@/shared/delivery";
import "./variant-workspace.css";
import { loadReleases } from "./releases";
import { useOperationToast } from "@/components/platform/operation-toast";
import { StatusText } from "@/components/platform/status-text";
import { Archive as ActionArchive, Trash2 as ActionTrash2 } from "lucide-react";
import { MoreHorizontal, ChevronDown } from "lucide-react";
import { NativeSelect } from "@/components/platform/native-select";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { RepositoryBranches } from "./RepositoryBranches";
import {
  History,
  SwitchVariant,
  LifecycleDialog,
  type Lifecycle,
} from "./VariantTools";
import { useNavigateAfterSave } from "@/components/platform/navigation-guard";
import { appHref } from "@/lib/navigation";
import { useState } from "react";
import {
  Link,
  useLoaderData,
  useRevalidator,
  useSearchParams,
  type LoaderFunctionArgs,
} from "react-router";
import type {
  Variant,
  Environment,
  BranchModel,
  Page,
} from "@/shared/delivery";
import { identityLoader, adminLoader } from "@/lib/loaders";
import { request } from "@/lib/api";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Pagination } from "@/components/platform/pagination";
import {
  ConfigurationDrawer,
  type ConfigurationTarget,
} from "./ConfigurationDrawer";
import type { Resource as ProjectSummary } from "@/shared/collaboration";

export async function loader(args: LoaderFunctionArgs) {
  const url = new URL(args.request.url),
    admin = url.pathname.includes("/admin/projects"),
    id = args.params.projectId;
  const identity = await (admin ? adminLoader(args) : identityLoader(args));
  const systemAdmin = identity.session.user.role === "admin";
  if (!id || !/^\d+$/.test(id))
    throw new Response("项目不存在", { status: 404 });
  const project = (
    await request<ProjectSummary>(`/projects/${id}`, {
      signal: args.request.signal,
    })
  ).data;
  if (!admin && !project.is_member)
    throw new Response("项目不存在", { status: 404 });
  const selected = url.searchParams.get("variant") || "";
  if (selected && !/^\d+$/.test(selected))
    throw new Response("变体不存在", { status: 404 });
  const page = Math.max(
    1,
    Math.floor(Number(url.searchParams.get(selected ? "epage" : "page")) || 1),
  );
  const size = [10, 20, 50, 100].includes(
    Number(url.searchParams.get(selected ? "esize" : "page_size")),
  )
    ? Number(url.searchParams.get(selected ? "esize" : "page_size"))
    : 20;
  const status = ["active", "archived", "all"].includes(
    url.searchParams.get("status") || "",
  )
    ? url.searchParams.get("status")!
    : "active";
  const q = url.searchParams.get("q") || "";
  const base = `/projects/${id}/variants`;
  const model = (
    await request<BranchModel>(`/projects/${id}/branch-model`, {
      signal: args.request.signal,
    })
  ).data;
  if (selected) {
    const [collection, detail, environments] = await Promise.all([
      request<Page<Variant>>(base, {
        signal: args.request.signal,
      }),
      request<Variant>(`${base}/${selected}`, { signal: args.request.signal }),
      request<Page<Environment>>(
        `${base}/${selected}/environments?page=${page}&page_size=${size}`,
        { signal: args.request.signal },
      ),
    ]);
    return {
      project,
      model,
      variant: detail.data,
      releases:
        url.searchParams.get("vview") === "releases"
          ? await loadReleases(base + "/" + selected, url, args.request.signal)
          : null,
      variantCollection: collection.data.mutation_version,
      environments: environments.data,
      variants: null,
      page,
      size,
      status,
      q,
      admin,
      systemAdmin,
    };
  }
  const variants = (
    await request<Page<Variant>>(
      `${base}?q=${encodeURIComponent(q)}&archived=${status}&page=${page}&page_size=${size}`,
      { signal: args.request.signal },
    )
  ).data;
  return {
    project,
    model,
    variant: null,
    releases: null,
    variantCollection: variants.mutation_version,
    environments: null,
    variants,
    page,
    size,
    status,
    q,
    admin,
    systemAdmin,
  };
}
export function Component() {
  const data = useLoaderData<typeof loader>();
  return (
    <Screen
      key={
        data.project.id + "-" + (data.variant?.id || "list") + "-" + data.admin
      }
      data={data}
    />
  );
}
function Screen({ data }: { data: Awaited<ReturnType<typeof loader>> }) {
  const [params, setParams] = useSearchParams(),
    revalidator = useRevalidator(),
    [editor, setEditor] = useState<ConfigurationTarget>(),
    [command, setCommand] = useState<Lifecycle>(),
    [switching, setSwitch] = useState(false),
    notify = useOperationToast();
  const afterSave = useNavigateAfterSave();
  const root =
      (data.admin ? "/admin/projects/" : "/projects/") + data.project.id,
    v = data.variant,
    canManage = data.project.can_manage && data.project.status === "active",
    writable = canManage && (!v || (v.can_manage && !v.archived_at));
  const view = params.get("vview") || "repositories";
  function href(values: Record<string, string>) {
    const next = new URLSearchParams(params);
    for (const [k, value] of Object.entries(values)) {
      if (value) next.set(k, value);
      else next.delete(k);
    }
    return next;
  }
  function query(values: Record<string, string>) {
    setParams(href(values));
  }
  function openVariant(item: Variant) {
    setEditor({
      kind: "variant",
      value: item,
      collectionTag: data.variantCollection,
    });
  }
  function commands(item: Variant) {
    if (item.kind === "standard") return null;
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size="icon"
            variant="ghost"
            aria-label={item.name + " 更多操作"}
          >
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            onSelect={() =>
              setCommand({
                action: item.archived_at ? "restore" : "archive",
                item,
              })
            }
          >
            <ActionArchive />
            {item.archived_at ? "恢复变体" : "归档变体"}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            onSelect={() =>
              setCommand({
                action: "delete",
                item,
                collection: data.variantCollection,
              })
            }
          >
            <ActionTrash2 />
            删除变体
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }
  function changed() {
    void revalidator.revalidate();
  }
  const bindingNotice = v && v.binding_validity !== "valid" && (
    <ErrorBox tone="warning">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <strong className="font-medium">主干绑定需要核对</strong>
          <p className="mt-1">
            {reason(v.binding_reason)}。核对配置后才能校验或创建主干分支。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => openVariant(v)}>
            检查变体设置
          </Button>
          <Button size="sm" variant="ghost" asChild>
            <Link to={`${root}?tab=branch-model`}>查看分支规则</Link>
          </Button>
        </div>
      </div>
    </ErrorBox>
  );
  const configurationEditor = editor && (
    <ConfigurationDrawer
      key={editor.kind + "-" + (editor.value?.id || "new")}
      projectId={data.project.id}
      variant={v || undefined}
      target={editor}
      model={data.model}
      canManage={writable}
      onClose={() => setEditor(undefined)}
      onSaved={() => {
        notify("配置已保存，远端分支未改变。");
        changed();
      }}
    />
  );
  const readOnlyReason =
    data.project.status !== "active"
      ? "所属项目已归档，本次发布只读。恢复项目后才能继续准备和推进发布。"
      : v?.archived_at
        ? "所属变体已归档，本次发布只读。恢复变体后才能继续准备和推进发布。"
        : undefined;
  const archiveNotice = v?.archived_at && (
    <div
      className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-muted p-4"
      role="status"
    >
      <p className="text-[13px]">
        此变体已归档，配置、环境和发布只读，已有材料与记录仍可查阅。
        {data.project.status !== "active" && "所属项目也已归档，需先恢复项目。"}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={() => openVariant(v)}>
          查看变体设置
        </Button>
        {canManage && v.can_manage && v.kind !== "standard" && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => setCommand({ action: "restore", item: v })}
          >
            恢复变体
          </Button>
        )}
      </div>
    </div>
  );
  const lifecycleDialog = command && (
    <LifecycleDialog
      project={data.project.id}
      variant={v || undefined}
      target={command}
      onClose={() => setCommand(undefined)}
      onSaved={() => {
        const leaving =
          command.action === "delete" &&
          !command.environment &&
          v?.id === command.item.id;
        setCommand(undefined);
        notify("配置状态已更新，远端分支保留。");
        if (leaving) {
          const list = href({
            variant: "",
            vview: "",
            epage: "",
            esize: "",
          }).toString();
          afterSave(appHref(root + "/variants" + (list ? "?" + list : "")));
        } else changed();
      }}
    />
  );
  if (v && view === "releases" && data.releases) {
    return (
      <section className="variant-page space-y-5">
        {archiveNotice}
        {!data.releases.release && (
          <VariantNavigation
            view={view}
            href={(key) =>
              "?" + href({ vview: key === "repositories" ? "" : key })
            }
          />
        )}
        {bindingNotice}
        <ReleasePanel
          key={data.releases.release?.id || "list"}
          base={`/projects/${data.project.id}/variants/${v.id}`}
          variant={v}
          data={data.releases}
          manage={writable}
          systemAdmin={data.systemAdmin}
          readOnlyReason={readOnlyReason}
        />
        {configurationEditor}
        {lifecycleDialog}
      </section>
    );
  }
  return (
    <section className="variant-page space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="break-words text-2xl font-semibold">
            {v ? (
              <button
                className="variant-switch"
                onClick={() => setSwitch(true)}
                aria-label={`切换变体，当前 ${v.name}`}
              >
                <span className="min-w-0 break-words">{v.name}</span>
                <ChevronDown aria-hidden="true" />
              </button>
            ) : (
              "产品变体"
            )}
          </h1>
          {v && (
            <p className="mt-2 break-all text-[13px] text-muted-foreground">
              {v.code} · 主干 {v.main_branch} · {v.repository_count} 个仓库
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {v ? (
            <>
              <Button variant="outline" onClick={() => openVariant(v)}>
                变体设置
              </Button>
              {canManage && v.can_manage && commands(v)}
            </>
          ) : null}
        </div>
      </header>

      {archiveNotice}
      {bindingNotice}
      {v ? (
        <>
          <VariantNavigation
            view={view}
            href={(key) =>
              "?" + href({ vview: key === "repositories" ? "" : key })
            }
          />
          {view === "history" ? (
            <section className="space-y-4">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-lg font-semibold">主干创建记录</h2>
                <Button variant="ghost" asChild>
                  <Link to={"?" + href({ vview: "repositories" })}>
                    返回仓库与分支
                  </Link>
                </Button>
              </div>
              <History projectId={data.project.id} variant={v} />
            </section>
          ) : view === "repositories" || view === "create" ? (
            <RepositoryBranches
              key={view}
              projectId={data.project.id}
              variant={v}
              creationMode={view === "create"}
              allowed={writable}
              historyAction={
                <Button variant="ghost" size="sm" asChild>
                  <Link to={"?" + href({ vview: "history" })}>创建记录</Link>
                </Button>
              }
              onConfigureScope={() => openVariant(v)}
              projectRepositoryHref={`${root}?tab=repositories`}
            />
          ) : (
            <>
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-lg font-semibold">环境</h2>
                {writable && !!data.environments?.items.length && (
                  <Button
                    onClick={() =>
                      setEditor({
                        kind: "environment",
                        collectionTag: data.environments!.mutation_version,
                      })
                    }
                  >
                    新建环境
                  </Button>
                )}
              </div>
              <div className="overflow-hidden rounded-xl border bg-card">
                <Table aria-label="环境列表">
                  <TableHeader>
                    <TableRow>
                      {["环境", "固定分支", "仓库范围", "配置状态", "操作"].map(
                        (t) => (
                          <TableHead key={t}>{t}</TableHead>
                        ),
                      )}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.environments?.items.map((e) => (
                      <TableRow key={e.id}>
                        <TableCell>
                          <button
                            className="font-medium text-left hover:underline"
                            aria-label={`查看环境 ${e.name}`}
                            onClick={() =>
                              setEditor({
                                kind: "environment",
                                value: e,
                                collectionTag:
                                  data.environments!.mutation_version,
                              })
                            }
                          >
                            {e.name}
                          </button>
                          <small className="block text-muted-foreground">
                            {e.code}
                          </small>
                        </TableCell>
                        <TableCell>{e.branch_name}</TableCell>
                        <TableCell>
                          {e.repository_count} 个仓库 ·{" "}
                          {e.repository_scope.mode === "inherit"
                            ? "继承变体"
                            : e.repository_scope.mode === "all"
                              ? "全部"
                              : "自定义"}
                        </TableCell>
                        <TableCell>
                          <StatusText
                            tone={
                              e.binding_validity === "valid"
                                ? "success"
                                : "warning"
                            }
                          >
                            {e.binding_validity === "valid" ? "有效" : "需核对"}
                          </StatusText>
                        </TableCell>
                        <TableCell>
                          {writable && e.can_manage && (
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  aria-label={`${e.name} 更多操作`}
                                >
                                  <MoreHorizontal />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem
                                  onSelect={() =>
                                    setEditor({
                                      kind: "environment",
                                      value: e,
                                      collectionTag:
                                        data.environments!.mutation_version,
                                      edit: true,
                                    })
                                  }
                                >
                                  编辑环境
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  variant="destructive"
                                  onSelect={() =>
                                    setCommand({
                                      action: "delete",
                                      item: e,
                                      environment: true,
                                      collection:
                                        data.environments!.mutation_version,
                                    })
                                  }
                                >
                                  删除环境
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {!data.environments?.items.length && (
                  <EmptyState
                    title="为需要长期跟踪的环境绑定分支"
                    description={
                      writable
                        ? "环境用于记录固定分支与仓库范围，可按需添加测试、预发布或生产环境。无需创建环境也可以开始发布。"
                        : "此变体尚未配置环境。项目管理员可按团队需要添加环境；你也可以查看仓库与分支或发布记录。"
                    }
                    action={
                      writable ? (
                        <Button
                          onClick={() =>
                            setEditor({
                              kind: "environment",
                              collectionTag:
                                data.environments!.mutation_version,
                            })
                          }
                        >
                          添加首个环境
                        </Button>
                      ) : (
                        <Button variant="outline" asChild>
                          <Link to={"?" + href({ vview: "repositories" })}>
                            查看仓库与分支
                          </Link>
                        </Button>
                      )
                    }
                  />
                )}
                <Pagination
                  page={data.page}
                  size={data.size}
                  total={data.environments!.total}
                  pending={revalidator.state !== "idle"}
                  onChange={(n, s) =>
                    query({ epage: String(n), esize: String(s) })
                  }
                />
              </div>
            </>
          )}
        </>
      ) : (
        <div className="overflow-hidden rounded-xl border bg-card">
          <div className="list-toolbar">
            <form
              className="flex min-w-48 flex-1 gap-2 sm:max-w-md"
              onSubmit={(e) => {
                e.preventDefault();
                query({
                  q: String(new FormData(e.currentTarget).get("q") || ""),
                  page: "",
                });
              }}
            >
              <Input
                key={data.q}
                name="q"
                defaultValue={data.q}
                aria-label="搜索变体"
                placeholder="名称或编码"
              />
              <Button variant="outline">搜索</Button>
            </form>
            <NativeSelect
              className="w-auto"
              aria-label="变体状态"
              value={data.status}
              onChange={(e) => query({ status: e.target.value, page: "" })}
            >
              <option value="active">正常</option>
              <option value="archived">已归档</option>
              <option value="all">全部状态</option>
            </NativeSelect>
            {canManage && (
              <Button
                className="sm:ml-auto"
                onClick={() =>
                  setEditor({
                    kind: "variant",
                    collectionTag: data.variantCollection,
                  })
                }
              >
                新建变体
              </Button>
            )}{" "}
          </div>
          <Table aria-label="产品变体列表">
            <TableHeader>
              <TableRow>
                {["名称", "主干分支", "仓库", "环境", "状态", "操作"].map(
                  (t) => (
                    <TableHead key={t}>{t}</TableHead>
                  ),
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.variants?.items.map((item) => (
                <TableRow key={item.id}>
                  <TableCell>
                    <Link
                      className="font-medium hover:underline"
                      to={
                        "?" +
                        href({
                          variant: item.id,
                          vview: "",
                          epage: "",
                          esize: "",
                        })
                      }
                    >
                      {item.name}
                    </Link>
                    <small className="block text-muted-foreground">
                      {item.code} · {item.kind === "standard" ? "标准" : "定制"}
                    </small>
                  </TableCell>
                  <TableCell>{item.main_branch}</TableCell>
                  <TableCell>{item.repository_count}</TableCell>
                  <TableCell>{item.environment_count}</TableCell>
                  <TableCell>
                    {item.archived_at ? (
                      <StatusText tone="neutral">已归档</StatusText>
                    ) : (
                      "正常"
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => openVariant(item)}
                      >
                        变体设置
                      </Button>
                      {canManage && item.can_manage && commands(item)}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {!data.variants?.items.length && (
            <EmptyState
              title="没有匹配的产品变体"
              description="调整名称或状态筛选，查看项目中的其他变体。"
              action={
                <Button
                  variant="outline"
                  onClick={() => query({ q: "", status: "", page: "" })}
                >
                  清除筛选
                </Button>
              }
            />
          )}
          <Pagination
            page={data.page}
            size={data.size}
            total={data.variants!.total}
            pending={revalidator.state !== "idle"}
            onChange={(n, s) =>
              query({ page: String(n), page_size: String(s) })
            }
          />
        </div>
      )}
      {switching && (
        <SwitchVariant
          projectId={data.project.id}
          onClose={() => setSwitch(false)}
          onSelect={(id) => {
            setSwitch(false);
            query({ variant: id, vview: "", epage: "", esize: "" });
          }}
        />
      )}
      {lifecycleDialog}
      {configurationEditor}
    </section>
  );
}

function VariantNavigation({
  view,
  href,
}: {
  view: string;
  href: (key: string) => string;
}) {
  const active = ["history", "create"].includes(view) ? "repositories" : view;
  return (
    <nav className="variant-navigation" aria-label="变体功能">
      {[
        ["repositories", "仓库与分支"],
        ["environments", "环境"],
        ["releases", "发布"],
      ].map(([key, label]) => (
        <Link
          key={key}
          to={href(key!)}
          aria-current={active === key ? "page" : undefined}
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}
