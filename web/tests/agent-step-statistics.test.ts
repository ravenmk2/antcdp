import { expect, it } from "vitest";
import { foldConversationSummary } from "@/features/agents/data/conversation-summary";
import { validRecord } from "@/features/agents/data/stream-reducer";
import { ConversationProjector } from "@/features/agents/data/conversation-projection";
import { conversationPresentation } from "@/features/agents/data/conversation-presentation";
import type { ConversationSummary, DurableRecord } from "@/types/agent-events";
import { records, time } from "./fixtures/agents";

function step(
  kind: "step/started" | "step/ended",
  number: number,
  seq = "4",
): DurableRecord {
  return {
    seq,
    schema_version: 1,
    occurred_at: time,
    run_id: "20",
    event_type: kind,
    data: { run_id: "20", step_no: number },
  };
}

it("counts step endings independently of attempts and preserves the counter on repeated step facts", () => {
  let state: ConversationSummary = {
    version: 3,
    through_seq: "0",
    title: "",
    run_count: 1,
    model_call_count: 0,
    tool_call_count: 0,
    latest_run: {
      id: "20",
      status: "running",
      step: 0,
      completed_steps: 0,
      settled: false,
      model_call_count: 0,
      tool_call_count: 0,
      todos: null,
    },
  };
  state = foldConversationSummary(state, step("step/started", 1));
  expect(state.latest_run).toMatchObject({ step: 1, completed_steps: 0 });
  state = foldConversationSummary(state, records[1]);
  expect(state.latest_run?.completed_steps).toBe(0);
  state = foldConversationSummary(state, step("step/ended", 1));
  state = foldConversationSummary(state, step("step/ended", 1));
  state = foldConversationSummary(state, step("step/started", 2));
  expect(state.latest_run).toMatchObject({ step: 2, completed_steps: 1 });
  state = foldConversationSummary(state, records[2]);
  expect(state.latest_run?.completed_steps).toBe(2);
});

it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, NaN])(
  "rejects malformed step ordinal %s",
  (number) => {
    expect(validRecord(step("step/ended", number))).toBe(false);
  },
);

it("accepts step events without introducing chat content or splitting a process group", () => {
  const ended = step("step/ended", 1);
  expect(validRecord(ended)).toBe(true);
  expect(validRecord({ ...ended, run_id: "21" })).toBe(false);
  const reasoning: DurableRecord = {
    ...records[1],
    seq: "2",
    event_type: "assistant/message",
    data: {
      attempt_id: "a",
      model_call_id: "30",
      finish_reason: "stop",
      content: [
        { type: "reasoning", text: "思考" },
        { type: "text", text: "正文" },
      ],
    },
  };
  const project = (history: DurableRecord[]) =>
    conversationPresentation(
      new ConversationProjector().project(history),
      null,
    );
  expect(
    project([
      step("step/started", 1, "1"),
      reasoning,
      step("step/ended", 1, "3"),
    ]),
  ).toEqual(project([reasoning]));
});
