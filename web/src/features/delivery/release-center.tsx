import { useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Pencil, Plus } from "lucide-react";
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
import { Drawer } from "@/components/overlays";
import { Pagination } from "@/components/pagination";
import { SimpleTable } from "@/components/table";
import { useApiQuery } from "@/hooks/use-api";
import { useFormErrors, useSubmission } from "@/hooks/use-form";
import { releaseStatus, resultTone } from "@/domain/labels";
import { formatDate } from "@/lib/utils";
import type { Page, Resource } from "@/types/collaboration";
import type {
  MaterialSet,
  ProjectRelease,
  Release,
  ReleaseFlow,
  Variant,
} from "@/types/delivery";
import { ReleaseChanges } from "./release-changes";
import { ReleaseHero } from "./release-hero";
import { ReleaseMaterials } from "./release-materials";
import { ReleaseWorkflow } from "./release-workflow";
import { releaseHref } from "../workspace/project-overview";

export function ReleaseCenter({
  project,
  variant,
}: {
  project: Resource;
  variant?: Variant;
  admin?: boolean;
}) {
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const releaseId = params.get("release");
  const selectedVariant = params.get("variant") ?? "";
  const activeVariantId = variant?.id ?? selectedVariant;
  const variants = useApiQuery<Page<Variant>>(
    ["variants", project.id, "release-picker"],
    `/projects/${project.id}/variants?archived=all&page=1&page_size=100`,
    { enabled: !variant },
  );
  const lookup = useApiQuery<Page<ProjectRelease>>(
    ["release-lookup", project.id, releaseId],
    `/projects/${project.id}/releases?status=all&page=1&page_size=100`,
    { enabled: Boolean(releaseId && !activeVariantId) },
  );
  const found = releaseId
    ? lookup.data?.data.items.find((item) => item.id === releaseId)
    : undefined;
  const resolvedVariantId = activeVariantId || found?.variant_id || "";
  const selected =
    variant ??
    variants.data?.data.items.find((item) => item.id === resolvedVariantId);
  const q = params.get("rq") ?? "";
  const status = params.get("rstatus") ?? "active";
  const page = Math.max(1, Number(params.get("rpage")) || 1);
  const size = [10, 20, 50, 100].includes(Number(params.get("rsize")))
    ? Number(params.get("rsize"))
    : 20;
  const base = variant
    ? `/projects/${project.id}/variants/${variant.id}/releases`
    : `/projects/${project.id}/releases`;
  const list = useApiQuery<Page<ProjectRelease | Release>>(
    ["releases", project.id, variant?.id, q, status, page, size],
    `${base}?${new URLSearchParams({ q, status, page: String(page), page_size: String(size) })}`,
  );
  if (releaseId && resolvedVariantId && selected) {
    return (
      <ReleaseDetail
        project={project}
        variant={selected}
        releaseId={releaseId}
      />
    );
  }
  if (
    releaseId &&
    ((lookup.isPending && !activeVariantId) || (!variant && variants.isPending))
  )
    return (
      <div className="page">
        <AsyncBoundary loading />
      </div>
    );
  if (releaseId && lookup.data && !found && !activeVariantId)
    return (
      <div className="page">
        <Notice tone="danger">发布不存在或不属于当前项目。</Notice>
      </div>
    );
  if (params.get("create") === "1") {
    return (
      <CreateRelease
        project={project}
        variant={selected}
        variants={variants.data?.data.items ?? []}
        onSelect={(id) =>
          setParams((current) => {
            const next = new URLSearchParams(current);
            next.set("variant", id);
            return next;
          })
        }
        onCancel={() =>
          setParams((current) => {
            const next = new URLSearchParams(current);
            next.delete("create");
            next.delete("variant");
            return next;
          })
        }
      />
    );
  }
  function filter(values: Record<string, string>) {
    setParams((current) => {
      const next = new URLSearchParams(current);
      next.set("rpage", "1");
      for (const [key, value] of Object.entries(values)) {
        if (value) next.set(key, value);
        else next.delete(key);
      }
      return next;
    });
  }
  return (
    <div>
      <PageHeader
        title="发布管理"
        description="管理发布草稿、变更与材料、冻结验收、Tag 和归档记录。"
        actions={
          <Button
            disabled={variant ? !variant.can_manage : !project.can_manage}
            onClick={() =>
              setParams((current) => {
                const next = new URLSearchParams(current);
                next.set("create", "1");
                return next;
              })
            }
          >
            <Plus />
            创建发布
          </Button>
        }
      />
      <section className="panel">
        <div className="toolbar">
          <form
            className="flex min-w-52 flex-1 gap-2 sm:max-w-sm"
            onSubmit={(event) => {
              event.preventDefault();
              filter({
                rq: String(new FormData(event.currentTarget).get("q") ?? ""),
              });
            }}
          >
            <StandaloneInput
              name="q"
              aria-label="搜索发布"
              defaultValue={q}
              placeholder="搜索名称、版本号或 Tag"
            />
            <Button type="submit" variant="outline">
              搜索
            </Button>
          </form>
          {!variant && (
            <StandaloneSelect
              aria-label="产品分支筛选"
              value={selectedVariant}
              onChange={(event) => filter({ variant: event.target.value })}
            >
              <option value="">全部产品分支</option>
              {variants.data?.data.items.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </StandaloneSelect>
          )}
          <StandaloneSelect
            aria-label="发布阶段筛选"
            value={status}
            onChange={(event) => filter({ rstatus: event.target.value })}
          >
            {[
              "active",
              "attention",
              "all",
              "draft",
              "integrating",
              "reviewing",
              "accepted",
              "tagging",
              "archived",
              "terminated",
            ].map((value) => (
              <option key={value} value={value}>
                {value === "active"
                  ? "进行中"
                  : value === "attention"
                    ? "结果待核实"
                    : value === "all"
                      ? "全部"
                      : releaseStatus(value)}
              </option>
            ))}
          </StandaloneSelect>
          <Button
            variant="ghost"
            onClick={() => filter({ rq: "", rstatus: "active", variant: "" })}
          >
            清除筛选
          </Button>
        </div>
        <AsyncBoundary
          loading={list.isPending}
          error={list.error}
          onRetry={() => void list.refetch()}
          empty={!list.data?.data.items.length}
          emptyTitle="暂无发布"
          emptyDescription="可创建草稿后再补充变更与材料；允许零 MR 的纯材料发布。"
        >
          <SimpleTable
            label="发布列表"
            headers={["发布", "产品分支", "阶段", "版本 / Tag", "最近更新", ""]}
          >
            {list.data?.data.items.map((release) => {
              const variantId =
                "variant_id" in release
                  ? release.variant_id
                  : (variant?.id ?? "");
              const variantName =
                "variant_name" in release
                  ? release.variant_name
                  : (variant?.name ?? "");
              return (
                <tr key={release.id}>
                  <td>
                    <Link
                      className="font-medium text-foreground hover:text-primary"
                      to={releaseHref(
                        project.id,
                        variantId,
                        release.id,
                        location.pathname + location.search,
                      )}
                    >
                      {release.name || release.version_label}
                    </Link>
                    {release.needs_attention && (
                      <StatusBadge tone="warning">结果待核实</StatusBadge>
                    )}
                  </td>
                  <td>{variantName}</td>
                  <td>
                    <StatusBadge tone={resultTone(release.status)}>
                      {releaseStatus(release.status)}
                    </StatusBadge>
                  </td>
                  <td>
                    <span className="mono">{release.version_label}</span>
                    <small className="mono block text-muted">
                      {release.tag_name}
                    </small>
                  </td>
                  <td className="text-xs text-muted">
                    {formatDate(release.updated_at)}
                  </td>
                  <td>
                    <Link
                      className="link"
                      aria-label={`打开 ${release.name || release.version_label}`}
                      to={releaseHref(project.id, variantId, release.id)}
                    >
                      <ArrowRight className="size-4" />
                    </Link>
                  </td>
                </tr>
              );
            })}
          </SimpleTable>
        </AsyncBoundary>
        {list.data && (
          <Pagination
            page={page}
            size={size}
            total={list.data.data.total}
            pending={list.isFetching}
            onChange={(nextPage, nextSize) => {
              setParams((current) => {
                const next = new URLSearchParams(current);
                next.set("rpage", String(nextPage));
                next.set("rsize", String(nextSize));
                return next;
              });
            }}
          />
        )}
      </section>
    </div>
  );
}

function CreateRelease({
  project,
  variant,
  variants,
  onSelect,
  onCancel,
}: {
  project: Resource;
  variant?: Variant;
  variants: Variant[];
  onSelect: (id: string) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState({
    name: "",
    version_label: "",
    description_md: "",
  });
  const [prefix, setPrefix] = useState(variant?.release_tag_prefix ?? "");
  const [savedVariant, setSavedVariant] = useState(variant);
  const errors = useFormErrors();
  const submission = useSubmission();
  const queryClient = useQueryClient();
  const maybeVariant = savedVariant ?? variant;
  if (!maybeVariant)
    return (
      <Panel title="选择产品分支">
        <p className="mb-4 text-sm text-muted">
          发布必须属于一个产品分支；归档产品分支不可创建新发布。
        </p>
        <Field label="产品分支" required>
          <Select onChange={(event) => onSelect(event.target.value)} value="">
            <option value="">请选择</option>
            {variants
              .filter((item) => !item.archived_at)
              .map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name} · {item.code}
                </option>
              ))}
          </Select>
        </Field>
        <div className="form-actions">
          <Button variant="outline" onClick={onCancel}>
            取消
          </Button>
        </div>
      </Panel>
    );
  const currentVariant: Variant = maybeVariant;
  async function savePrefix() {
    if (!prefix) {
      errors.validate({ tag_prefix: "请设置 Tag 前缀" });
      return false;
    }
    return submission.run(
      async () => {
        const response = await request<Variant>(
          `/projects/${project.id}/variants/${currentVariant.id}/release-settings`,
          {
            method: "PATCH",
            etag: currentVariant.etag,
            body: { tag_prefix: prefix },
          },
        );
        setSavedVariant({
          ...currentVariant,
          release_tag_prefix: prefix,
          etag: response.etag,
        });
        await queryClient.invalidateQueries({
          queryKey: ["variant", project.id, currentVariant.id],
        });
      },
      (error) => errors.show(error, ["tag_prefix"]),
    );
  }
  async function create() {
    const fields: Record<string, string> = {};
    if (
      !/^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,94}[A-Za-z0-9])?$/.test(
        form.version_label,
      )
    )
      fields.version_label =
        "版本号须为 1–96 位，首尾字母或数字，可含点、下划线和连字符";
    if (Array.from(form.name.trim()).length > 120)
      fields.name = "发布名称最多 120 个字符";
    if (Array.from(form.description_md).length > 16000)
      fields.description_md = "发布说明最多 16000 个字符";
    if (!errors.validate(fields)) return;
    if (!currentVariant.release_tag_prefix) {
      await savePrefix();
      return;
    }
    await submission.run(
      async () => {
        const response = await request<Release>(
          `/projects/${project.id}/variants/${currentVariant.id}/releases`,
          {
            method: "POST",
            body: {
              name: form.name.trim(),
              version_label: form.version_label,
              description_md: form.description_md,
            },
          },
        );
        await queryClient.invalidateQueries({
          queryKey: ["releases", project.id],
        });
        const target = releaseHref(
          project.id,
          currentVariant.id,
          response.data.id,
        );
        window.history.replaceState(null, "", target);
        window.dispatchEvent(new PopStateEvent("popstate"));
      },
      (error) =>
        errors.show(error, [
          "name",
          "version_label",
          "description_md",
          "tag_prefix",
        ]),
    );
  }
  return (
    <Panel
      title="创建发布草稿"
      action={
        <Button variant="ghost" onClick={onCancel}>
          <ArrowLeft />
          返回发布列表
        </Button>
      }
    >
      <Notice className="mb-5">
        可先保存空范围草稿；开始发布前仍需至少一个范围仓库及全部基线。创建响应丢失时先按产品分支和版本号查询，不要盲目重发。
      </Notice>
      <form
        ref={errors.formRef}
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void create();
        }}
      >
        <ErrorNotice error={errors.error} />
        <ErrorNotice error={submission.error} />
        <div className="form-grid">
          <Field label="产品分支">
            <Input
              value={`${currentVariant.name} · ${currentVariant.code}`}
              readOnly
            />
          </Field>
          <Field
            label="Tag 前缀"
            required
            hint="与版本号直接拼接，之后新建发布沿用"
            error={errors.fields.tag_prefix}
          >
            <Input
              name="tag_prefix"
              className="mono"
              value={currentVariant.release_tag_prefix || prefix}
              readOnly={Boolean(currentVariant.release_tag_prefix)}
              onChange={(event) => setPrefix(event.target.value)}
            />
          </Field>
          <Field label="发布名称（可选）" error={errors.fields.name}>
            <Input
              name="name"
              value={form.name}
              onChange={(event) =>
                setForm({ ...form, name: event.target.value })
              }
            />
          </Field>
          <Field
            label="版本号"
            required
            hint={`完整 Tag：${currentVariant.release_tag_prefix || prefix || "<前缀>"}${form.version_label || "<版本>"}`}
            error={errors.fields.version_label}
          >
            <Input
              name="version_label"
              className="mono"
              value={form.version_label}
              onChange={(event) =>
                setForm({ ...form, version_label: event.target.value })
              }
            />
          </Field>
          <Field
            label="发布说明"
            className="form-full"
            error={errors.fields.description_md}
          >
            <Textarea
              name="description_md"
              className="min-h-40 font-mono"
              value={form.description_md}
              onChange={(event) =>
                setForm({ ...form, description_md: event.target.value })
              }
            />
          </Field>
        </div>
        <div className="form-actions">
          <Button variant="outline" onClick={onCancel}>
            取消
          </Button>
          <Button
            pending={submission.pending}
            disabled={submission.uncertain}
            type="submit"
          >
            {currentVariant.release_tag_prefix
              ? "创建发布草稿"
              : "保存前缀并继续"}
          </Button>
        </div>
      </form>
    </Panel>
  );
}

