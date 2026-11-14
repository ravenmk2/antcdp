import { ResourceProfileEditor } from "@/features/collaboration/resource-profile-editor";
import type { Resource, ResourceKind } from "@/types/collaboration";

export function WorkspaceResourceProfileEditor(props: {
  kind: ResourceKind;
  resource: Resource;
  onClose: () => void;
  onSaved: (resource: Resource) => void;
}) {
  return <ResourceProfileEditor {...props} separateDescription />;
}
