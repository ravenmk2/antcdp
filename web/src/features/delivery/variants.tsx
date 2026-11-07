import { OverlayPresence } from "@/components/overlay-presence";
import { ArrowRight } from "lucide-react";
import {
  RowActions,
  RowAction,
  RowActionSeparator,
} from "@/components/row-actions";
import { TableToolbar } from "@/components/table-toolbar";
import { useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  GitBranch,
  Pencil,
  Plus,
  RotateCcw,
  Settings,
  Trash2,
} from "lucide-react";
import { request } from "@/api/client";
import { Button } from "@/components/button";
import {
  AsyncBoundary,
  ErrorNotice,
  Notice,
  StatusBadge,
} from "@/components/feedback";
import {
  Field,
  Input,
  Select,
  StandaloneInput,
  StandaloneSelect,
  Textarea,
} from "@/components/fields";
import { PageHeader, Panel, Tabs } from "@/components/layout";
import { ConfirmDialog, Drawer } from "@/components/overlays";
import { Pagination } from "@/components/pagination";
import { SimpleTable } from "@/components/table";
import { useApiQuery } from "@/hooks/use-api";
import { useFormErrors, useSubmission } from "@/hooks/use-form";
import { useUnsaved } from "@/hooks/use-unsaved";
import { reasonLabel } from "@/domain/labels";
import type { Resource } from "@/types/collaboration";
import type {
  BranchModel,
  Environment,
  Page,
  Scope,
  Variant,
} from "@/types/delivery";
import { emptyScope, ScopeEditor } from "./scope-editor";
import { ScopedRepositories } from "./scoped-repositories";
import { BranchCreations } from "./branch-creations";
import { ReleaseCenter } from "./release-center";

export function VariantsPage() {
  const { projectId = "" } = useParams();
  const project = useApiQuery<Resource>(
    ["project", projectId],
    `/projects/${projectId}`,
  );
  return (
    <AsyncBoundary
      loading={project.isPending}
      error={project.error}
      onRetry={() => void project.refetch()}
    >
      {project.data && <VariantsContent project={project.data.data} />}
    </AsyncBoundary>
  );
}