function ReleaseDetail({
  project,
  variant,
  releaseId,
}: {
  project: Resource;
  variant: Variant;
  releaseId: string;
}) {
  const base = `/projects/${project.id}/variants/${variant.id}/releases/${releaseId}`;
  const release = useApiQuery<Release>(
    ["release", project.id, variant.id, releaseId],
    base,
  );
  const materials = useApiQuery<MaterialSet>(
    ["release-materials", project.id, variant.id, releaseId],
    `${base}/items`,
  );
  const flow = useApiQuery<ReleaseFlow>(
    ["release-flow", project.id, variant.id, releaseId],
    `${base}/workflow`,
  );
  const [params, setParams] = useSearchParams();
  const [edit, setEdit] = useState(false);
  const queryClient = useQueryClient();
  const view =
    params.get("rview") ??
    (["reviewing", "accepted", "tagging", "archived"].includes(
      release.data?.data.status ?? "",
    )
      ? "manifests"
      : "changes");
  async function refresh() {
    await Promise.all([release.refetch(), materials.refetch(), flow.refetch()]);
  }
  if (release.isPending || materials.isPending || flow.isPending)
    return <AsyncBoundary loading />;
  if (release.error || materials.error || flow.error)
    return (
      <AsyncBoundary
        error={release.error ?? materials.error ?? flow.error}
        onRetry={() => void refresh()}
      />
    );
  if (!release.data || !materials.data || !flow.data) return null;
  const current = release.data.data;
  return (
    <div>
      <PageHeader
        title={current.name || current.version_label}
        description={
          <>
            <span>{variant.name}</span> ·{" "}
            <span className="mono">
              {current.version_label} · {current.tag_name}
            </span>
          </>
        }
        actions={
          <>
            <StatusBadge tone={resultTone(current.status)}>
              {releaseStatus(current.status)}
            </StatusBadge>
            {current.needs_attention && (
              <StatusBadge tone="warning">结果待核实</StatusBadge>
            )}
            {["draft", "integrating"].includes(current.status) &&
              materials.data.data.can_edit && (
                <Button variant="outline" onClick={() => setEdit(true)}>
                  <Pencil />
                  编辑发布
                </Button>
              )}
            <Button asChild variant="outline">
              <Link
                to={`/projects/${project.id}?tab=releases&variant=${variant.id}`}
              >
                <ArrowLeft />
                返回列表
              </Link>
            </Button>
          </>
        }
      />
      {release.data.etag !== materials.data.etag && (
        <Notice tone="warning" className="mb-4">
          发布在读取期间发生变化，请刷新后再执行写入。
        </Notice>
      )}
      <ReleaseHero
        release={{
          ...current,
          variant_id: variant.id,
          variant_name: variant.name,
          variant_code: variant.code,
        }}
        heading="发布工作流"
        meta={`${flow.data.data.changes.filter((change) => change.status !== "removed").length} 项变更 · ${materials.data.data.items.length} 份材料`}
      />
      <div className="split-workspace">
        <div className="min-w-0">
          <Tabs
            label="发布工作区"
            value={view}
            onChange={(value) =>
              setParams((currentParams) => {
                const next = new URLSearchParams(currentParams);
                next.set("rview", value);
                return next;
              })
            }
            items={[
              { value: "changes", label: "本次变更" },
              {
                value: "materials",
                label: `交付材料 · ${materials.data.data.items.length}`,
              },
              {
                value: "manifests",
                label: `送验清单 · ${flow.data.data.manifests.length}`,
              },
              {
                value: "operations",
                label: `操作记录 · ${flow.data.data.operations.length}`,
              },
            ]}
          />
          <div className="mt-5">
            {view === "changes" && (
              <ReleaseChanges
                project={project}
                variant={variant}
                release={current}
                releaseEtag={release.data.etag}
                materials={materials.data.data}
                flow={flow.data.data}
                onChanged={refresh}
              />
            )}
            {view === "materials" && (
              <ReleaseMaterials
                project={project}
                variant={variant}
                release={current}
                releaseEtag={release.data.etag}
                materials={materials.data.data}
                flow={flow.data.data}
                onChanged={refresh}
              />
            )}
            {(view === "manifests" || view === "operations") && (
              <ReleaseWorkflow
                project={project}
                variant={variant}
                release={current}
                releaseEtag={release.data.etag}
                materials={materials.data.data}
                flow={flow.data.data}
                view={view}
                onChanged={refresh}
              />
            )}
          </div>
        </div>
        <ReleaseWorkflow
          project={project}
          variant={variant}
          release={current}
          releaseEtag={release.data.etag}
          materials={materials.data.data}
          flow={flow.data.data}
          view="stage"
          onChanged={refresh}
        />
      </div>
      {edit && (
        <ReleaseEditor
          base={base}
          release={current}
          etag={release.data.etag}
          canManage={flow.data.data.can_manage}
          onClose={() => setEdit(false)}
          onSaved={async () => {
            setEdit(false);
            await queryClient.invalidateQueries({
              queryKey: ["release", project.id, variant.id, releaseId],
            });
          }}
        />
      )}
    </div>
  );
}

