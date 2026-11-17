import { expect, it } from "vitest";
import {
  ConversationProjector,
  conversationTurns,
  toolNeedsAttention,
} from "@/features/agents/data/conversation-projection";
import {
  conversationFrame,
  initialConversationState,
} from "@/features/agents/data/stream-reducer";
import type { ActiveAttempt, DurableRecord } from "@/types/agent-events";
import type { ContentBlock } from "@/types/agents";
import { records, snapshot, time, question } from "./fixtures/agents";
import {
  ConversationPresenter,
  conversationPresentation,
} from "@/features/agents/data/conversation-presentation";

it("gives split process groups distinct stable identities when streamed text arrives between reasoning and tools", () => {
  const presenter = new ConversationPresenter();
  const attempt: ActiveAttempt = {
    attempt_id: "30",
    run_id: "20",
    step: 1,
    next_index: 2,
    content: [
      { type: "reasoning", text: "准备执行" },
      {
        type: "tool_call",
        draft_call_id: "draft-0",
        name: "exec_command",
        arguments_text: "",
      },
    ],
  };
  const original = presenter.project([], attempt);
  const split = {
    ...attempt,
    content: [
      ...attempt.content,
      { type: "text" as const, text: "开始检查。" },
    ],
  };
  const groups = presenter
    .project([], split)
    .filter((node) => node.kind === "process");
  expect(groups).toHaveLength(2);
  expect(new Set(groups.map((node) => node.id)).size).toBe(2);
  expect(groups[0].id).toBe(original[0].id);
  expect(
    presenter
      .project([], split)
      .filter((node) => node.kind === "process")
      .map((node) => node.id),
  ).toEqual(groups.map((node) => node.id));
});

const call: Extract<DurableRecord, { event_type: "tool/call" }> = {
  seq: "4",
  schema_version: 1,
  occurred_at: time,
  run_id: "20",
  event_type: "tool/call",
  data: {
    tool_call_id: "50",
    model_call_id: "30",
    step_no: 1,
    call_ordinal: 0,
    provider_call_id: "remote",
    status: "prepared",
    tool_key: "web_search",
    mcp_server_id: null,
    mcp_binding_id: null,
    mcp_tool_name: null,
    arguments: { q: "query" },
    arguments_hash: "hash",
    execution_class: "read_only",
    policy: "allow",
  },
};
const result: Extract<DurableRecord, { event_type: "tool/result" }> = {
  ...call,
  seq: "6",
  event_type: "tool/result",
  data: {
    tool_call_id: "50",
    status: "succeeded",
    executed: true,
    content: [{ type: "text", text: "found" }],
    truncated: false,
    outcome: { certainty: "known", reason: null },
  },
};

it.each(["question", "retry", "artifact"] as const)(
  "keeps %s and subsequent reasoning in one ordered process with a separate final reply",
  (boundary) => {
    const between: DurableRecord =
      boundary === "question"
        ? {
            ...call,
            seq: "7",
            event_type: "interaction/asked",
            data: { interaction: question, child_source_run_id: null },
          }
        : boundary === "retry"
          ? {
              ...call,
              seq: "7",
              event_type: "assistant/attempt",
              data: {
                attempt_id: "failed",
                model_call_id: "30",
                status: "failed",
                partial: true,
                content: [{ type: "reasoning", text: "中断的思考" }],
                reason_code: "MODEL_CONNECTION_FAILED",
              },
            }
          : boundary === "artifact"
            ? {
                ...call,
                seq: "7",
                event_type: "artifact/retained",
                data: { artifacts: [], tool_call_id: "50" },
              }
            : { ...records[1], seq: "7" };
    const reply: DurableRecord = {
      ...call,
      seq: "8",
      event_type: "assistant/message",
      data: {
        attempt_id: "final",
        model_call_id: "31",
        finish_reason: "stop",
        content: [
          { type: "reasoning", text: "最终思考", duration_ms: 2000 },
          { type: "text", text: "最终回复" },
        ],
      },
    };
    const projector = new ConversationProjector();
    const history = [call, result, between, reply];
    const before = conversationPresentation(
      projector.project(history.slice(0, 3)),
      null,
    );
    const view = conversationPresentation(projector.project(history), null);
    expect(view).toEqual(
      conversationPresentation(
        new ConversationProjector().project(history),
        null,
      ),
    );
    expect(view.map((node) => node.kind)).toEqual(["process", "record"]);
    expect(view[0].id).toBe(before[0].id);
    const group = view[0];
    expect(
      group.kind === "process" && group.entries.map((entry) => entry.id),
    ).toEqual([
      "50",
      ...(boundary === "retry" ? ["reasoning:failed"] : []),
      "reasoning:final",
    ]);
    expect(
      view[1].kind === "record" &&
        view[1].record.event_type === "assistant/message" &&
        view[1].record.data.content,
    ).toEqual([{ type: "text", text: "最终回复" }]);
  },
);

