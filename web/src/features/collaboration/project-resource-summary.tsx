import { Link } from "react-router";
import { ChevronRight } from "lucide-react";
import { AsyncBoundary } from "@/components/feedback";
import { SummaryStrip } from "@/components/layout";
import { useApiQuery } from "@/hooks/use-api";
import type { Page, Resource } from "@/types/collaboration";
import type { ProjectRepository } from "@/types/integrations";

export function ProjectResourceSummary({
  project,
  links,
}: {
  project: Resource;
  links?: { repositories: string; members: string; teams: string };
}) {
  function count(value: number, label: string, to?: string) {
    return to ? (
      <Link
        to={to}
        aria-label={`${label}，${value}`}
        className="inline-flex items-center gap-2 rounded-sm hover:text-primary"
      >
        {value}
        <ChevronRight aria-hidden className="size-4 text-muted" />
      </Link>
    ) : (
      value
    );
  }
  const repos = useApiQuery<Page<ProjectRepository>>(
    ["repositories", project.id, "summary"],
    `/projects/${project.id}/repositories?page_size=10`,
  );
  const teams = useApiQuery<Resource[]>(
    ["project-teams", project.id, "summary"],
    `/projects/${project.id}/teams`,
  );
  return (
    <AsyncBoundary
      loading={repos.isPending || teams.isPending}
      error={repos.error || teams.error}
      onRetry={() => {
        void repos.refetch();
        void teams.refetch();
      }}
    >
      <SummaryStrip
        label="项目资源摘要"
        items={[
          {
            label: "关联仓库",
            value: count(
              repos.data?.data.total ?? 0,
              "关联仓库",
              links?.repositories,
            ),
            detail: "已保存的仓库关联",
          },
          {
            label: "项目成员",
            value: count(project.member_count, "项目成员", links?.members),
            detail: "包含团队继承成员",
          },
          {
            label: "关联团队",
            value: count(
              teams.data?.data.length ?? 0,
              "关联团队",
              links?.teams,
            ),
            detail: "项目协作团队",
          },
        ]}
      />
    </AsyncBoundary>
  );
}
