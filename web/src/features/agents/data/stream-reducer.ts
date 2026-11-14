import type { AgentInput, InputSummary, Interaction } from "@/types/agents";
import { foldConversationSummary } from "./conversation-summary";
import type {
  ActiveAttempt,
  DurableRecord,
  EventFrame,
  EventType,
  HistoryPage,
  ServerFrame,
  SnapshotFrame,
  SnapshotState,
  StreamDelta,
  StreamDraftBlock,
  StreamFrame,
} from "@/types/agent-events";

export const eventTypes: readonly EventType[] = [
  "session/configured",
  "session/title",
  "tool/state",
  "session/computer_bound",
  "queue/state",
  "input/accepted",
  "input/updated",
  "input/removed",
  "input/expired",
  "input/cancelled",
  "input/claimed",
  "input/message",
  "run/started",
  "run/state",
  "run/ended",
  "run/settled",
  "assistant/message",
  "assistant/attempt",
  "tool/call",
  "tool/result",
  "tool/reconciled",
  "interaction/asked",
  "interaction/decided",
  "compaction/start",
  "compaction/summary",
  "compaction/end",
  "context/runtime",
  "context/skills",
  "context/authorization",
  "artifact/retained",
  "artifact/deleted",
];
const eventTypeSet = new Set<string>(eventTypes);
export function validSeq(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^(0|[1-9]\d*)$/.test(value) &&
    value.length <= 20
  );
}
export function validRecord(record: DurableRecord) {
  if (
    !record ||
    !validSeq(record.seq) ||
    record.schema_version !== 1 ||
    !eventTypeSet.has(record.event_type) ||
    !record.data ||
    typeof record.data !== "object"
  )
    return false;
  if (
    record.event_type === "session/title" &&
    (!record.data.configuration ||
      typeof record.data.configuration.title !== "string" ||
      typeof record.data.configuration.version !== "string" ||
      !["fallback", "model", "user"].includes(record.data.source) ||
      !validSeq(record.data.source_event_seq) ||
      !(
        record.data.model_call_id === null ||
        validSeq(record.data.model_call_id)
      ))
  )
    return false;
  if (
    record.event_type === "tool/state" &&
    (!validSeq(record.data.tool_call_id) ||
      ![
        "prepared",
        "dispatching",
        "running",
        "waiting_approval",
        "succeeded",
        "failed",
        "blocked",
        "cancelled",
        "outcome_unknown",
      ].includes(record.data.status))
  )
    return false;
  if (record.event_type === "input/message") {
    const input = record.data;
    if (
      !Array.isArray(input.content) ||
      !input.content.every(
        (block) => block?.type === "text" && typeof block.text === "string",
      ) ||
      !Array.isArray(input.file_refs) ||
      !input.file_refs.every(
        (ref) =>
          ref &&
          ["attachment", "artifact"].includes(ref.kind) &&
          typeof ref.id === "string",
      ) ||
      !input.actor_ref ||
      (input.question_answer &&
        (!Array.isArray(input.question_answer.answers) ||
          !input.question_answer.answers.every(
            (answer) =>
              answer &&
              Array.isArray(answer.option_ids) &&
              (answer.text === null || typeof answer.text === "string"),
          )))
    )
      return false;
  }
  if (
    (record.event_type === "input/accepted" ||
      record.event_type === "input/updated") &&
    (!record.data.input || !Array.isArray(record.data.input.content))
  )
    return false;
  if (
    record.event_type === "artifact/retained" &&
    !Array.isArray(record.data.artifacts)
  )
    return false;
  if (
    record.event_type === "tool/result" &&
    (!record.data.outcome ||
      !["pending", "known", "unknown"].includes(record.data.outcome.certainty))
  )
    return false;
  if (
    record.event_type === "assistant/message" ||
    record.event_type === "assistant/attempt" ||
    record.event_type === "tool/result" ||
    record.event_type === "compaction/summary"
  ) {
    if (
      record.event_type === "tool/result" &&
      record.data.sandbox_execution !== undefined
    ) {
      const execution = record.data.sandbox_execution;
      if (
        !execution ||
        typeof execution !== "object" ||
        typeof execution.execution_id !== "string" ||
        typeof execution.cloud_computer_id !== "string" ||
        typeof execution.command !== "string" ||
        typeof execution.cwd !== "string" ||
        typeof execution.background !== "boolean" ||
        ![
          "running",
          "completed",
          "outcome_unknown",
          "cancel_requested",
        ].includes(execution.state) ||
        !(
          execution.exit_code === null || Number.isInteger(execution.exit_code)
        ) ||
        typeof execution.stdout !== "string" ||
        typeof execution.stderr !== "string" ||
        typeof execution.truncated !== "boolean"
      )
        return false;
    }
    if (!Array.isArray(record.data.content)) return false;
    for (const block of record.data.content) {
      if (!block || typeof block !== "object") return false;
      switch (block.type) {
        case "text":
        case "reasoning":
          if (
            typeof block.text !== "string" ||
            !validDuration(block.duration_ms)
          )
            return false;
          break;
        case "tool_reference":
          if (typeof block.tool_call_id !== "string") return false;
          break;
        case "file_reference":
          if (
            !["attachment", "artifact"].includes(block.kind) ||
            typeof block.id !== "string"
          )
            return false;
          break;
        default:
          return false;
      }
    }
  }
  return true;
}
export interface ConversationStreamState {
  sessionId: string;
  subscriptionId: string;
  phase: "subscribing" | "live" | "resyncing" | "closed";
  throughSeq: string;
  epoch: string | null;
  revision: string;
  snapshot: SnapshotState | null;
  records: DurableRecord[];
  beforeSeq: string | null;
  hasMore: boolean;
  activeAttempt: ActiveAttempt | null;
  awaitingHistory: { attempt_id: string; event_seq: string }[];
  reason: string | null;
  schemaFailures: number;
  baselineGeneration: number;
}
export function initialConversationState(
  sessionId: string,
  subscriptionId: string,
): ConversationStreamState {
  return {
    sessionId,
    subscriptionId,
    phase: "subscribing",
    throughSeq: "0",
    epoch: null,
    revision: "0",
    snapshot: null,
    records: [],
    beforeSeq: null,
    hasMore: false,
    activeAttempt: null,
    awaitingHistory: [],
    reason: null,
    schemaFailures: 0,
    baselineGeneration: 0,
  };
}
function gap(
  state: ConversationStreamState,
  reason: string,
): ConversationStreamState {
  if (state.phase === "closed") return state;
  const failures =
    state.schemaFailures + (reason === "schema_unsupported" ? 1 : 0);
  return {
    ...state,
    phase:
      failures > 1 ||
      (state.phase === "resyncing" && reason !== "schema_unsupported")
        ? "closed"
        : "resyncing",
    reason,
    schemaFailures: failures,
  };
}
function validDuration(value: number | undefined) {
  return value === undefined || (Number.isSafeInteger(value) && value >= 0);
}
function validDraft(block: StreamDraftBlock) {
  return (
    block &&
    (((block.type === "text" || block.type === "reasoning") &&
      typeof block.text === "string" &&
      validDuration(block.duration_ms)) ||
      (block.type === "tool_call" &&
        typeof block.draft_call_id === "string" &&
        (block.name === null || typeof block.name === "string") &&
        typeof block.arguments_text === "string"))
  );
}
function installSnapshot(
  state: ConversationStreamState,
  frame: SnapshotFrame,
): ConversationStreamState {
  if (
    !validSeq(frame.through_seq) ||
    !validSeq(frame.stream?.revision) ||
    typeof frame.stream.runtime_epoch !== "string" ||
    !frame.state ||
    !Array.isArray(frame.state.inputs) ||
    !Array.isArray(frame.state.interactions) ||
    !Array.isArray(frame.records)
  )
    return gap(state, "schema_unsupported");
  const summary = frame.state.conversation;
  if (summary !== undefined) {
    const count = (n: number) => Number.isSafeInteger(n) && n >= 0;
    const run = summary?.latest_run;
    if (
      !summary ||
      summary.version !== 1 ||
      summary.through_seq !== frame.through_seq ||
      typeof summary.title !== "string" ||
      !count(summary.run_count) ||
      !count(summary.model_call_count) ||
      !count(summary.tool_call_count) ||
      (run !== null &&
        (!run ||
          !validSeq(run.id) ||
          !count(run.step) ||
          !count(run.model_call_count) ||
          !count(run.tool_call_count) ||
          typeof run.status !== "string" ||
          typeof run.settled !== "boolean" ||
          (run.plan !== undefined && !Array.isArray(run.plan))))
    )
      return gap(state, "schema_unsupported");
  }
  let previous = -1n;
  for (const record of frame.records) {
    if (!validRecord(record)) return gap(state, "schema_unsupported");
    const seq = BigInt(record.seq);
    if (
      seq > BigInt(frame.through_seq) ||
      seq <= previous ||
      (previous >= 0n && seq !== previous + 1n)
    )
      return gap(state, "sequence_gap");
    previous = seq;
  }
  const attempt = frame.stream.active_attempt;
  if (
    attempt &&
    (!Number.isSafeInteger(attempt.next_index) ||
      attempt.next_index < 1 ||
      !Array.isArray(attempt.content) ||
      !attempt.content.every(validDraft))
  )
    return gap(state, "schema_unsupported");
  const first = frame.records[0];
  const last = state.records.at(-1);
  const prefix =
    first &&
    last &&
    BigInt(frame.through_seq) >= BigInt(state.throughSeq) &&
    BigInt(first.seq) <= BigInt(last.seq) + 1n
      ? state.records.filter((record) => BigInt(record.seq) < BigInt(first.seq))
      : [];
  return {
    ...state,
    phase: "live",
    throughSeq: frame.through_seq,
    epoch: frame.stream.runtime_epoch,
    revision: frame.stream.revision,
    snapshot: frame.state,
    records: prefix.length ? [...prefix, ...frame.records] : frame.records,
    beforeSeq: prefix.length ? state.beforeSeq : frame.before_seq,
    hasMore: prefix.length ? state.hasMore : frame.has_more,
    activeAttempt: attempt,
    awaitingHistory: [],
    reason: null,
    baselineGeneration: state.baselineGeneration + 1,
  };
}
function inputSummary(input: AgentInput): InputSummary {
  return {
    id: input.id,
    kind: input.kind,
    delivery: input.delivery,
    preview: input.content
      .map((block) => block.text)
      .join("\n")
      .slice(0, 256),
    actor_ref: input.actor_ref,
    queue_deadline_at: input.queue_deadline_at,
    version: input.version,
  };
}
function updateSnapshot(
  state: SnapshotState,
  event: DurableRecord,
): SnapshotState {
  switch (event.event_type) {
    case "session/configured":
    case "session/title":
      return { ...state, configuration: event.data.configuration };
    case "queue/state":
      return { ...state, queue_paused: event.data.queue_paused };
    case "input/accepted":
    case "input/updated": {
      const input = event.data.input;
      const exists = state.inputs.some((item) => item.id === input.id);
      if (input.state !== "pending") return state;
      return {
        ...state,
        inputs: exists
          ? state.inputs.map((item) =>
              item.id === input.id ? inputSummary(input) : item,
            )
          : [...state.inputs, inputSummary(input)],
        input_total:
          state.input_total +
          (!exists && event.event_type === "input/accepted" ? 1 : 0),
      };
    }
    case "input/removed":
    case "input/expired":
    case "input/cancelled":
    case "input/claimed":
      return {
        ...state,
        inputs: state.inputs.filter((item) => item.id !== event.data.input_id),
        input_total: Math.max(0, state.input_total - 1),
      };
    case "run/started":
      return { ...state, run_id: event.data.run_id, run_status: "running" };
    case "run/state":
      return state.run_id === event.data.run_id
        ? { ...state, run_status: event.data.status }
        : state;
    case "run/ended":
      return state.run_id === event.data.run_id
        ? { ...state, run_status: event.data.status }
        : state;
    case "run/settled":
      return state.run_id === event.data.run_id
        ? { ...state, run_id: null, run_status: null }
        : state;
    case "interaction/asked": {
      const exists = state.interactions.some(
        (item) => item.id === event.data.interaction.id,
      );
      return {
        ...state,
        interactions: [
          ...state.interactions.filter(
            (item) => item.id !== event.data.interaction.id,
          ),
          event.data.interaction,
        ],
        interaction_total: state.interaction_total + (exists ? 0 : 1),
      };
    }
    case "interaction/decided": {
      const { data } = event;
      const unresolved =
        data.kind === "question"
          ? ["waiting", "continued", "reply_queued"].includes(data.status)
          : data.status === "pending";
      const old = state.interactions.find(
        (item) => item.id === data.interaction_id,
      );
      const interactions = state.interactions.flatMap((item): Interaction[] => {
        if (item.id !== data.interaction_id) return [item];
        if (!unresolved) return [];
        if (item.kind === "question" && data.kind === "question")
          return [
            {
              ...item,
              status: data.status as typeof item.status,
              answer: data.answer,
              answered_by: data.actor_ref,
              pending_reply_input_id: data.pending_reply_input_id,
            },
          ];
        return [item];
      });
      return {
        ...state,
        interactions,
        interaction_total: Math.max(
          0,
          state.interaction_total - (old && !unresolved ? 1 : 0),
        ),
      };
    }
    default:
      return state;
  }
}
function applyEvent(
  state: ConversationStreamState,
  frame: EventFrame,
): ConversationStreamState {
  if (!validRecord(frame)) return gap(state, "schema_unsupported");
  const seq = BigInt(frame.seq),
    current = BigInt(state.throughSeq);
  if (seq <= current) return state;
  if (seq !== current + 1n) return gap(state, "sequence_gap");
  return {
    ...state,
    throughSeq: frame.seq,
    records: [...state.records, frame],
    snapshot: state.snapshot
      ? {
          ...updateSnapshot(state.snapshot, frame),
          conversation: state.snapshot.conversation
            ? foldConversationSummary(state.snapshot.conversation, frame)
            : undefined,
        }
      : null,
    awaitingHistory: state.awaitingHistory.filter(
      (item) => item.event_seq !== frame.seq,
    ),
  };
}
function applyDelta(
  blocks: StreamDraftBlock[],
  delta: StreamDelta,
): StreamDraftBlock[] | null {
  if (
    !delta ||
    !Number.isSafeInteger(delta.block_index) ||
    delta.block_index < 0 ||
    delta.block_index > blocks.length
  )
    return null;
  const current = blocks[delta.block_index];
  let next: StreamDraftBlock;
  if (delta.type === "text_delta" || delta.type === "reasoning_delta") {
    const type = delta.type === "text_delta" ? "text" : "reasoning";
    if (
      typeof delta.text !== "string" ||
      !validDuration(delta.duration_ms) ||
      (current && current.type !== type)
    )
      return null;
    next = {
      type,
      text: (current && "text" in current ? current.text : "") + delta.text,
      ...(delta.duration_ms !== undefined
        ? { duration_ms: delta.duration_ms }
        : {}),
    };
  } else if (delta.type === "tool_call_delta") {
    if (
      typeof delta.draft_call_id !== "string" ||
      (delta.name !== undefined && typeof delta.name !== "string") ||
      (delta.arguments_fragment !== undefined &&
        typeof delta.arguments_fragment !== "string")
    )
      return null;
    if (
      current &&
      (current.type !== "tool_call" ||
        current.draft_call_id !== delta.draft_call_id ||
        (current.name && delta.name && current.name !== delta.name))
    )
      return null;
    const tool = current?.type === "tool_call" ? current : null;
    next = {
      type: "tool_call",
      draft_call_id: delta.draft_call_id,
      name: tool?.name ?? delta.name ?? null,
      arguments_text:
        (tool?.arguments_text ?? "") + (delta.arguments_fragment ?? ""),
    };
  } else return null;
  const result = [...blocks];
  result[delta.block_index] = next;
  return result;
}
function applyStream(
  state: ConversationStreamState,
  frame: StreamFrame,
): ConversationStreamState {
  if (!validSeq(frame.revision)) return gap(state, "schema_unsupported");
  if (frame.runtime_epoch !== state.epoch) return gap(state, "epoch_changed");
  if (BigInt(frame.revision) <= BigInt(state.revision)) return state;
  if (BigInt(frame.revision) !== BigInt(state.revision) + 1n)
    return gap(state, "stream_gap");
  if (!Number.isSafeInteger(frame.index) || frame.index < 0)
    return gap(state, "stream_gap");
  if (frame.kind === "start") {
    if (frame.index !== 0 || state.activeAttempt)
      return gap(state, "stream_gap");
    return {
      ...state,
      revision: frame.revision,
      activeAttempt: {
        attempt_id: frame.attempt_id,
        run_id: frame.run_id,
        step: frame.step,
        next_index: 1,
        content: [],
      },
    };
  }
  const attempt = state.activeAttempt;
  if (
    !attempt ||
    attempt.attempt_id !== frame.attempt_id ||
    attempt.next_index !== frame.index
  )
    return gap(state, "stream_gap");
  if (frame.kind === "chunk") {
    const content = applyDelta(attempt.content, frame.delta);
    if (!content) return gap(state, "stream_gap");
    return {
      ...state,
      revision: frame.revision,
      activeAttempt: { ...attempt, next_index: frame.index + 1, content },
    };
  }
  if (frame.kind !== "end" || !frame.outcome)
    return gap(state, "schema_unsupported");
  if (frame.outcome.kind === "abandoned")
    return { ...state, revision: frame.revision, activeAttempt: null };
  if (frame.outcome.kind !== "committed" || !validSeq(frame.outcome.event_seq))
    return gap(state, "schema_unsupported");
  if (BigInt(frame.outcome.event_seq) > BigInt(state.throughSeq))
    return gap(state, "sequence_gap");
  const eventSeq = frame.outcome.event_seq;
  const existing = state.records.some((item) => item.seq === eventSeq);
  return {
    ...state,
    revision: frame.revision,
    activeAttempt: null,
    awaitingHistory: existing
      ? state.awaitingHistory
      : [
          ...state.awaitingHistory,
          { attempt_id: frame.attempt_id, event_seq: frame.outcome.event_seq },
        ],
  };
}
export function conversationFrame(
  state: ConversationStreamState,
  frame: ServerFrame,
): ConversationStreamState {
  if (
    !("subscription_id" in frame) ||
    frame.subscription_id !== state.subscriptionId ||
    ("session_id" in frame && frame.session_id !== state.sessionId) ||
    state.phase === "closed"
  )
    return state;
  if (frame.type === "access_revoked")
    return {
      ...initialConversationState(state.sessionId, state.subscriptionId),
      phase: "closed",
      reason: "access_revoked",
    };
  if (frame.type === "error")
    return { ...state, phase: "closed", reason: frame.code };
  if (frame.type === "resync_required")
    return state.phase === "resyncing" ? state : gap(state, frame.reason);
  if (frame.type === "snapshot") return installSnapshot(state, frame);
  if (state.phase !== "live") return state;
  if (frame.type === "event") return applyEvent(state, frame);
  if (frame.type === "assistant_stream") return applyStream(state, frame);
  return state;
}
export function mergeHistory(
  state: ConversationStreamState,
  page: HistoryPage,
): ConversationStreamState {
  if (
    state.phase === "closed" ||
    page.session_id !== state.sessionId ||
    !validSeq(page.through_seq) ||
    BigInt(page.through_seq) > BigInt(state.throughSeq)
  )
    return state;
  if (!page.records.every(validRecord)) return gap(state, "schema_unsupported");
  const records = new Map(state.records.map((record) => [record.seq, record]));
  for (const record of page.records) {
    if (BigInt(record.seq) > BigInt(page.through_seq))
      return gap(state, "sequence_gap");
    if (!records.has(record.seq)) records.set(record.seq, record);
  }
  return {
    ...state,
    records: Array.from(records.values()).sort((a, b) =>
      BigInt(a.seq) < BigInt(b.seq) ? -1 : 1,
    ),
    beforeSeq: page.before_seq,
    hasMore: page.has_more,
    awaitingHistory: state.awaitingHistory.filter(
      (item) => !records.has(item.event_seq),
    ),
  };
}
export function visibleAttempt(state: ConversationStreamState) {
  if (!state.activeAttempt) return null;
  const id = state.activeAttempt.attempt_id;
  return state.records.some(
    (record) =>
      (record.event_type === "assistant/message" ||
        record.event_type === "assistant/attempt") &&
      record.data.attempt_id === id,
  )
    ? null
    : state.activeAttempt;
}
