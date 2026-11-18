import { ArrowUpRight } from "lucide-react";
import { Link } from "react-router";
import { ProjectResourceSummary } from "@/features/collaboration/project-resource-summary";
import type { Resource } from "@/types/collaboration";

export function ProjectOverview({ project }: { project: Resource }) {
  const base = `/projects/${project.id}`;
  const hasDescription = Boolean(project.description.trim());
  return (
    <section className="workspace-project-overview" aria-label="项目资源">
      <h2 className="mb-4 text-lg font-semibold">项目资源</h2>
      <ProjectResourceSummary
        project={project}
        links={{
          repositories: `${base}?tab=repositories`,
          members: `${base}?tab=settings&section=members`,
          teams: `${base}?tab=settings&section=teams`,
        }}
      />
      {(hasDescription || project.can_manage) && (
        <Link
          className="link mt-4 inline-flex items-center gap-1 text-sm"
          to={
            hasDescription
              ? `${base}?tab=description`
              : `${base}/description/edit`
          }
        >
          {hasDescription ? "查看完整介绍" : "填写项目介绍"}
          <ArrowUpRight aria-hidden className="size-4" />
        </Link>
      )}
    </section>
  );
}
