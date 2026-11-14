import { describe, expect, it } from "vitest";
import {
  conversationFrame,
  initialConversationState,
  mergeHistory,
  visibleAttempt,
} from "@/features/agents/data/stream-reducer";
import type {
  EventFrame,
  SnapshotFrame,
  StreamFrame,
} from "@/types/agent-events";

function snapshot(overrides: Partial<SnapshotFrame> = {}): SnapshotFrame {
  return {
    type: "snapshot",
    subscription_id: "s1",
    session_id: "10",
    through_seq: "9007199254740993",
    state: {
      configuration: {
        id: "10",
        agent_id: "1",
        agent_type: "interactive",
        title: "诊断",
        project_context_id: null,
        model_selection: {
          model_binding_id: "1",
          thinking_option_key: "default",
        },
        model_locked_at: "2026-11-09T00:00:00Z",
        archived_at: null,
        version: "v1",
        created_at: "2026-11-09T00:00:00Z",
        updated_at: "2026-11-09T00:00:00Z",
      },
      selection: {
        model_binding_id: "1",
        thinking_option_key: "default",
        model_definition_id: "1",
        provider_label: "DeepSeek",
        model_name: "研发",
        model_id: "chat",
        protocol: "chat_completions",
        thinking_label: "默认",
        effective_parameters: {},
        model_selection_hash: "hash",
        locked: true,
        availability: { available: true, reason: null },
      },
      permissions: {
        read: true,
        submit: true,
        answer: true,
        control: true,
        manage: true,
        approve: true,
      },
      view_state: null,
      run_id: "20",
      run_status: "running",
      queue_paused: false,
      inputs: [],
      input_total: 0,
      inputs_truncated: false,
      interactions: [],
      interaction_total: 0,
      interactions_truncated: false,
    },
    records: [],
    before_seq: "9007199254740994",
    has_more: true,
    stream: { runtime_epoch: "e1", revision: "4", active_attempt: null },
    ...overrides,
  };
}
function live() {
  return conversationFrame(initialConversationState("10", "s1"), snapshot());
}
function assistant(seq = "9007199254740994"): EventFrame {
  return {
    type: "event",
    subscription_id: "s1",
    session_id: "10",
    seq,
    event_type: "assistant/message",
    schema_version: 1,
    occurred_at: "2026-11-09T00:00:00Z",
    run_id: "20",
    data: {
      attempt_id: "30",
      model_call_id: "40",
      content: [{ type: "text", text: "已保存" }],
      finish_reason: "stop",
    },
  };
}
function start(): Extract<StreamFrame, { kind: "start" }> {
  return {
    type: "assistant_stream",
    subscription_id: "s1",
    session_id: "10",
    runtime_epoch: "e1",
    revision: "5",
    attempt_id: "30",
    index: 0,
    kind: "start",
    run_id: "20",
    step: 1,
    content: [],
  };
}
function chunk(): Extract<StreamFrame, { kind: "chunk" }> {
  return {
    ...start(),
    revision: "6",
    index: 1,
    kind: "chunk",
    delta: { type: "text_delta", block_index: 0, text: "草稿" },
  };
}
function end(seq = "9007199254740994"): Extract<StreamFrame, { kind: "end" }> {
  return {
    ...start(),
    revision: "7",
    index: 2,
    kind: "end",
    outcome: { kind: "committed", event_seq: seq },
  };
}

