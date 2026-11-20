import { ProjectResourceSummary } from "@/features/collaboration/project-resource-summary";
import { ResourceDocument } from "@/features/collaboration/resource-detail";
import type { Resource } from "@/types/collaboration";
import styles from "@/areas/console/styles/management.module.css";

export function ProjectInformation({ project }: { project: Resource }) {
  return (
    <div className={styles.projectOverview}>
      <ProjectResourceSummary project={project} />
      <ResourceDocument source={project.description} kind="projects" />
    </div>
  );
}