it.each(["assistant/message", "assistant/attempt"] as const)(
  "keeps mixed %s bodies between adjacent process groups during streaming and replay",
  (event_type) => {
    const content: ContentBlock[] = [
      { type: "reasoning", text: "中间思考" },
      { type: "text", text: "中间正文" },
      { type: "file_reference", kind: "artifact", id: "90" },
    ];
    const common = {
      ...call,
      seq: "7",
      data: {
        attempt_id: "progress",
        model_call_id: "31",
        content,
      },
    };
    const progress: DurableRecord =
      event_type === "assistant/message"
        ? {
            ...common,
            event_type,
            data: { ...common.data, finish_reason: "tool_calls" },
          }
        : {
            ...common,
            event_type,
            data: {
              ...common.data,
              status: "failed",
              partial: true,
              reason_code: "MODEL_CONNECTION_FAILED",
            },
          };
    const projector = new ConversationProjector();
    const history = [call, result, progress];
    const view = conversationPresentation(projector.project(history), {
      attempt_id: "next",
      run_id: "20",
      step: 2,
      next_index: 1,
      content: [{ type: "reasoning", text: "后续思考" }],
    });
    expect(view.map((node) => node.kind)).toEqual([
      "process",
      "record",
      "process",
    ]);
    const first = view[0];
    expect(
      first.kind === "process" && first.entries.map((entry) => entry.id),
    ).toEqual(["50", "reasoning:progress"]);
    const body = view[1];
    expect(
      body.kind === "record" &&
        (body.record.event_type === "assistant/message" ||
          body.record.event_type === "assistant/attempt") &&
        body.record.data.content,
    ).toEqual(content.filter((block) => block.type !== "reasoning"));
    const next: DurableRecord = {
      ...call,
      seq: "8",
      event_type: "assistant/message",
      data: {
        attempt_id: "next",
        model_call_id: "32",
        finish_reason: "stop",
        content: [
          { type: "reasoning", text: "后续思考" },
          { type: "text", text: "最终正文" },
        ],
      },
    };
    const settled = conversationPresentation(
      projector.project([...history, next]),
      null,
    );
    expect(settled.map((node) => node.kind)).toEqual([
      "process",
      "record",
      "process",
      "record",
    ]);
    expect(settled.slice(0, 3).map((node) => node.id)).toEqual(
      view.map((node) => node.id),
    );
    expect(settled).toEqual(
      conversationPresentation(
        new ConversationProjector().project([...history, next]),
        null,
      ),
    );
  },
);

it("does not join process content across a visible user input or another run", () => {
  const nextCall = {
    ...call,
    seq: "8",
    data: { ...call.data, tool_call_id: "51" },
  };
  const userBoundary = conversationPresentation(
    new ConversationProjector().project([
      call,
      result,
      { ...records[0], seq: "7" },
      nextCall,
    ]),
    null,
  );
  expect(userBoundary.map((node) => node.kind)).toEqual([
    "process",
    "record",
    "process",
  ]);
  const runBoundary = conversationPresentation(
    new ConversationProjector().project([
      call,
      result,
      { ...nextCall, run_id: "21" },
    ]),
    null,
  );
  expect(
    runBoundary
      .filter((node) => node.kind === "process")
      .map((node) => node.runId),
  ).toEqual(["20", "21"]);
});

