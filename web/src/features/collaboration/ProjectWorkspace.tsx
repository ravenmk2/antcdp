import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router";
import {
  ArrowRight,
  ArrowUpRight,
  ChevronRight,
  FolderGit2,
  GitBranch,
  Plus,
} from "lucide-react";
import type { Resource } from "@/shared/collaboration";
import type { Page, Variant } from "@/shared/delivery";
import { reasonLabels } from "@/shared/delivery";
import { useQuery } from "@/lib/use-query";
import { useDate } from "@/lib/date";
import { useIdentity } from "@/app/identity";
import {
  AsyncState,
  EmptyState,
  RefreshButton,
} from "@/components/platform/feedback";
import { StatusText } from "@/components/platform/status-text";
import { Pagination } from "@/components/platform/pagination";
import { NativeSelect } from "@/components/platform/native-select";
import { FormDialog } from "@/components/platform/form-dialog";
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
import { projectRoot } from "./ProjectNavigation";
import {
  releaseDisplayName,
  releaseStatusLabels,
  safeProjectReleaseReturn,
} from "@/features/delivery/release-labels";

export const releaseLabels = releaseStatusLabels;
export interface ProjectRelease {
  id: string;
  variant_id: string;
  variant_name: string;
  variant_code: string;
  name?: string;
  version_label: string;
  tag_name: string;
  status: string;
  updated_at: string;
  needs_attention: boolean;
}
interface Workspace {
  repository_count: number;
  variants: Page<Variant>;
  releases: Page<ProjectRelease>;
  attention: Page<ProjectRelease>;
}
export function releaseHref(
  root: string,
  release: ProjectRelease,
  returnTo?: string,
) {
  const params = new URLSearchParams({
    variant: release.variant_id,
    vview: "releases",
    release: release.id,
  });
  if (returnTo) params.set("return_to", returnTo);
  return `${root}/variants?${params}`;
}
export function ReleaseState({ release }: { release: ProjectRelease }) {
  return (
    <span className="project-release-state">
      <StatusText
        tone={
          ["reviewing", "accepted", "tagging"].includes(release.status)
            ? "info"
            : "neutral"
        }
      >
        {releaseLabels[release.status] || release.status}
      </StatusText>
      {release.needs_attention && (
        <StatusText tone="warning">结果待核实</StatusText>
      )}
    </span>
  );
}
export function ProjectOverview({
  project,
  admin,
}: {
  project: Resource;
  admin: boolean;
}) {
  const root = projectRoot(project, admin),
    query = useQuery<Workspace>(
      `/projects/${project.id}/workspace`,
      project.etag,
    ),
    date = useDate(),
    location = useLocation(),
    systemAdmin = useIdentity().session.user.role === "admin";
  const data = query.data;
  const writable = project.can_manage && project.status === "active";
  const archived = project.status !== "active";
  const attention = data?.attention.items.slice(0, 3) || [];
  const shownAttention = new Set(attention.map((release) => release.id));
  const ongoing =
    data?.releases.items
      .filter((release) => !shownAttention.has(release.id))
      .slice(0, 6) || [];
  const variants = data?.variants.items.slice(0, 4) || [];
  return (
    <div className="project-overview">
      <header className="project-overview-heading">
        <div>
          <h1 className="text-2xl font-semibold">
            {archived ? "项目记录" : "当前工作"}
          </h1>
          {project.summary && (
            <p className="mt-2 max-w-3xl break-words text-[13px] text-muted-foreground">
              {project.summary}
            </p>
          )}
        </div>
        <RefreshButton loading={query.loading} onClick={query.refresh} />
      </header>
      <AsyncState
        loading={query.loading}
        error={query.error}
        onRetry={query.refresh}
      >
        {data && (
          <div className="project-overview-columns">
            <div className="project-work-sections">
              {archived ? (
                <section className="project-start" aria-label="项目归档记录">
                  <h2 className="text-lg font-semibold">
                    查看项目记录与交付成果
                  </h2>
                  <p className="mt-2 text-[13px] text-muted-foreground">
                    项目已归档，现有资料、发布状态与交付材料可继续查阅。
                  </p>
                  <Button asChild variant="outline" className="mt-5">
                    <Link to={root + "?tab=releases&status=all"}>
                      查看发布记录
                      <ArrowRight />
                    </Link>
                  </Button>
                </section>
              ) : data.attention.total > 0 ? (
                <section className="project-attention" aria-label="需要处理">
                  <div className="project-section-heading">
                    <h2 className="font-semibold">
                      {writable ? "需要处理" : "结果待核实"}{" "}
                      <span className="ml-2 font-normal text-muted-foreground">
                        {data.attention.total}
                      </span>
                    </h2>
                    {data.attention.total > attention.length && (
                      <Link
                        className="text-sm underline underline-offset-4"
                        to={root + "?tab=releases&status=attention"}
                      >
                        查看全部
                      </Link>
                    )}
                  </div>
                  <p className="project-attention-description">
                    {writable
                      ? "上次远端操作结果尚未确认，核实后再继续。"
                      : "可查看发布详情，请项目管理员核实后继续处理。"}
                  </p>
                  {attention.map((release) => (
                    <div className="project-attention-row" key={release.id}>
                      <div className="min-w-0">
                        <Link
                          className="project-release-title hover:underline"
                          to={releaseHref(root, release, root)}
                        >
                          {releaseDisplayName(release)}
                        </Link>
                        <p className="mt-1 break-words text-[13px] text-muted-foreground">
                          {release.variant_name}
                          {releaseDisplayName(release) !==
                            release.version_label && (
                            <> · {release.version_label}</>
                          )}
                        </p>
                        <div className="mt-2">
                          <ReleaseState release={release} />
                        </div>
                      </div>
                      <Button
                        asChild
                        variant={attention.length === 1 ? "default" : "outline"}
                        size="sm"
                      >
                        <Link to={releaseHref(root, release, root)}>
                          {writable ? "查看并核实" : "查看发布详情"}
                          <ArrowRight />
                        </Link>
                      </Button>
                    </div>
                  ))}
                </section>
              ) : data.releases.total === 0 ? (
                <section className="project-start" aria-label="开始使用项目">
                  <h2 className="text-lg font-semibold">
                    {writable ? "准备下一次发布" : "查看项目资源与交付记录"}
                  </h2>
                  <p className="mt-2 max-w-2xl text-[13px] text-muted-foreground">
                    {writable
                      ? "从一个产品变体开始，组织代码变更和交付材料。也可以创建只包含材料的发布；开始发布仍需至少一个仓库及已确认的基线，环境按需配置。"
                      : "当前没有进行中的发布。发布由项目管理员创建，已有交付记录仍可查看。"}
                  </p>
                  <div className="mt-5 flex flex-wrap items-center gap-3">
                    <Button asChild>
                      <Link
                        to={
                          root +
                          (writable
                            ? "?tab=releases&create=1&return_to=" +
                              encodeURIComponent(
                                location.pathname + location.search,
                              )
                            : "?tab=releases&status=all")
                        }
                      >
                        {writable ? "创建发布" : "查看发布记录"}
                        <ArrowRight />
                      </Link>
                    </Button>
                    {systemAdmin && data.repository_count === 0 && (
                      <Button asChild variant="outline">
                        <Link
                          to={`/admin/projects/${project.id}?tab=repositories`}
                        >
                          在控制台关联仓库
                        </Link>
                      </Button>
                    )}
                  </div>
                  {writable && !systemAdmin && data.repository_count === 0 && (
                    <p className="mt-3 text-[13px] text-muted-foreground">
                      当前项目未关联仓库，可先保存草稿和准备材料。请系统管理员在控制台关联仓库后，再核对变体范围与基线。
                    </p>
                  )}
                </section>
              ) : null}
              {data.releases.total > 0 && !archived && (
                <section aria-label="进行中的发布">
                  <div className="project-section-heading">
                    <h2 className="font-semibold">
                      进行中的发布{" "}
                      <span className="ml-2 font-normal text-muted-foreground">
                        {data.releases.total}
                      </span>
                    </h2>
                    <Link
                      className="text-[13px] text-muted-foreground hover:underline"
                      to={root + "?tab=releases"}
                    >
                      全部发布
                      <ArrowUpRight className="ml-1 inline size-3.5" />
                    </Link>
                  </div>
                  {attention.length > 0 && (
                    <p className="mt-3 text-[13px] text-muted-foreground">
                      总数包含需核实的发布，以下为其他进行中的工作。
                    </p>
                  )}
                  {ongoing.map((release) => (
                    <Link
                      className="project-work-row"
                      key={release.id}
                      to={releaseHref(root, release, root)}
                    >
                      <div className="min-w-0">
                        <strong className="project-release-title">
                          {releaseDisplayName(release)}
                        </strong>
                        <p className="mt-1 break-words text-[13px] text-muted-foreground">
                          {release.variant_name}
                          {releaseDisplayName(release) !==
                            release.version_label && (
                            <> · {release.version_label}</>
                          )}{" "}
                          · {date(release.updated_at)}
                        </p>
                      </div>
                      <ReleaseState release={release} />
                    </Link>
                  ))}
                  {!ongoing.length && (
                    <p className="py-5 text-[13px] text-muted-foreground">
                      当前预览中的发布已在上方列出。
                      <Link
                        className="ml-1 underline underline-offset-4"
                        to={root + "?tab=releases"}
                      >
                        查看全部进行中的发布{" "}
                      </Link>
                    </p>
                  )}
                </section>
              )}
            </div>
            <aside className="project-resource-section" aria-label="项目资源">
              <div className="project-section-heading">
                <h2 className="font-semibold">项目资源</h2>
              </div>
              <Link
                className="project-resource-link"
                aria-label={`关联仓库 ${data.repository_count}`}
                to={root + "?tab=repositories"}
              >
                <span>
                  <FolderGit2 />
                  关联仓库
                </span>
                <span>
                  {data.repository_count}
                  <ChevronRight />
                </span>
              </Link>
              <Link
                className="project-resource-link"
                to={root + "/variants"}
                aria-label={`未归档变体 ${data.variants.total}`}
              >
                <span>
                  <GitBranch />
                  未归档变体
                </span>
                <span>
                  {data.variants.total}
                  <ChevronRight />
                </span>
              </Link>
              {variants.length > 0 && (
                <div className="project-variant-preview">
                  {variants.map((variant) => (
                    <Link
                      className="project-variant-link"
                      key={variant.id}
                      to={`${root}/variants?variant=${variant.id}&vview=repositories`}
                    >
                      <span className="break-words font-medium">
                        {variant.name}
                      </span>
                      <span className="break-all text-[13px] text-muted-foreground">
                        {variant.main_branch} · {variant.repository_count}{" "}
                        个仓库
                      </span>
                      {variant.binding_validity !== "valid" && (
                        <span className="text-[13px] text-[var(--warning)]">
                          主干绑定需核对：
                          {reasonLabels[variant.binding_reason] ||
                            variant.binding_reason ||
                            "分支规则已变化"}
                        </span>
                      )}
                    </Link>
                  ))}
                  {data.variants.total > variants.length && (
                    <Link
                      className="mt-3 inline-flex text-[13px] text-muted-foreground hover:underline"
                      to={root + "/variants"}
                    >
                      查看全部变体
                      <ArrowRight className="ml-1 size-4" />
                    </Link>
                  )}
                </div>
              )}
            </aside>
          </div>
        )}
      </AsyncState>
    </div>
  );
}