function VariantsContent({ project }: { project: Resource }) {
  const [params, setParams] = useSearchParams();
  const [create, setCreate] = useState(false);
  const [action, setAction] = useState<{
    type: "archive" | "restore" | "delete";
    variant: Variant;
  } | null>(null);
  const queryClient = useQueryClient();
  const q = params.get("q") ?? "";
  const status = params.get("archived") ?? "active";
  const page = Math.max(1, Number(params.get("page")) || 1);
  const size = [10, 20, 50, 100].includes(Number(params.get("page_size")))
    ? Number(params.get("page_size"))
    : 20;
  const list = useApiQuery<Page<Variant>>(
    ["variants", project.id, q, status, page, size],
    `/projects/${project.id}/variants?${new URLSearchParams({ q, archived: status, page: String(page), page_size: String(size) })}`,
  );
  const submission = useSubmission();
  function filter(values: Record<string, string>) {
    setParams((current) => {
      const next = new URLSearchParams(current);
      next.set("page", "1");
      for (const [key, value] of Object.entries(values)) {
        if (value) next.set(key, value);
        else next.delete(key);
      }
      return next;
    });
  }
  async function lifecycle() {
    if (!action) return;
    const { type, variant } = action;
    await submission.run(async () => {
      await request(
        `/projects/${project.id}/variants/${variant.id}${type === "delete" ? "" : `/${type}`}`,
        {
          method: type === "delete" ? "DELETE" : "POST",
          etag: variant.etag,
          collectionEtag:
            type === "delete" ? list.data?.collectionEtag : undefined,
          body: type === "delete" ? undefined : {},
        },
      );
      await queryClient.invalidateQueries({
        queryKey: ["variants", project.id],
      });
      await queryClient.invalidateQueries({
        queryKey: ["variant", project.id, variant.id],
      });
      setAction(null);
    });
  }
  return (
    <div className="page">
      <PageHeader
        title="产品分支"
        description="管理标准版与定制版的主干 Git 分支、动态仓库范围、环境和发布。"
      />
      <section className="panel">
        <TableToolbar
          onReset={() => filter({ q: "", archived: "active" })}
          onRefresh={() => void list.refetch()}
          refreshing={list.isFetching}
          actions={
            <>
              <Button asChild variant="outline">
                <Link
                  to={`/projects/${project.id}?tab=settings&section=branch-model`}
                >
                  <Settings />
                  Git 分支规则
                </Link>
              </Button>
              <Button
                disabled={!project.can_manage}
                onClick={() => setCreate(true)}
              >
                <Plus />
                新建产品分支
              </Button>
            </>
          }
        >
          <form
            className="flex shrink-0 items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              filter({
                q: String(new FormData(event.currentTarget).get("q") ?? ""),
              });
            }}
          >
            <StandaloneInput
              name="q"
              aria-label="搜索产品分支"
              defaultValue={q}
              placeholder="搜索名称或编码"
            />
            <Button aria-label="搜索" type="submit" variant="outline">
              搜索
            </Button>
          </form>
          <StandaloneSelect
            aria-label="产品分支状态"
            value={status}
            onValueChange={(value) => filter({ archived: value })}
          >
            <option value="active">正常</option>
            <option value="archived">已归档</option>
            <option value="all">全部</option>
          </StandaloneSelect>
        </TableToolbar>
        <p className="border-b px-4 py-2 text-xs text-muted">
          标准版始终保留且不可归档
        </p>
        <AsyncBoundary
          loading={list.isPending}
          error={list.error}
          onRetry={() => void list.refetch()}
          empty={!list.data?.data.items.length}
          emptyTitle="没有匹配的产品分支"
        >
          <SimpleTable
            actions
            label="产品分支"
            headers={[
              "产品分支",
              "类型",
              "主干 Git 分支",
              "仓库范围",
              "环境",
              "状态",
              "操作",
            ]}
          >
            {list.data?.data.items.map((variant) => (
              <tr key={variant.id}>
                <td>
                  <Link
                    className="font-medium text-foreground hover:text-primary"
                    to={`/projects/${project.id}/variants/${variant.id}`}
                  >
                    {variant.name}
                  </Link>
                  <small className="mono mt-1 block text-muted">
                    {variant.code}
                  </small>
                  {variant.summary && (
                    <small className="mt-1 block text-muted">
                      {variant.summary}
                    </small>
                  )}
                </td>
                <td>
                  <StatusBadge tone="info">
                    {variant.kind === "standard" ? "标准版" : "定制版"}
                  </StatusBadge>
                </td>
                <td className="mono">{variant.main_branch}</td>
                <td>{variant.repository_count} 个仓库</td>
                <td>{variant.environment_count} 个</td>
                <td>
                  <StatusBadge
                    tone={
                      variant.archived_at
                        ? "neutral"
                        : variant.binding_validity === "valid"
                          ? "success"
                          : "warning"
                    }
                  >
                    {variant.archived_at
                      ? "已归档"
                      : variant.binding_validity === "valid"
                        ? "正常"
                        : reasonLabel(variant.binding_reason)}
                  </StatusBadge>
                </td>
                <td>
                  <RowActions label={variant.name}>
                    <RowAction
                      icon={<ArrowRight />}
                      to={`/projects/${project.id}/variants/${variant.id}`}
                    >
                      进入产品分支
                    </RowAction>
                    {variant.kind === "custom" && variant.can_manage && (
                      <>
                        <RowAction
                          icon={
                            variant.archived_at ? <RotateCcw /> : <Archive />
                          }
                          onSelect={() =>
                            setAction({
                              type: variant.archived_at ? "restore" : "archive",
                              variant,
                            })
                          }
                        >
                          {variant.archived_at ? "恢复" : "归档"}
                        </RowAction>
                        <RowActionSeparator />
                        <RowAction
                          icon={<Trash2 />}
                          variant="destructive"
                          onSelect={() =>
                            setAction({ type: "delete", variant })
                          }
                        >
                          删除产品分支
                        </RowAction>
                      </>
                    )}
                  </RowActions>
                </td>
              </tr>
            ))}
          </SimpleTable>
        </AsyncBoundary>
        {list.data && (
          <Pagination
            page={page}
            size={size}
            total={list.data.data.total}
            pending={list.isFetching}
            onChange={(nextPage, nextSize) =>
              setParams((current) => {
                const next = new URLSearchParams(current);
                next.set("page", String(nextPage));
                next.set("page_size", String(nextSize));
                return next;
              })
            }
          />
        )}
      </section>
      <OverlayPresence>
        {create && (
          <VariantEditor
            project={project}
            collectionEtag={list.data?.collectionEtag ?? ""}
            onClose={() => setCreate(false)}
            onSaved={() => {
              setCreate(false);
              void queryClient.invalidateQueries({
                queryKey: ["variants", project.id],
              });
            }}
          />
        )}
      </OverlayPresence>
      <ConfirmDialog
        open={Boolean(action)}
        danger={action?.type !== "restore"}
        title={
          action?.type === "archive"
            ? "归档产品分支"
            : action?.type === "restore"
              ? "恢复产品分支"
              : "删除产品分支"
        }
        description={action?.variant.name}
        confirmLabel="确认"
        pending={submission.pending}
        onClose={() => setAction(null)}
        onConfirm={() => void lifecycle()}
      >
        <ErrorNotice error={submission.error} />
        <p className="text-sm text-muted">
          {action?.type === "archive"
            ? "归档后环境、远端校验、创建与发布只读。"
            : action?.type === "restore"
              ? "恢复后可继续维护；既有远端分支不变。"
              : "仅允许无环境、无执行中批次且无发布历史的定制产品分支；不会删除远端 Git 分支。"}
        </p>
      </ConfirmDialog>
    </div>
  );
}

