import { MembersPanel as CollaborationMembersPanel } from "@/features/collaboration/members";
import type { Resource } from "@/types/collaboration";

export function MembersPanel({ team }: { team: Resource }) {
  return <CollaborationMembersPanel kind="teams" resource={team} />;
}
