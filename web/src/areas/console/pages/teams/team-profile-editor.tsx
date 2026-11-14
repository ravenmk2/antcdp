import { ResourceProfileEditor } from "@/features/collaboration/resource-profile-editor";
import type { Resource } from "@/types/collaboration";

export function TeamProfileEditor({
  team,
  ...props
}: {
  team: Resource;
  onClose: () => void;
  onSaved: (resource: Resource) => void;
}) {
  return (
    <ResourceProfileEditor
      {...props}
      kind="teams"
      resource={team}
      separateDescription
    />
  );
}