describe("agent session observation", () => {
  it("retains completed reasoning timing through deltas and reconnect snapshots", () => {
    let state = conversationFrame(live(), start());
    state = conversationFrame(state, {
      ...chunk(),
      delta: { type: "reasoning_delta", block_index: 0, text: "思考" },
    });
    state = conversationFrame(state, {
      ...chunk(),
      revision: "7",
      index: 2,
      delta: {
        type: "reasoning_delta",
        block_index: 0,
        text: "",
        duration_ms: 1523,
      },
    });
    expect(state.activeAttempt?.content[0]).toEqual({
      type: "reasoning",
      text: "思考",
      duration_ms: 1523,
    });
    const restored = conversationFrame(
      initialConversationState("10", "s1"),
      snapshot({
        stream: {
          runtime_epoch: "e1",
          revision: "7",
          active_attempt: state.activeAttempt,
        },
      }),
    );
    expect(restored.activeAttempt?.content).toEqual(
      state.activeAttempt?.content,
    );
    const invalid = conversationFrame(state, {
      ...chunk(),
      revision: "8",
      index: 3,
      delta: {
        type: "reasoning_delta",
        block_index: 0,
        text: "",
        duration_ms: -1,
      },
    });
    expect(invalid.phase).toBe("resyncing");
  });
  it("retains the active turn until physical settlement is durable", () => {
    const ended: EventFrame = {
      ...assistant(),
      event_type: "run/ended",
      data: {
        run_id: "20",
        status: "waiting_input",
        reason_code: "interaction_pending",
        finished_at: "2026-11-09T00:00:01Z",
        usage_completeness: "complete",
        physical_activity_state: "settling",
      },
    };
    const draining = conversationFrame(live(), ended);
    expect(draining.snapshot?.run_id).toBe("20");
    expect(draining.snapshot?.run_status).toBe("waiting_input");
    const settled: EventFrame = {
      ...assistant("9007199254740995"),
      event_type: "run/settled",
      data: {
        run_id: "20",
        settled_at: "2026-11-09T00:00:02Z",
        physical_activity_state: "settled",
      },
    };
    const idle = conversationFrame(draining, settled);
    expect(idle.snapshot?.run_id).toBeNull();
    expect(idle.snapshot?.run_status).toBeNull();
  });

  it("requires an opening snapshot, compares exact decimal cursors, and deduplicates events", () => {
    const waiting = initialConversationState("10", "s1");
    expect(conversationFrame(waiting, assistant())).toBe(waiting);
    const state = conversationFrame(live(), assistant());
    expect(state.throughSeq).toBe("9007199254740994");
    expect(state.records).toHaveLength(1);
    expect(conversationFrame(state, assistant())).toBe(state);
    expect(conversationFrame(state, assistant("9007199254740996")).phase).toBe(
      "resyncing",
    );
  });

  it("rejects old subscription/session frames and stops applying data during resync", () => {
    const state = live();
    expect(
      conversationFrame(state, { ...assistant(), subscription_id: "old" }),
    ).toBe(state);
    expect(conversationFrame(state, { ...assistant(), session_id: "11" })).toBe(
      state,
    );
    const gap = conversationFrame(state, assistant("9007199254740995"));
    expect(gap.phase).toBe("resyncing");
    expect(conversationFrame(gap, assistant())).toBe(gap);
    expect(conversationFrame(gap, snapshot()).phase).toBe("live");
  });

  it("replaces a draft with committed content while still accepting its terminal frame", () => {
    let state = conversationFrame(conversationFrame(live(), start()), chunk());
    expect(visibleAttempt(state)?.content).toEqual([
      { type: "text", text: "草稿" },
    ]);
    expect(state.throughSeq).toBe("9007199254740993");
    state = conversationFrame(state, assistant());
    expect(visibleAttempt(state)).toBeNull();
    expect(state.activeAttempt?.next_index).toBe(2);
    state = conversationFrame(state, end());
    expect(state.phase).toBe("live");
    expect(state.activeAttempt).toBeNull();
    expect(state.records).toHaveLength(1);
  });

  it("loads committed bodies absent from a bounded snapshot without a resync loop", () => {
    const base = snapshot({
      through_seq: "9007199254740994",
      stream: {
        runtime_epoch: "e1",
        revision: "6",
        active_attempt: {
          attempt_id: "30",
          run_id: "20",
          step: 1,
          next_index: 2,
          content: [{ type: "text", text: "草稿" }],
        },
      },
    });
    let state = conversationFrame(initialConversationState("10", "s1"), base);
    state = conversationFrame(state, end());
    expect(state.phase).toBe("live");
    expect(state.awaitingHistory).toEqual([
      { attempt_id: "30", event_seq: "9007199254740994" },
    ]);
    state = mergeHistory(state, {
      session_id: "10",
      through_seq: "9007199254740994",
      records: [assistant()],
      before_seq: null,
      has_more: false,
    });
    expect(state.awaitingHistory).toHaveLength(0);
    expect(state.revision).toBe("7");
    expect(state.throughSeq).toBe("9007199254740994");
  });

  it("treats an end ahead of the durable cursor as a real missing-event gap", () => {
    const state = conversationFrame(
      conversationFrame(live(), start()),
      chunk(),
    );
    expect(conversationFrame(state, end()).reason).toBe("sequence_gap");
  });

  it("restores accumulated tool arguments and does not accept renamed or reordered blocks", () => {
    const base = snapshot({
      stream: {
        runtime_epoch: "e1",
        revision: "6",
        active_attempt: {
          attempt_id: "30",
          run_id: "20",
          step: 1,
          next_index: 2,
          content: [
            {
              type: "tool_call",
              draft_call_id: "draft1",
              name: "search",
              arguments_text: '{"q":',
            },
          ],
        },
      },
    });
    const state = conversationFrame(initialConversationState("10", "s1"), base);
    const tool: Extract<StreamFrame, { kind: "chunk" }> = {
      ...chunk(),
      revision: "7",
      index: 2,
      delta: {
        type: "tool_call_delta",
        block_index: 0,
        draft_call_id: "draft1",
        arguments_fragment: '"test"}',
      },
    };
    const merged = conversationFrame(state, tool);
    expect(merged.activeAttempt?.content).toEqual([
      {
        type: "tool_call",
        draft_call_id: "draft1",
        name: "search",
        arguments_text: '{"q":"test"}',
      },
    ]);
    expect(
      conversationFrame(merged, {
        ...tool,
        revision: "8",
        index: 3,
        delta: {
          type: "tool_call_delta",
          block_index: 0,
          draft_call_id: "draft1",
          name: "exec",
        },
      }).phase,
    ).toBe("resyncing");
    expect(
      conversationFrame(state, {
        ...tool,
        delta: { ...tool.delta, block_index: 2 },
      }).phase,
    ).toBe("resyncing");
  });

  it("does not confuse transient revision, attempt index or executor epoch", () => {
    const state = conversationFrame(live(), start());
    expect(conversationFrame(state, { ...chunk(), revision: "7" }).reason).toBe(
      "stream_gap",
    );
    expect(conversationFrame(state, { ...chunk(), index: 0 }).reason).toBe(
      "stream_gap",
    );
    expect(
      conversationFrame(state, { ...chunk(), runtime_epoch: "e2" }).reason,
    ).toBe("epoch_changed");
    expect(conversationFrame(state, start())).toBe(state);
  });

  it("clears revoked content and does not reinstall it from a late snapshot", () => {
    const state = conversationFrame(conversationFrame(live(), assistant()), {
      type: "access_revoked",
      subscription_id: "s1",
      code: "FORBIDDEN",
    });
    expect(state.phase).toBe("closed");
    expect(state.records).toHaveLength(0);
    expect(state.snapshot).toBeNull();
    expect(conversationFrame(state, snapshot())).toBe(state);
  });

  it("fails closed after one unsuccessful schema resync and permits optional additions", () => {
    const unknown = {
      ...assistant(),
      event_type: "future/required",
    } as unknown as EventFrame;
    const first = conversationFrame(live(), unknown);
    expect(first.phase).toBe("resyncing");
    const second = conversationFrame(first, snapshot({ records: [unknown] }));
    expect(second.phase).toBe("closed");
    const extra = { ...assistant(), future_optional: true };
    expect(conversationFrame(live(), extra).phase).toBe("live");
  });

  it("resyncs malformed public input arrays before they reach the renderer", () => {
    const malformed = {
      ...assistant(),
      event_type: "input/message",
      data: {
        content: [{ type: "text", text: "公开测试" }],
        file_refs: null,
        actor_ref: { kind: "user", id: "1" },
      },
    } as unknown as EventFrame;
    const state = conversationFrame(live(), malformed);
    expect(state.phase).toBe("resyncing");
    expect(state.records).toHaveLength(0);
    expect(
      conversationFrame(state, snapshot({ records: [malformed] })).phase,
    ).toBe("closed");
  });
});
