import type { ConversationSummary, DurableRecord } from "@/types/agent-events";

export function foldConversationSummary(
  previous: ConversationSummary,
  event: DurableRecord,
): ConversationSummary {
  const state = {
    ...previous,
    through_seq: event.seq,
    latest_run: previous.latest_run ? { ...previous.latest_run } : null,
  };
  const run = state.latest_run;
  switch (event.event_type) {
    case "session/title":
    case "session/configured":
      state.title = event.data.configuration.title;
      break;
    case "run/started":
      state.run_count++;
      state.latest_run = {
        id: event.data.run_id,
        status: "running",
        step: 0,
        settled: false,
        model_call_count: 0,
        tool_call_count: 0,
        plan_call_id: "0",
      };
      break;
    case "run/state":
    case "run/ended":
      if (run?.id === event.data.run_id) run.status = event.data.status;
      break;
    case "run/settled":
      if (run?.id === event.data.run_id) run.settled = true;
      break;
    case "assistant/message":
    case "assistant/attempt":
      state.model_call_count++;
      if (run && run.id === event.run_id) {
        run.model_call_count++;
        run.step = Math.max(run.step, event.data.step_no ?? 0);
      }
      break;
    case "tool/call":
      state.tool_call_count++;
      if (run && run.id === event.run_id) {
        run.tool_call_count++;
        if (event.data.tool_key === "update_plan")
          run.plan_call_id = event.data.tool_call_id;
      }
      break;
    case "tool/result":
      if (
        run &&
        run.plan_call_id === event.data.tool_call_id &&
        event.data.status === "succeeded" &&
        !event.data.truncated
      )
        run.plan = event.data.content;
      break;
  }
  return state;
}