it("attaches reconciliation to the original tool without rewriting its result or adding a chat row", () => {
  const unknown = {
    ...result,
    data: {
      ...result.data,
      status: "outcome_unknown" as const,
      outcome: { certainty: "unknown" as const, reason: "user_stopped" },
    },
  };
  const evidence: Extract<DurableRecord, { event_type: "tool/reconciled" }> = {
    ...call,
    seq: "9",
    event_type: "tool/reconciled",
    data: {
      tool_call_id: "50",
      observed_status: "cancelled",
      executed: true,
      reason: "physical_execution_ended",
      observed_at: time,
      evidence_summary: "verified_adapter_observation",
    },
  };
  const projector = new ConversationProjector();
  const before = projector.project([call, unknown]);
  const after = projector.project([call, unknown, evidence]);
  expect(after).toHaveLength(before.length);
  const group = after.find((node) => node.kind === "process")!;
  expect(group.tools[0].reconciliation).toBe(evidence);
  expect(group.tools[0].result).toBe(unknown);
  expect(group.tools[0].status).toBe("outcome_unknown");
  expect(before[0]).not.toEqual(after[0]);
  const paged = new ConversationProjector();
  expect(paged.project([evidence])).toEqual([]);
  expect(paged.project([call, unknown, evidence])).toEqual(after);
});

it("joins late question answers to their original tool across append and paged history", () => {
  const asked: DurableRecord = {
    ...call,
    seq: "5",
    event_type: "interaction/asked",
    data: { interaction: question, child_source_run_id: null },
  };
  const decided: DurableRecord = {
    ...call,
    seq: "8",
    event_type: "interaction/decided",
    data: {
      interaction_id: "40",
      kind: "question",
      status: "reply_queued",
      actor_ref: { kind: "user", id: "1" },
      answer: {
        skip: false,
        answers: [{ question_id: "q1", option_ids: ["test"], text: "先检查" }],
      },
      decision: null,
      pending_reply_input_id: "61",
      reason: "late_answer",
    },
  };
  const projector = new ConversationProjector();
  const before = projector.project([call, asked, result]);
  const nodes = projector.project([call, asked, result, decided]);
  const group = nodes.find((node) => node.kind === "process")!;
  expect(group.tools[0].question).toMatchObject({
    status: "reply_queued",
    answer: decided.data.answer,
  });
  expect(
    before[0].kind === "process" && before[0].tools[0].question?.answer,
  ).toBeNull();
  const paged = new ConversationProjector().project([asked, result, decided]);
  const partial = paged.find((node) => node.kind === "process")!;
  expect(partial.tools[0].question?.answer).toEqual(decided.data.answer);
  expect(partial.tools[0].call).toBeUndefined();
});

it("joins tool lifecycle incrementally and preserves unrelated node identities", () => {
  const projector = new ConversationProjector();
  const input = [...records, call];
  const before = projector.project(input);
  const running: DurableRecord = {
    ...call,
    seq: "5",
    event_type: "tool/state",
    data: { tool_call_id: "50", status: "running" },
  };
  const during = projector.project([...input, running]);
  expect(during[0]).toBe(before[0]);
  expect(during[3]).not.toBe(before[3]);
  const final = projector.project([...input, running, result]);
  expect(final).toEqual(
    new ConversationProjector().project([...input, running, result]),
  );
  expect(final.filter((node) => node.kind === "process")).toHaveLength(1);
  const node = final[3];
  expect(node.kind === "process" && node.tools[0].result).toBe(result);
});

