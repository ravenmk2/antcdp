import { ResourceDescriptionEditor } from "@/features/collaboration/resource-description-editor";

export function ProjectDescriptionEditor() {
  return (
    <ResourceDescriptionEditor
      kind="projects"
      returnTo={(project) => `/admin/projects/${project.id}`}
    />
  );
}
