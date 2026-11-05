import { Link } from "react-router";
import { AlertTriangle, ArrowRight, GitBranch, Rocket } from "lucide-react";
import { AsyncBoundary, StatusBadge } from "@/components/feedback";
import { Panel } from "@/components/layout";
import { SimpleTable } from "@/components/table";
import { useApiQuery } from "@/hooks/use-api";
import { formatDate } from "@/lib/utils";
import type { Resource } from "@/types/collaboration";
import type { ProjectRelease, Variant, Workspace } from "@/types/delivery";
import { releaseStatus } from "@/domain/labels";
import { ReleaseHero } from "../delivery/release-hero";

export function releaseHref(
  projectId: string,
  variantId: string,
  releaseId: string,
  returnTo?: string,
) {
  const params = new URLSearchParams({
    tab: "releases",
    variant: variantId,
    release: releaseId,
  });
  if (returnTo) params.set("return_to", returnTo);
  return `/projects/${projectId}?${params}`;
}

export function ProjectOverview({ project }: { project: Resource }) {
  const workspace = useApiQuery<Workspace>(
    ["project-workspace", project.id],
    `/projects/${project.id}/workspace`,
  );
  return (
    <AsyncBoundary
      loading={workspace.isPending}
      error={workspace.error}
      onRetry={() => void workspace.refetch()}
    >
      {workspace.data && (
        <div className="grid gap-5">
          {workspace.data.data.releases.items[0] && (
            <ReleaseHero
              release={workspace.data.data.releases.items[0]}
              href={releaseHref(
                project.id,
                workspace.data.data.releases.items[0].variant_id,
                workspace.data.data.releases.items[0].id,
              )}
              meta={`${formatDate(workspace.data.data.releases.items[0].updated_at)} 更新`}
            />
          )}
          <div className="workspace-summary">
            {[
              {
                label: "关联仓库",
                value: workspace.data.data.repository_count,
                detail: "本地快照 · 不代表实时健康",
              },
              {
                label: "活动产品分支",
                value: workspace.data.data.variants.total,
                detail: "标准版与定制版",
              },
              {
                label: "进行中发布",
                value: workspace.data.data.releases.total,
                detail: "草稿、备料与验收",
              },
              {
                label: "结果待核实",
                value: workspace.data.data.attention.total,
                detail: "只读核实，不自动重试",
                attention: workspace.data.data.attention.total > 0,
              },
            ].map((item) => (
              <div className="summary-item" key={item.label}>
                <span>{item.label}</span>
                <strong className={item.attention ? "text-warning" : undefined}>
                  {item.value}
                </strong>
                <small>{item.detail}</small>
              </div>
            ))}
          </div>
          <div className="split-workspace">
            <Panel
              title="活动产品分支"
              action={
                <Link
                  className="link text-xs"
                  to={`/projects/${project.id}/variants`}
                >
                  查看全部 <ArrowRight className="inline size-3" />
                </Link>
              }
              bodyClassName="p-0"
            >
              <ul className="compact-list">
                {workspace.data.data.variants.items.map((variant) => (
                  <VariantRow
                    key={variant.id}
                    project={project}
                    variant={variant}
                  />
                ))}
                {!workspace.data.data.variants.items.length && (
                  <p className="p-5 text-sm text-muted">暂无活动产品分支。</p>
                )}
              </ul>
            </Panel>
            <AttentionPanel project={project} workspace={workspace.data.data} />
          </div>
          <Panel
            title="进行中的发布"
            action={
              <Link
                className="link text-xs"
                to={`/projects/${project.id}?tab=releases`}
              >
                发布管理 <ArrowRight className="inline size-3" />
              </Link>
            }
            bodyClassName="p-0"
          >
            <ReleaseRows
              project={project}
              rows={workspace.data.data.releases.items}
            />
          </Panel>
          {!workspace.data.data.releases.items.length && (
            <Panel title="准备下一次发布">
              <p className="text-sm text-muted">
                可从产品分支创建发布草稿；允许纯材料发布，环境按需配置。
              </p>
              {project.can_manage && (
                <Link
                  className="link mt-3 inline-flex items-center gap-2"
                  to={`/projects/${project.id}?tab=releases&create=1`}
                >
                  <Rocket className="size-4" />
                  创建发布
                </Link>
              )}
            </Panel>
          )}
        </div>
      )}
    </AsyncBoundary>
  );
}

