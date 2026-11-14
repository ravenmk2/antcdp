import type { DurableRecord } from "@/types/agent-events";
import type { Artifact } from "@/types/agents";

/** The event's owning run is authoritative, including files delivered by a child. */
export function turnDeliverables(records: DurableRecord[]) {
  const runs = new Map<string, Map<string, Artifact>>();
  const deleted = new Set<string>();
  for (const record of records) {
    if (record.event_type === "artifact/deleted")
      deleted.add(record.data.artifact_id);
    if (record.event_type !== "artifact/retained" || !record.run_id) continue;
    const files = runs.get(record.run_id) ?? new Map<string, Artifact>();
    for (const file of record.data.artifacts) files.set(file.id, file);
    runs.set(record.run_id, files);
  }
  return new Map(
    [...runs].map(([run, files]) => [
      run,
      [...files.values()].filter(
        (file) => !file.deleted_at && !deleted.has(file.id),
      ),
    ]),
  );
}