it("groups consecutive work across steps, keeps replies outside the turn fold and protects intervening input", () => {
  const thought: DurableRecord = {
    ...call,
    seq: "2",
    event_type: "assistant/message",
    data: {
      attempt_id: "a1",
      model_call_id: "30",
      step_no: 1,
      finish_reason: "tool_calls",
      content: [
        { type: "reasoning", text: "先核对文件" },
        { type: "tool_reference", tool_call_id: "50" },
      ],
    },
  };
  const nextCall = {
    ...call,
    seq: "7",
    data: { ...call.data, step_no: 2, model_call_id: "31", tool_call_id: "51" },
  };
  const nextResult = {
    ...result,
    seq: "8",
    data: { ...result.data, tool_call_id: "51" },
  };
  const reply = { ...records[1], seq: "9" };
  const end = { ...records[2], seq: "10" };
  const history = [
    records[0],
    thought,
    call,
    result,
    nextCall,
    nextResult,
    reply,
    end,
  ];
  const nodes = new ConversationProjector().project(history);
  expect(nodes.filter((node) => node.kind === "process")).toHaveLength(1);
  expect(nodes.filter((node) => node.kind === "record")).toHaveLength(3);
  expect(conversationTurns(history, nodes).get("20")?.foldable).toBe(true);
  const steered = [
    ...history.slice(0, 4),
    { ...records[0], seq: "6" },
    ...history.slice(4),
  ];
  const steeredNodes = new ConversationProjector().project(steered);
  expect(steeredNodes.filter((node) => node.kind === "process")).toHaveLength(
    2,
  );
  expect(conversationTurns(steered, steeredNodes).get("20")?.foldable).toBe(
    true,
  );
  const progress = [
    ...history.slice(0, 4),
    { ...records[1], seq: "6" },
    ...history.slice(4),
  ];
  const progressNodes = new ConversationProjector().project(progress);
  expect(progressNodes.filter((node) => node.kind === "process")).toHaveLength(
    2,
  );
  expect(conversationTurns(progress, progressNodes).get("20")?.foldable).toBe(
    true,
  );
});

it("rebuilds when prepending history and keeps unknown outcomes out of folded success", () => {
  const projector = new ConversationProjector();
  projector.project([result]);
  const full = projector.project([...records, call, result]);
  expect(full).toEqual(
    new ConversationProjector().project([...records, call, result]),
  );
  expect(
    toolNeedsAttention({
      id: "50",
      status: "outcome_unknown",
      result: {
        ...result,
        data: {
          ...result.data,
          status: "outcome_unknown",
          executed: null,
          outcome: { certainty: "unknown", reason: "interrupted" },
        },
      },
    }),
  ).toBe(true);
  expect(toolNeedsAttention({ id: "50", status: "waiting_approval" })).toBe(
    true,
  );
});

it("retains contiguous loaded history across resync but discards a disconnected prefix", () => {
  const initial = conversationFrame(
    initialConversationState("10", "s1"),
    snapshot("s1"),
  );
  const next = {
    ...snapshot("s1"),
    records: [records[2]],
    before_seq: "3",
    has_more: true,
  };
  const restored = conversationFrame(initial, next);
  expect(restored.records).toEqual(records);
  expect(restored.hasMore).toBe(false);
  const gap = { ...next, through_seq: "6", records: [result], before_seq: "6" };
  expect(conversationFrame(initial, gap).records).toEqual([result]);
});

it("allows manual folding of ended turns while retaining attention for unsafe tool outcomes", () => {
  for (const [state, exit_code] of [
    ["completed", 7],
    ["completed", null],
    ["cancel_requested", null],
    ["running", null],
  ] as const) {
    const observed: typeof result = {
      ...result,
      data: {
        ...result.data,
        sandbox_execution: {
          execution_id: "process-1",
          cloud_computer_id: "1",
          command: "exit 7",
          cwd: "/data/workspace",
          background: false,
          state,
          exit_code,
          stdout: "",
          stderr: "",
          truncated: false,
        },
      },
    };
    const history = [records[0], call, observed, { ...records[2], seq: "9" }];
    expect(
      conversationTurns(
        history,
        new ConversationProjector().project(history),
      ).get("20")?.foldable,
    ).toBe(true);
    expect(
      conversationTurns(
        history,
        new ConversationProjector().project(history),
      ).get("20")?.attention,
    ).toBe(true);
  }
});
