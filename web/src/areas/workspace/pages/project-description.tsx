import { ResourceDocument } from "@/features/collaboration/resource-detail";
import type { Resource } from "@/types/collaboration";

export function ProjectDescription({ project }: { project: Resource }) {
  return <ResourceDocument source={project.description} kind="projects" />;
}
