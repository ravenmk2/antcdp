import { RepositoryList } from "@/features/repositories/repository-list";
import type { Resource } from "@/types/collaboration";
export function AdminProjectRepositories({ project }: { project: Resource }) {
  return <RepositoryList project={project} />;
}
