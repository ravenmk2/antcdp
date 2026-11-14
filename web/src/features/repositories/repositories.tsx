import { RepositoryList } from "@/features/repositories/repository-list";
import type { Resource } from "@/types/collaboration";
export function ProjectRepositories({ project }: { project: Resource }) {
  return <RepositoryList project={project} readOnly />;
}
