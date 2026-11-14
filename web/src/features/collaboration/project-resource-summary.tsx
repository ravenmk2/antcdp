import { AsyncBoundary } from "@/components/feedback";
import { SummaryStrip } from "@/components/layout";
import { useApiQuery } from "@/hooks/use-api";
import type { Page, Resource } from "@/types/collaboration";
import type { ProjectRepository } from "@/types/integrations";

export function ProjectResourceSummary({ project }: { project: Resource }) {
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
            value: repos.data?.data.total ?? 0,
            detail: "已保存的仓库关联",
          },
          {
            label: "项目成员",
            value: project.member_count,
            detail: "包含团队继承成员",
          },
          {
            label: "关联团队",
            value: teams.data?.data.length ?? 0,
            detail: "项目协作团队",
          },
        ]}
      />
    </AsyncBoundary>
  );
}