export function VariantDetailPage() {
  const { projectId = "", variantId = "" } = useParams();
  const project = useApiQuery<Resource>(
    ["project", projectId],
    `/projects/${projectId}`,
  );
  const variant = useApiQuery<Variant>(
    ["variant", projectId, variantId],
    `/projects/${projectId}/variants/${variantId}`,
  );
  return (
    <AsyncBoundary
      loading={project.isPending || variant.isPending}
      error={project.error ?? variant.error}
      onRetry={() => {
        void project.refetch();
        void variant.refetch();
      }}
    >
      {project.data && variant.data && (
        <VariantDetail
          key={variant.data.etag}
          project={project.data.data}
          variant={variant.data.data}
        />
      )}
    </AsyncBoundary>
  );
}

function VariantDetail({
  project,
  variant,
}: {
  project: Resource;
  variant: Variant;
}) {
  const [params, setParams] = useSearchParams();
  const [edit, setEdit] = useState(false);
  const [environments, setEnvironments] = useState(false);
  const view = params.get("vview") ?? "repositories";
  const queryClient = useQueryClient();
  function change(value: string) {
    setParams((current) => {
      const next = new URLSearchParams(current);
      next.set("vview", value);
      next.delete("creation");
      next.delete("create");
      return next;
    });
  }
  return (
    <div className="page page-wide">
      <PageHeader
        title={
          <span className="flex items-center gap-3">
            <GitBranch className="size-7 text-primary" />
            {variant.name}
          </span>
        }
        description={
          <>
            <span className="mono">{variant.code}</span> · 主干{" "}
            <span className="mono">{variant.main_branch}</span> ·{" "}
            {variant.repository_count} 个仓库
          </>
        }
        actions={
          <>
            <StatusBadge
              tone={
                variant.archived_at
                  ? "neutral"
                  : variant.binding_validity === "valid"
                    ? "success"
                    : "warning"
              }
            >
              {variant.archived_at
                ? "已归档"
                : variant.binding_validity === "valid"
                  ? "绑定有效"
                  : reasonLabel(variant.binding_reason)}
            </StatusBadge>
            <Button
              variant="outline"
              disabled={!variant.can_manage}
              onClick={() => setEdit(true)}
            >
              <Pencil />
              产品分支设置
            </Button>
          </>
        }
      />
      {variant.summary && (
        <p className="-mt-3 mb-5 text-sm text-muted">{variant.summary}</p>
      )}
      <Tabs
        label="产品分支功能"
        value={view}
        onChange={change}
        items={[
          { value: "repositories", label: "仓库与分支" },
          { value: "environments", label: "环境" },
          { value: "releases", label: "发布" },
          { value: "creations", label: "创建记录" },
        ]}
      />
      <div className="mt-5">
        {view === "repositories" && (
          <ScopedRepositories project={project} variant={variant} />
        )}
        {view === "environments" && (
          <EnvironmentsPanel
            project={project}
            variant={variant}
            create={environments}
            onCreate={setEnvironments}
          />
        )}
        {view === "releases" && (
          <ReleaseCenter project={project} variant={variant} />
        )}
        {view === "creations" && (
          <BranchCreations project={project} variant={variant} />
        )}
      </div>
      <OverlayPresence>
        {edit && (
          <VariantEditor
            project={project}
            variant={variant}
            onClose={() => setEdit(false)}
            onSaved={async () => {
              setEdit(false);
              await queryClient.invalidateQueries({
                queryKey: ["variant", project.id, variant.id],
              });
              await queryClient.invalidateQueries({
                queryKey: ["variants", project.id],
              });
            }}
          />
        )}
      </OverlayPresence>
    </div>
  );
}

