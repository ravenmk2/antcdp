import { MembersPanel as CollaborationMembersPanel } from "@/features/collaboration/members";
import type { Resource, ResourceKind } from "@/types/collaboration";

export function MembersPanel(props: {
  kind: ResourceKind;
  resource: Resource;
}) {
  return <CollaborationMembersPanel {...props} />;
}
