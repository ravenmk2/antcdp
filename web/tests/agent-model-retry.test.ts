import { expect, it } from "vitest";
import type { DurableRecord, EventType } from "@/types/agent-events";
type Event<T extends EventType> = Extract<DurableRecord, { event_type: T }>;
import { modelRetryStates } from "@/features/agents/data/model-retries";
import { validRecord } from "@/features/agents/data/stream-reducer";

const base = {
  seq: "1",
  schema_version: 1 as const,
  occurred_at: "2026-11-14T00:00:00Z",
  run_id: "20",
};
const failed: Event<"assistant/attempt"> = {
  ...base,
  event_type: "assistant/attempt",
  data: {
    attempt_id: "30",
    model_call_id: "30",
    step_no: 1,
    attempt_no: 1,
    status: "failed",
    content: [],
    partial: false,
    reason_code: "MODEL_CONNECTION_FAILED",
    retry: {
      number: 1,
      max_retries: 5,
      delay_ms: 500,
      retry_at: "2026-11-14T00:00:00.500Z",
      stage: "request",
    },
  },
};
const started: Event<"model/retry-started"> = {
  ...base,
  seq: "2",
  event_type: "model/retry-started",
  data: { attempt_id: "31", step_no: 1, attempt_no: 2 },
};
const success: Event<"assistant/message"> = {
  ...base,
  seq: "3",
  event_type: "assistant/message",
  data: {
    attempt_id: "31",
    model_call_id: "31",
    step_no: 1,
    attempt_no: 2,
    content: [{ type: "text", text: "recovered" }],
    finish_reason: "stop",
  },
};
const ended: Event<"run/ended"> = {
  ...base,
  seq: "4",
  event_type: "run/ended",
  data: {
    run_id: "20",
    status: "cancelled",
    reason_code: "user_stopped",
    finished_at: base.occurred_at,
    usage_completeness: "unknown",
    physical_activity_state: "idle",
  },
};

it("rebuilds retry state from history across waiting, start, success and cancellation", () => {
  expect(validRecord(started)).toBe(true);
  expect(modelRetryStates([failed]).get("30")).toBe("waiting");
  expect(modelRetryStates([failed, started]).get("30")).toBe("running");
  expect(modelRetryStates([failed, started, success, ended]).get("30")).toBe(
    "recovered",
  );
  expect(modelRetryStates([failed, ended]).get("30")).toBe("ended");
  expect(modelRetryStates([failed, started, ended]).get("30")).toBe("ended");
});

it("accepts durable retries with no configured maximum", () => {
  const unlimited = {
    ...failed,
    data: {
      ...failed.data,
      attempt_no: 12,
      retry: { ...failed.data.retry!, number: 12, max_retries: -1 },
    },
  };
  expect(validRecord(unlimited)).toBe(true);
  expect(modelRetryStates([unlimited]).get("30")).toBe("waiting");
});

it("isolates runs and steps and settles all attempts of a recovered step", () => {
  const next: Event<"assistant/attempt"> = {
    ...failed,
    seq: "3",
    data: {
      ...failed.data,
      attempt_id: "31",
      model_call_id: "31",
      attempt_no: 2,
      retry: { ...failed.data.retry!, number: 2 },
    },
  };
  const history: DurableRecord[] = [failed, started, next];
  expect(modelRetryStates(history).get("30")).toBe("retried");
  expect(modelRetryStates(history).get("31")).toBe("waiting");
  expect(
    modelRetryStates([...history, { ...success, run_id: "21" }]).get("31"),
  ).toBe("waiting");
  expect(
    modelRetryStates([
      ...history,
      { ...success, data: { ...success.data, step_no: 2 } },
    ]).get("31"),
  ).toBe("waiting");
  const restored = JSON.parse(
    JSON.stringify([...history, success]),
  ) as DurableRecord[];
  expect([...modelRetryStates(restored).values()]).toEqual([
    "recovered",
    "recovered",
  ]);
});