function VariantEditor({
  project,
  variant,
  collectionEtag,
  onClose,
  onSaved,
}: {
  project: Resource;
  variant?: Variant;
  collectionEtag?: string;
  onClose: () => void;
  onSaved: (variant: Variant) => void | Promise<void>;
}) {
  const create = !variant;
  const [form, setForm] = useState({
    code: variant?.code ?? "",
    name: variant?.name ?? "",
    summary: variant?.summary ?? "",
    main_branch: variant?.main_branch ?? "main",
  });
  const [scope, setScope] = useState<Scope>(
    variant?.repository_scope ?? emptyScope(),
  );
  const [tagPrefix, setTagPrefix] = useState(variant?.release_tag_prefix ?? "");
  const errors = useFormErrors();
  const submission = useSubmission();
  const initial = JSON.stringify({
    form: {
      code: variant?.code ?? "",
      name: variant?.name ?? "",
      summary: variant?.summary ?? "",
      main_branch: variant?.main_branch ?? "main",
    },
    scope: variant?.repository_scope ?? emptyScope(),
    tagPrefix: variant?.release_tag_prefix ?? "",
  });
  const dirty = JSON.stringify({ form, scope, tagPrefix }) !== initial;
  useUnsaved(dirty, submission.pending);
  function update(key: keyof typeof form, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
    errors.change(key);
  }
  async function save() {
    const fields: Record<string, string> = {};
    if (!form.name.trim()) fields.name = "请输入名称";
    if (
      create &&
      !/^[A-Za-z0-9][A-Za-z0-9_-]{0,62}[A-Za-z0-9]$/.test(form.code)
    )
      fields.code = "编码格式不正确";
    if (!form.main_branch) fields.main_branch = "请输入主干 Git 分支";
    if (!errors.validate(fields)) return;
    await submission.run(
      async () => {
        const path = create
          ? `/projects/${project.id}/variants`
          : `/projects/${project.id}/variants/${variant.id}`;
        const response = await request<Variant>(path, {
          method: create ? "POST" : "PATCH",
          ...(create ? { etag: collectionEtag } : { etag: variant.etag }),
          body: create
            ? { ...form, repository_scope: scope }
            : {
                name: form.name.trim(),
                summary: form.summary,
                main_branch: form.main_branch,
                repository_scope: scope,
              },
        });
        if (!create && tagPrefix !== variant.release_tag_prefix)
          await request(
            `/projects/${project.id}/variants/${variant.id}/release-settings`,
            {
              method: "PATCH",
              etag: response.etag,
              body: { tag_prefix: tagPrefix },
            },
          );
        await onSaved(response.data);
      },
      (error) =>
        errors.show(error, [
          "code",
          "name",
          "summary",
          "main_branch",
          "repository_scope",
          "tag_prefix",
        ]),
    );
  }
  return (
    <Drawer
      open
      wide
      title={create ? "新建定制产品分支" : "产品分支设置"}
      description={
        variant
          ? `${variant.code} · ${variant.kind === "standard" ? "标准版" : "定制版"}`
          : "创建后类型与编码不可修改"
      }
      dirty={dirty}
      pending={submission.pending}
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button pending={submission.pending} onClick={() => void save()}>
            {create ? "创建产品分支" : "保存更改"}
          </Button>
        </>
      }
    >
      <form
        ref={errors.formRef}
        className="grid gap-5"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <ErrorNotice error={errors.error} />
        <ErrorNotice error={submission.error} />
        <div className="form-grid">
          <Field label="名称" required error={errors.fields.name}>
            <Input
              name="name"
              value={form.name}
              onChange={(event) => update("name", event.target.value)}
            />
          </Field>
          <Field
            label="编码"
            required
            hint="创建后不可修改"
            error={errors.fields.code}
          >
            <Input
              name="code"
              className="mono"
              readOnly={!create}
              value={form.code}
              onChange={(event) => update("code", event.target.value)}
            />
          </Field>
          <Field
            label="摘要"
            className="form-full"
            error={errors.fields.summary}
          >
            <Textarea
              name="summary"
              value={form.summary}
              onChange={(event) => update("summary", event.target.value)}
            />
          </Field>
          <Field
            label="主干 Git 分支"
            required
            hint={
              variant?.kind === "standard"
                ? "使用主线类型规则"
                : "使用定制类型规则"
            }
            error={errors.fields.main_branch}
            className="form-full"
          >
            <Input
              name="main_branch"
              className="mono"
              value={form.main_branch}
              onChange={(event) => update("main_branch", event.target.value)}
            />
          </Field>
          {!create && (
            <Field
              label="发布 Tag 前缀"
              hint="只影响之后新建的发布；与版本号直接拼接"
              error={errors.fields.tag_prefix}
              className="form-full"
            >
              <Input
                name="tag_prefix"
                className="mono"
                value={tagPrefix}
                onChange={(event) => setTagPrefix(event.target.value)}
              />
            </Field>
          )}
        </div>
        <ScopeEditor
          projectId={project.id}
          value={scope}
          onChange={setScope}
          variant={variant}
          disabled={submission.pending}
        />
        <Notice>
          保存配置不会创建或重命名远端分支；创建主干需在仓库工作区另行准备与确认。
        </Notice>
      </form>
    </Drawer>
  );
}