function ReleaseEditor({
  base,
  release,
  etag,
  canManage,
  onClose,
  onSaved,
}: {
  base: string;
  release: Release;
  etag: string;
  canManage: boolean;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [form, setForm] = useState({
    name: release.name,
    version_label: release.version_label,
    description_md: release.description_md,
  });
  const errors = useFormErrors();
  const submission = useSubmission();
  const dirty =
    JSON.stringify(form) !==
    JSON.stringify({
      name: release.name,
      version_label: release.version_label,
      description_md: release.description_md,
    });
  async function save() {
    await submission.run(
      async () => {
        await request(base, {
          method: "PATCH",
          etag,
          body: {
            ...(canManage ? { name: form.name.trim() } : {}),
            ...(canManage && release.status === "draft"
              ? { version_label: form.version_label }
              : {}),
            description_md: form.description_md,
          },
        });
        await onSaved();
      },
      (error) =>
        errors.show(error, ["name", "version_label", "description_md"]),
    );
  }
  return (
    <Drawer
      open
      wide
      title="编辑发布"
      description={`${release.tag_name} · ${releaseStatus(release.status)}`}
      dirty={dirty}
      pending={submission.pending}
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button pending={submission.pending} onClick={() => void save()}>
            保存更改
          </Button>
        </>
      }
    >
      <form
        ref={errors.formRef}
        className="grid gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <ErrorNotice error={errors.error} />
        {canManage && (
          <Field label="发布名称" error={errors.fields.name}>
            <Input
              name="name"
              value={form.name}
              onChange={(event) =>
                setForm({ ...form, name: event.target.value })
              }
            />
          </Field>
        )}
        {canManage && release.status === "draft" && (
          <Field label="版本号" required error={errors.fields.version_label}>
            <Input
              name="version_label"
              className="mono"
              value={form.version_label}
              onChange={(event) =>
                setForm({ ...form, version_label: event.target.value })
              }
            />
          </Field>
        )}
        <Field label="发布说明" error={errors.fields.description_md}>
          <Textarea
            name="description_md"
            className="min-h-56 font-mono"
            value={form.description_md}
            onChange={(event) =>
              setForm({ ...form, description_md: event.target.value })
            }
          />
        </Field>
      </form>
    </Drawer>
  );
}
