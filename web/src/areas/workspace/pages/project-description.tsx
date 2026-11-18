import { PageHeader } from "@/components/layout";
import { ResourceDocument } from "@/features/collaboration/resource-detail";
import type { Resource } from "@/types/collaboration";

export function ProjectDescription({ project }: { project: Resource }) {
  return (
    <>
      <PageHeader title="项目介绍" variant="divided" />
      <div className="pt-5">
        <ResourceDocument source={project.description} kind="projects" />
      </div>
    </>
  );
}
