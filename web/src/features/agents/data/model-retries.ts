import type { DurableRecord } from "@/types/agent-events";

export type RetryState =
  "waiting" | "running" | "retried" | "recovered" | "ended";

/** Rebuild from durable facts, never infer a request start from a local timer. */
export function modelRetryStates(records: DurableRecord[]) {
  const states = new Map<string, RetryState>();
  const pending = new Map<string, string[]>();
  for (const record of records) {
    const run = record.run_id;
    if (!run) continue;
    if (record.event_type === "run/ended") {
      for (const [key, ids] of pending) {
        if (!key.startsWith(`${run}:`)) continue;
        for (const id of ids)
          if (states.get(id) !== "recovered") states.set(id, "ended");
        pending.delete(key);
      }
    }
    if (
      record.event_type !== "assistant/attempt" &&
      record.event_type !== "assistant/message" &&
      record.event_type !== "model/retry-started"
    )
      continue;
    const key = `${run}:${record.data.step_no}`;
    const ids = pending.get(key) ?? [];
    if (record.event_type === "model/retry-started") {
      const last = ids.at(-1);
      if (last) states.set(last, "running");
    } else if (record.event_type === "assistant/message") {
      for (const id of ids) states.set(id, "recovered");
      pending.delete(key);
    } else {
      for (const id of ids) states.set(id, "retried");
      if (record.data.retry) {
        states.set(record.data.attempt_id, "waiting");
        pending.set(key, [...ids, record.data.attempt_id]);
      }
    }
  }
  return states;
}