function EnvironmentsPanel({
  project,
  variant,
  create,
  onCreate,
}: {
  project: Resource;
  variant: Variant;
  create: boolean;
  onCreate: (value: boolean) => void;
}) {
  const list = useApiQuery<Page<Environment>>(
    ["environments", project.id, variant.id],
    `/projects/${project.id}/variants/${variant.id}/environments`,
  );
  const [selected, setSelected] = useState<Environment | null>(null);
  const queryClient = useQueryClient();
  async function refresh() {
    await queryClient.invalidateQueries({
      queryKey: ["environments", project.id, variant.id],
    });
  }
  return (
    <Panel title="环境">
      <TableToolbar
        onRefresh={() => list.refetch()}
        refreshing={list.isFetching}
        actions={
          <Button disabled={!variant.can_manage} onClick={() => onCreate(true)}>
            <Plus />
            新建环境
          </Button>
        }
      />

      <Notice className="mb-4">
        环境只绑定 Git 分支与仓库范围，不表示已部署，也不决定执行顺序。
      </Notice>
      <AsyncBoundary
        loading={list.isPending}
        error={list.error}
        onRetry={() => void list.refetch()}
        empty={!list.data?.data.items.length}
        emptyTitle="尚未配置环境"
      >
        <SimpleTable
          actions
          label="环境"
          headers={["环境", "绑定 Git 分支", "仓库", "绑定状态", "操作"]}
        >
          {list.data?.data.items.map((environment) => (
            <tr key={environment.id}>
              <td>
                <strong className="text-foreground">{environment.name}</strong>
                <small className="mono block text-muted">
                  {environment.code}
                </small>
              </td>
              <td>
                <span className="mono">{environment.branch_name}</span>
                <small className="block text-muted">
                  {environment.branch_type}
                </small>
              </td>
              <td>{environment.repository_count} 个</td>
              <td>
                <StatusBadge
                  tone={
                    environment.binding_validity === "valid"
                      ? "success"
                      : "warning"
                  }
                >
                  {environment.binding_validity === "valid"
                    ? "有效"
                    : reasonLabel(environment.binding_reason)}
                </StatusBadge>
              </td>
              <td>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setSelected(environment)}
                >
                  查看
                </Button>
              </td>
            </tr>
          ))}
        </SimpleTable>
      </AsyncBoundary>
      <OverlayPresence>
        {create && (
          <EnvironmentEditor
            project={project}
            variant={variant}
            collectionEtag={list.data?.collectionEtag ?? ""}
            onClose={() => onCreate(false)}
            onSaved={refresh}
          />
        )}
      </OverlayPresence>
      <OverlayPresence>
        {selected && (
          <EnvironmentEditor
            project={project}
            variant={variant}
            environment={selected}
            onClose={() => setSelected(null)}
            onSaved={refresh}
          />
        )}
      </OverlayPresence>
    </Panel>
  );
}

