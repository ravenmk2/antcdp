import { ResourceDescriptionEditor } from "@/features/collaboration/resource-description-editor";

export function TeamDescriptionEditor() {
  return (
    <ResourceDescriptionEditor
      kind="teams"
      returnTo={(team) => `/admin/teams/${team.id}`}
    />
  );
}