export function ProjectReleases({
  project,
  admin,
}: {
  project: Resource;
  admin: boolean;
}) {
  const root = projectRoot(project, admin),
    [params, setParams] = useSearchParams(),
    navigate = useNavigate(),
    location = useLocation(),
    date = useDate();
  const [picker, setPicker] = useState<
    { purpose: "create" | "filter"; returnTo?: string } | undefined
  >(() =>
    params.get("create") === "1" &&
    project.can_manage &&
    project.status === "active"
      ? {
          purpose: "create",
          returnTo:
            safeProjectReleaseReturn(params.get("return_to"), root) ||
            safeProjectReleaseReturn(location.pathname + location.search, root),
        }
      : undefined,
  );
  useEffect(() => {
    if (!params.has("create")) return;
    const next = new URLSearchParams(params);
    next.delete("create");
    next.delete("return_to");
    setParams(next, { replace: true });
  }, [params, setParams]);
  const page = Math.max(1, Math.floor(Number(params.get("page")) || 1)),
    size = [10, 20, 50, 100].includes(Number(params.get("page_size")))
      ? Number(params.get("page_size"))
      : 20;
  const q = params.get("q") || "",
    status = params.get("status") || "active",
    variant = params.get("variant_id") || "";
  const query = useQuery<Page<ProjectRelease>>(
    `/projects/${project.id}/releases?page=${page}&page_size=${size}&q=${encodeURIComponent(q)}&status=${encodeURIComponent(status)}${variant ? "&variant_id=" + encodeURIComponent(variant) : ""}`,
  );
  useEffect(() => {
    if (!query.data || query.data.items.length || page <= 1) return;
    const last = Math.max(1, Math.ceil(query.data.total / size));
    if (page <= last) return;
    setParams(
      (old) => {
        const next = new URLSearchParams(old);
        next.set("page", String(last));
        return next;
      },
      { replace: true },
    );
  }, [query.data, page, size, setParams]);
  function filter(values: Record<string, string>) {
    setParams((old) => {
      const next = new URLSearchParams(old);
      next.delete("page");
      for (const [key, value] of Object.entries(values)) {
        if (value) next.set(key, value);
        else next.delete(key);
      }
      return next;
    });
  }
  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">发布</h1>
        </div>
        {project.can_manage && project.status === "active" && (
          <Button
            onClick={() =>
              setPicker({
                purpose: "create",
                returnTo: location.pathname + location.search,
              })
            }
          >
            <Plus />
            创建发布
          </Button>
        )}
      </div>
      <div className="overflow-hidden rounded-xl border bg-card">
        <div className="list-toolbar">
          <form
            className="flex min-w-0 max-w-lg flex-1 gap-2"
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
              defaultValue={q}
              aria-label="搜索项目发布"
              placeholder="名称、版本号或 Tag"
            />
            <Button variant="outline">搜索</Button>
          </form>
          <NativeSelect
            aria-label="发布状态"
            className="w-auto"
            value={status}
            onChange={(e) => filter({ status: e.target.value })}
          >
            <option value="active">进行中</option>
            <option value="all">全部状态</option>
            <option value="attention">结果待核实</option>
            {Object.entries(releaseLabels).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </NativeSelect>
          <Button
            variant="outline"
            onClick={() => setPicker({ purpose: "filter" })}
          >
            {variant ? params.get("variant_name") || "已选变体" : "全部变体"}
          </Button>
          {(q || variant || status !== "active") && (
            <Button
              variant="ghost"
              onClick={() =>
                filter({
                  q: "",
                  variant_id: "",
                  variant_name: "",
                  status: "active",
                })
              }
            >
              清除筛选
            </Button>
          )}
          <RefreshButton loading={query.loading} onClick={query.refresh} />
        </div>
        <AsyncState
          loading={query.loading}
          error={query.error}
          onRetry={query.refresh}
          empty={!query.data?.items.length}
          emptyContent={
            <EmptyState
              title={
                q || variant || status !== "active"
                  ? "没有符合条件的发布"
                  : "暂无进行中的发布"
              }
              description={
                q || variant || status !== "active"
                  ? "调整筛选条件，查看其他发布。"
                  : project.status !== "active"
                    ? "项目已归档，可查看已完成的交付记录。"
                    : project.can_manage
                      ? "从产品变体创建首个发布，或查看已完成的交付记录。"
                      : "发布由项目管理员创建，可查看已有交付记录。"
              }
              action={
                <Button
                  variant="outline"
                  onClick={() =>
                    filter({
                      q: "",
                      variant_id: "",
                      variant_name: "",
                      status: "all",
                    })
                  }
                >
                  查看全部发布
                </Button>
              }
            />
          }
        >
          <Table
            aria-label="项目发布列表"
            className="min-w-[52rem] table-fixed"
          >
            <TableHeader>
              <TableRow>
                {[
                  ["发布", "w-[30%]"],
                  ["产品变体", "w-[18%]"],
                  ["目标 Tag", "w-[22%]"],
                  ["状态", "w-[14%]"],
                  ["最近更新", "w-[16%]"],
                ].map(([label, width]) => (
                  <TableHead key={label} className={width}>
                    {label}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {query.data?.items.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="whitespace-normal">
                    <Link
                      className="break-words font-medium hover:underline"
                      to={releaseHref(
                        root,
                        r,
                        location.pathname + location.search,
                      )}
                    >
                      {releaseDisplayName(r)}
                    </Link>
                    {releaseDisplayName(r) !== r.version_label && (
                      <p className="mt-1 text-[13px] text-muted-foreground">
                        {r.version_label}
                      </p>
                    )}
                  </TableCell>
                  <TableCell className="break-words whitespace-normal">
                    <Link
                      className="hover:underline"
                      to={`${root}/variants?variant=${r.variant_id}`}
                    >
                      {r.variant_name}
                    </Link>
                  </TableCell>
                  <TableCell className="break-all font-mono text-sm whitespace-normal">
                    {r.tag_name}
                  </TableCell>
                  <TableCell>
                    <ReleaseState release={r} />
                  </TableCell>
                  <TableCell className="whitespace-normal text-muted-foreground">
                    {date(r.updated_at)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </AsyncState>
        {query.data && (
          <Pagination
            page={page}
            size={size}
            total={query.data.total}
            onChange={(p, s) =>
              filter({ page: String(p), page_size: String(s) })
            }
          />
        )}
      </div>
      {picker && (
        <ProjectVariantPicker
          projectId={project.id}
          purpose={picker.purpose}
          close={() => {
            setPicker(undefined);
            if (picker.purpose === "create" && picker.returnTo)
              void navigate(picker.returnTo, { replace: true });
          }}
          select={(v) => {
            setPicker(undefined);
            if (picker.purpose === "create")
              navigate(
                `${root}/variants?variant=${v.id}&vview=releases&create=1&return_to=${encodeURIComponent(picker.returnTo || location.pathname + location.search)}`,
              );
            else filter({ variant_id: v.id, variant_name: v.name });
          }}
        />
      )}
    </section>
  );
}

function ProjectVariantPicker({
  projectId,
  purpose,
  select,
  close,
}: {
  projectId: string;
  purpose: "create" | "filter";
  select: (v: Variant) => void;
  close: () => void;
}) {
  const [q, setQ] = useState(""),
    [page, setPage] = useState(1),
    [size, setSize] = useState(20);
  const query = useQuery<Page<Variant>>(
    `/projects/${projectId}/variants?q=${encodeURIComponent(q)}&archived=${purpose === "create" ? "active" : "all"}&page=${page}&page_size=${size}`,
  );
  return (
    <FormDialog
      open
      title={purpose === "create" ? "选择发布所属变体" : "按产品变体筛选"}
      description={
        purpose === "create"
          ? "每次发布归属于一个产品变体。可先保存草稿；开始发布需至少一个范围仓库并确认基线，允许零 MR。"
          : "每次发布归属于一个产品变体。"
      }
      onClose={close}
      footer={
        <Button variant="outline" onClick={close}>
          取消
        </Button>
      }
    >
      <Input
        value={q}
        aria-label="搜索产品变体"
        placeholder="名称或编码"
        onChange={(e) => {
          setQ(e.target.value);
          setPage(1);
        }}
      />
      <AsyncState
        loading={query.loading}
        error={query.error}
        onRetry={query.refresh}
        empty={!query.data?.items.length}
        emptyMessage="没有符合条件的变体。"
      >
        <div className="divide-y">
          {query.data?.items.map((v) => (
            <button
              key={v.id}
              type="button"
              className="flex w-full items-center justify-between gap-3 rounded-md px-2 py-4 text-left hover:bg-muted"
              onClick={() => select(v)}
            >
              <span>
                <span className="block font-medium">{v.name}</span>
                <span className="text-[13px] text-muted-foreground">
                  {v.main_branch} · {v.repository_count} 个仓库
                  {purpose === "create" &&
                    v.repository_count === 0 &&
                    " · 可先建草稿，开始前需补充仓库范围"}
                </span>
              </span>
              <ArrowRight className="size-4" />
            </button>
          ))}
        </div>
      </AsyncState>
      {query.data && (
        <Pagination
          page={page}
          size={size}
          total={query.data.total}
          onChange={(p, s) => {
            setPage(p);
            setSize(s);
          }}
        />
      )}
    </FormDialog>
  );
}
