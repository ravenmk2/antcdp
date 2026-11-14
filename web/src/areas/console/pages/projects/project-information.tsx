import { ProjectResourceSummary } from "@/features/collaboration/project-resource-summary";
import { ResourceDocument } from "@/features/collaboration/resource-detail";
import type { Resource } from "@/types/collaboration";

export function ProjectInformation({ project }: { project: Resource }) {
  return (
    <div className="grid gap-5">
      <ProjectResourceSummary project={project} />
      <ResourceDocument source={project.description} kind="projects" />
    </div>
  );
}
