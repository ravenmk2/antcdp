import { expect, it } from "vitest";
import type { DurableRecord } from "@/types/agent-events";
import { turnIssues } from "@/features/agents/data/turn-issues";
import { ConversationProjector } from "@/features/agents/data/conversation-projection";
import { conversationPresentation } from "@/features/agents/data/conversation-presentation";
import { records, time } from "./fixtures/agents";

type Event<K extends DurableRecord["event_type"]> = Extract<
  DurableRecord,
  { event_type: K }
>;
const failed: Event<"assistant/attempt"> = {
  ...records[0],
  seq: "2",
  event_type: "assistant/attempt",
  data: {
    step_no: 1,
    attempt_id: "a1",
    model_call_id: "c1",
    status: "failed",
    content: [],
    partial: false,
    reason_code: "MODEL_CONNECTION_FAILED",
    retry: {
      number: 1,
      max_retries: 3,
      delay_ms: 500,
      retry_at: time,
      stage: "request",
    },
  },
};
const reply: Event<"assistant/message"> = {
  ...(records[1] as Event<"assistant/message">),
  seq: "6",
  data: { ...(records[1] as Event<"assistant/message">).data, step_no: 1 },
};
const end: Event<"run/ended"> = {
  ...(records[2] as Event<"run/ended">),
  seq: "7",
};
const tool: Event<"tool/result"> = {
  ...records[0],
  seq: "3",
  event_type: "tool/result",
  data: {
    tool_call_id: "t1",
    status: "outcome_unknown",
    executed: null,
    content: [],
    truncated: false,
    outcome: { certainty: "unknown", reason: null },
  },
};
function project(events: DurableRecord[]) {
  return turnIssues(
    events,
    conversationPresentation(new ConversationProjector().project(events), null),
  );
}

it("groups retries by run and step, retaining distinct causes without duplicating the terminal failure", () => {
  const events: DurableRecord[] = [
    failed,
    {
      ...failed,
      seq: "3",
      data: {
        ...failed.data,
        attempt_id: "a2",
        retry: { ...failed.data.retry!, number: 2 },
      },
    },
    {
      ...failed,
      seq: "4",
      data: {
        ...failed.data,
        attempt_id: "a3",
        reason_code: "MODEL_REQUEST_TIMEOUT",
        retry: null,
      },
    },
    {
      ...end,
      data: { ...end.data, status: "failed", reason_code: "EXECUTION_FAILED" },
    },
  ];
  const issues = project(events).get("20")!;
  expect(issues).toHaveLength(1);
  expect(issues[0]).toMatchObject({ state: "failed", count: 3 });
  expect(issues[0].reasons).toHaveLength(2);
  expect(project(JSON.parse(JSON.stringify(events)))).toEqual(project(events));
});

it("uses committed retry start and recovery rather than local timers", () => {
  const start: Event<"model/retry-started"> = {
    ...failed,
    seq: "3",
    event_type: "model/retry-started",
    data: { attempt_id: "a2", step_no: 1, attempt_no: 2 },
  };
  expect(project([failed]).get("20")![0].summary).toContain("等待重试");
  expect(project([failed, start]).get("20")![0].summary).toContain("正在重试");
  expect(project([failed, start, reply, end]).get("20")![0].state).toBe(
    "recovered",
  );
  expect(
    project([failed, { ...reply, run_id: "21" }]).get("20")![0].state,
  ).toBe("pending");
  expect(
    project([failed, { ...reply, data: { ...reply.data, step_no: 2 } }]).get(
      "20",
    )![0].state,
  ).toBe("pending");
});

it("does not call unknown physical work recovered when the run succeeds or settles", () => {
  const settled: Event<"run/settled"> = {
    ...end,
    seq: "8",
    event_type: "run/settled",
    data: { run_id: "20", settled_at: time, physical_activity_state: "none" },
  };
  expect(project([tool, end, settled]).get("20")![0]).toMatchObject({
    toolId: "t1",
    state: "pending",
  });
  const evidence: Event<"tool/reconciled"> = {
    ...end,
    seq: "9",
    event_type: "tool/reconciled",
    data: {
      tool_call_id: "t1",
      observed_status: "succeeded",
      executed: true,
      reason: "physical_execution_ended",
      observed_at: time,
      evidence_summary: "confirmed",
    },
  };
  expect(project([tool, end, settled, evidence]).get("20")![0].state).toBe(
    "recovered",
  );
});

it("keeps a recovered attempt from hiding a later unrelated terminal failure", () => {
  const issues = project([
    failed,
    reply,
    {
      ...end,
      data: {
        ...end.data,
        status: "failed",
        reason_code: "workspace_unavailable",
      },
    },
  ]).get("20")!;
  expect(issues.map((item) => item.state)).toEqual(["failed", "recovered"]);
});

it("keeps historical tool failures quiet after success without inventing a successful tool result", () => {
  const failure = {
    ...tool,
    data: {
      ...tool.data,
      status: "failed" as const,
      outcome: { certainty: "known" as const, reason: "file_missing" },
    },
  };
  expect(project([failure, end]).get("20")![0]).toMatchObject({
    state: "past",
    summary: "工具执行失败",
  });
  expect(failure.data.status).toBe("failed");
});

it("keeps identical errors in separate runs and does not merge legacy attempts without step identities", () => {
  const legacy = { ...failed, data: { ...failed.data, step_no: undefined } };
  const issues = project([
    legacy,
    { ...legacy, seq: "3", data: { ...legacy.data, attempt_id: "a2" } },
    { ...failed, seq: "4", run_id: "21" },
  ]);
  expect(issues.get("20")).toHaveLength(2);
  expect(issues.get("21")).toHaveLength(1);
});
