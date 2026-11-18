import { ArrowUpRight } from "lucide-react";
import { Link } from "react-router";
import { ProjectResourceSummary } from "@/features/collaboration/project-resource-summary";
import { ResourceDocument } from "@/features/collaboration/resource-detail";
import type { Resource } from "@/types/collaboration";

export function ProjectOverview({ project }: { project: Resource }) {
  const base = `/projects/${project.id}`;
  const hasDescription = Boolean(project.description.trim());
  return (
    <div className="workspace-project-overview">
      <section aria-label="项目资源">
        <h2 className="mb-4 text-lg font-semibold">项目资源</h2>
        <ProjectResourceSummary
          project={project}
          links={{
            repositories: `${base}?tab=repositories`,
            members: `${base}?tab=settings&section=members`,
            teams: `${base}?tab=settings&section=teams`,
          }}
        />
      </section>
      <section className="border-t border-border pt-6">
        <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">项目介绍</h2>
          {(hasDescription || project.can_manage) && (
            <Link
              className="link inline-flex items-center gap-1 text-sm"
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
        </header>
        <ResourceDocument source={project.description} kind="projects" />
      </section>
    </div>
  );
}