function EnvironmentEditor({
  project,
  variant,
  environment,
  collectionEtag,
  onClose,
  onSaved,
}: {
  project: Resource;
  variant: Variant;
  environment?: Environment;
  collectionEtag?: string;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [form, setForm] = useState({
    code: environment?.code ?? "",
    name: environment?.name ?? "",
    summary: environment?.summary ?? "",
    branch_type: environment?.branch_type ?? "mainline",
    branch_name: environment?.branch_name ?? "main",
  });
  const [scope, setScope] = useState<Scope>(
    environment?.repository_scope ?? emptyScope(true),
  );
  const [remove, setRemove] = useState(false);
  const errors = useFormErrors();
  const submission = useSubmission();
  const model = useApiQuery<BranchModel>(
    ["branch-model", project.id],
    `/projects/${project.id}/branch-model`,
  );
  const dirty = true;
  useUnsaved(dirty, submission.pending);
  async function save() {
    if (!form.name.trim() || !form.branch_name) {
      errors.validate({
        ...(!form.name.trim() ? { name: "请输入环境名称" } : {}),
        ...(!form.branch_name ? { branch_name: "请输入绑定 Git 分支" } : {}),
      });
      return;
    }
    await submission.run(
      async () => {
        await request(
          environment
            ? `/projects/${project.id}/variants/${variant.id}/environments/${environment.id}`
            : `/projects/${project.id}/variants/${variant.id}/environments`,
          {
            method: environment ? "PATCH" : "POST",
            etag: environment?.etag ?? collectionEtag,
            body: environment
              ? {
                  name: form.name.trim(),
                  summary: form.summary,
                  branch_type: form.branch_type,
                  branch_name: form.branch_name,
                  repository_scope: scope,
                }
              : { ...form, repository_scope: scope },
          },
        );
        await onSaved();
        onClose();
      },
      (error) =>
        errors.show(error, [
          "code",
          "name",
          "summary",
          "branch_type",
          "branch_name",
          "repository_scope",
        ]),
    );
  }
  return (
    <>
      <Drawer
        open
        wide
        title={environment ? "环境详情与设置" : "新建环境"}
        description={`${variant.name} · 固定 Git 分支，不支持动态 latest`}
        dirty={dirty}
        pending={submission.pending}
        onClose={onClose}
        footer={
          <>
            {environment && variant.can_manage && (
              <Button
                variant="dangerSoft"
                className="mr-auto"
                onClick={() => setRemove(true)}
              >
                <Trash2 />
                删除环境
              </Button>
            )}
            <Button variant="outline" onClick={onClose}>
              取消
            </Button>
            <Button
              disabled={!variant.can_manage}
              pending={submission.pending}
              onClick={() => void save()}
            >
              {environment ? "保存更改" : "创建环境"}
            </Button>
          </>
        }
      >
        <form
          ref={errors.formRef}
          className="grid gap-5"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <ErrorNotice error={errors.error} />
          <div className="form-grid">
            <Field label="环境名称" required error={errors.fields.name}>
              <Input
                name="name"
                value={form.name}
                onChange={(event) =>
                  setForm({ ...form, name: event.target.value })
                }
              />
            </Field>
            <Field label="编码" required error={errors.fields.code}>
              <Input
                name="code"
                className="mono"
                readOnly={Boolean(environment)}
                value={form.code}
                onChange={(event) =>
                  setForm({ ...form, code: event.target.value })
                }
              />
            </Field>
            <Field
              label="Git 分支类型"
              required
              error={errors.fields.branch_type}
            >
              <Select
                name="branch_type"
                value={form.branch_type}
                onValueChange={(value) =>
                  setForm({ ...form, branch_type: value })
                }
              >
                {model.data?.data.types
                  .filter((type) => type.allow_environment)
                  .map((type) => (
                    <option key={type.branch_type} value={type.branch_type}>
                      {type.label} · {type.branch_type}
                    </option>
                  ))}
              </Select>
            </Field>
            <Field
              label="绑定 Git 分支"
              required
              error={errors.fields.branch_name}
            >
              <Input
                name="branch_name"
                className="mono"
                value={form.branch_name}
                onChange={(event) =>
                  setForm({ ...form, branch_name: event.target.value })
                }
              />
            </Field>
            <Field label="说明" className="form-full">
              <Textarea
                value={form.summary}
                onChange={(event) =>
                  setForm({ ...form, summary: event.target.value })
                }
              />
            </Field>
          </div>
          <ScopeEditor
            projectId={project.id}
            value={scope}
            onChange={setScope}
            environment
            variant={variant}
            disabled={!variant.can_manage}
          />
        </form>
        {environment && (
          <div className="mt-6 border-t pt-5">
            <ScopedRepositories
              project={project}
              variant={variant}
              environment={environment}
            />
          </div>
        )}
      </Drawer>
      <ConfirmDialog
        open={remove}
        danger
        title="删除环境"
        description={`${environment?.name ?? ""} · 不删除远端 Git 分支`}
        confirmLabel="删除环境"
        pending={submission.pending}
        onClose={() => setRemove(false)}
        onConfirm={() => {
          if (!environment) return;
          void submission.run(async () => {
            await request(
              `/projects/${project.id}/variants/${variant.id}/environments/${environment.id}`,
              { method: "DELETE", etag: environment.etag, collectionEtag },
            );
            await onSaved();
            onClose();
          });
        }}
      >
        <ErrorNotice error={submission.error} />
      </ConfirmDialog>
    </>
  );
}