function AttentionPanel({
  project,
  workspace,
}: {
  project: Resource;
  workspace: Workspace;
}) {
  return (
    <Panel
      title="需要关注"
      action={
        workspace.attention.total > 0 ? (
          <StatusBadge tone="warning">
            {workspace.attention.total} 项待核实
          </StatusBadge>
        ) : undefined
      }
      bodyClassName="p-0"
    >
      {workspace.attention.items.length ? (
        <div className="issue-list">
          {workspace.attention.items.map((release) => (
            <article className="issue-item" key={release.id}>
              <span className="issue-icon">
                <AlertTriangle />
              </span>
              <div className="issue-copy">
                <strong>{release.name || release.version_label}</strong>
                <p>
                  存在结果未知的远端操作，请先读取操作记录并核实，不要重发。
                </p>
                <Link
                  className="link mt-2 inline-flex items-center gap-1 text-xs"
                  to={`${releaseHref(project.id, release.variant_id, release.id)}&rview=operations`}
                >
                  查看操作记录 <ArrowRight className="size-3" />
                </Link>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="p-5">
          <p className="text-sm text-muted">当前没有结果未知的发布操作。</p>
          <Link
            className="link mt-3 inline-flex items-center gap-2 text-xs"
            to={`/projects/${project.id}?tab=releases`}
          >
            查看全部交付记录 <ArrowRight className="size-3" />
          </Link>
        </div>
      )}
    </Panel>
  );
}

export function ReleaseRows({
  project,
  rows,
  attention = false,
}: {
  project: Resource;
  rows: ProjectRelease[];
  attention?: boolean;
}) {
  if (!rows.length)
    return <p className="p-6 text-sm text-muted">暂无需要展示的发布。</p>;
  return (
    <SimpleTable
      label="项目发布"
      headers={["发布", "产品分支", "阶段", "更新时间", ""]}
    >
      {rows.map((release) => (
        <tr key={release.id}>
          <td>
            <Link
              className="font-medium text-foreground hover:text-primary"
              to={releaseHref(project.id, release.variant_id, release.id)}
            >
              {release.name || release.version_label}
            </Link>
            <small className="mono mt-1 block text-muted">
              {release.version_label} · {release.tag_name}
            </small>
          </td>
          <td>{release.variant_name}</td>
          <td>
            <StatusBadge
              tone={
                attention || release.needs_attention
                  ? "warning"
                  : release.status === "archived"
                    ? "success"
                    : "info"
              }
            >
              {release.needs_attention
                ? "结果待核实"
                : releaseStatus(release.status)}
            </StatusBadge>
          </td>
          <td className="text-xs text-muted">
            {formatDate(release.updated_at)}
          </td>
          <td>
            <Link
              className="link"
              to={releaseHref(project.id, release.variant_id, release.id)}
              aria-label={`打开 ${release.name || release.version_label}`}
            >
              <ArrowRight className="size-4" />
            </Link>
          </td>
        </tr>
      ))}
    </SimpleTable>
  );
}

function VariantRow({
  project,
  variant,
}: {
  project: Resource;
  variant: Variant;
}) {
  return (
    <li>
      <Link
        className="compact-row"
        to={`/projects/${project.id}/variants/${variant.id}`}
      >
        <GitBranch className="size-5 shrink-0 text-primary" />
        <span className="compact-row-main">
          <strong>{variant.name}</strong>
          <small>
            {variant.main_branch} · {variant.repository_count} 个仓库 ·{" "}
            {variant.environment_count} 个环境
          </small>
        </span>
        <ArrowRight />
      </Link>
    </li>
  );
}

export function HomeReleasePanel({ project }: { project: Resource }) {
  const workspace = useApiQuery<Workspace>(
    ["project-workspace", project.id],
    `/projects/${project.id}/workspace`,
  );
  return (
    <AsyncBoundary
      loading={workspace.isPending}
      error={workspace.error}
      onRetry={() => void workspace.refetch()}
    >
      {workspace.data && (
        <Panel
          title={`${project.name} · 进行中的发布`}
          action={
            <Link
              className="link text-xs"
              to={`/projects/${project.id}?tab=releases`}
            >
              查看发布管理 <ArrowRight className="inline size-3" />
            </Link>
          }
          bodyClassName="p-0"
        >
          <ReleaseRows
            project={project}
            rows={workspace.data.data.releases.items}
          />
        </Panel>
      )}
    </AsyncBoundary>
  );
}

export function HomeAttentionPanel({ project }: { project: Resource }) {
  const workspace = useApiQuery<Workspace>(
    ["project-workspace", project.id],
    `/projects/${project.id}/workspace`,
  );
  if (workspace.isPending || workspace.error || !workspace.data) return null;
  return <AttentionPanel project={project} workspace={workspace.data.data} />;
}
