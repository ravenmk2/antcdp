import type { CreationItem } from "@/types/delivery";

export function creationItemCanRetry(
  item: Pick<CreationItem, "status" | "reconciliation">,
) {
  return (
    item.status === "failed" ||
    item.status === "not_started" ||
    (item.status === "unknown" && item.reconciliation !== null)
  );
}

export function reviewNeedsNote(decision: string) {
  return decision === "return";
}

export function canTerminateRelease(status: string, operationStatus?: string) {
  return (
    !["archived", "terminated"].includes(status) &&
    !["running", "unknown"].includes(operationStatus ?? "")
  );
}
