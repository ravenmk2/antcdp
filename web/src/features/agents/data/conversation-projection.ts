import type { DurableRecord } from "@/types/agent-events";
import type { ToolCall, QuestionInteraction } from "@/types/agents";

type Event<K extends DurableRecord["event_type"]> = Extract<
  DurableRecord,
  { event_type: K }
>;
export interface ToolNode {
  id: string;
  call?: Event<"tool/call">;
  result?: Event<"tool/result">;
  reconciliation?: Event<"tool/reconciled">;
  status?: ToolCall["status"];
  question?: QuestionInteraction;
}
export type ConversationNode =
  | { kind: "record"; id: string; record: DurableRecord; settled?: boolean }
  | {
      kind: "process";
      id: string;
      runId: string | null;
      anchor: string;
      tools: ToolNode[];
      entries: (
        | { kind: "tool"; id: string }
        | { kind: "reasoning"; record: Event<"assistant/message"> }
      )[];
    };

// Per mounted conversation, never shared or persisted. Appends touch only the
// affected nodes; paged history and a new baseline deterministically rebuild.
export class ConversationProjector {
  private records: DurableRecord[] = [];
  private nodes: ConversationNode[] = [];
  private tools = new Map<string, number>();
  private currentGroup: number | undefined;
  private runs = new Map<string, number>();
  private interactions = new Map<string, string>();
  project(records: DurableRecord[]): ConversationNode[] {
    if (records === this.records) return this.nodes;
    const append =
      records.length >= this.records.length &&
      (!this.records.length ||
        (records[0] === this.records[0] &&
          records[this.records.length - 1] === this.records.at(-1)));
    let start = this.records.length;
    if (!append) {
      start = 0;
      this.nodes = [];
      this.tools.clear();
      this.currentGroup = undefined;
      this.runs.clear();
      this.interactions.clear();
    } else this.nodes = [...this.nodes];
    for (const record of records.slice(start)) this.apply(record);
    this.records = records;
    return this.nodes;
  }
  private process(record: DurableRecord): number {
    const previous =
      this.currentGroup === undefined
        ? undefined
        : this.nodes[this.currentGroup];
    if (previous?.kind === "process" && previous.runId === record.run_id)
      return this.currentGroup!;
    this.currentGroup = this.nodes.length;
    this.nodes.push({
      kind: "process",
      id: `process:${record.seq}`,
      runId: record.run_id,
      anchor: record.seq,
      tools: [],
      entries: [],
    });
    return this.currentGroup;
  }
  private apply(record: DurableRecord) {
    if (record.event_type === "tool/reconciled") {
      const reconciliation = record;
      const index = this.tools.get(record.data.tool_call_id);
      const node = index === undefined ? undefined : this.nodes[index];
      if (index !== undefined && node?.kind === "process") {
        this.nodes[index] = {
          ...node,
          tools: node.tools.map((tool) =>
            tool.id === reconciliation.data.tool_call_id
              ? { ...tool, reconciliation }
              : tool,
          ),
        };
      }
      // Paged history may not contain the original call yet. Rebuilding after
      // loading it attaches the evidence; never create a separate chat message.
      return;
    }
    if (record.event_type === "assistant/message") {
      const reasoning = record.data.content.filter(
        (block) => block.type === "reasoning" && block.text.trim(),
      );
      if (reasoning.length) {
        const index = this.process(record);
        const node = this.nodes[index];
        if (node.kind === "process")
          this.nodes[index] = {
            ...node,
            entries: [
              ...node.entries,
              {
                kind: "reasoning",
                record: {
                  ...record,
                  data: { ...record.data, content: reasoning },
                },
              },
            ],
          };
      }
      const content = record.data.content.filter(
        (block) =>
          (block.type === "text" && block.text.trim()) ||
          block.type === "file_reference",
      );
      if (!content.length) return;
      record = { ...record, data: { ...record.data, content } };
    }
    if (
      record.event_type === "tool/call" ||
      record.event_type === "tool/result" ||
      record.event_type === "tool/state"
    ) {
      const id = record.data.tool_call_id;
      let index = this.tools.get(id);
      if (index === undefined) {
        index = this.process(record);
        this.tools.set(id, index);
      }
      const node = this.nodes[index];
      if (node.kind !== "process") return;
      const tools = [...node.tools];
      const toolIndex = tools.findIndex((tool) => tool.id === id);
      const tool: ToolNode = { ...tools[toolIndex], id };
      if (record.event_type === "tool/call") {
        tool.call = record;
        tool.status = record.data.status ?? "prepared";
      }
      if (record.event_type === "tool/result") {
        tool.result = record;
        tool.status = record.data.status;
      }
      if (record.event_type === "tool/state" && !tool.result)
        tool.status = record.data.status;
      if (toolIndex < 0) tools.push(tool);
      else tools[toolIndex] = tool;
      this.nodes[index] = {
        ...node,
        tools,
        entries:
          toolIndex < 0
            ? [...node.entries, { kind: "tool", id }]
            : node.entries,
      };
      return;
    }
    if (
      record.event_type === "interaction/asked" &&
      record.data.interaction.tool_call_id
    ) {
      this.currentGroup = undefined;
      const id = record.data.interaction.tool_call_id;
      const interaction = record.data.interaction;
      this.interactions.set(interaction.id, id);
      let index = this.tools.get(id);
      if (index === undefined && interaction.kind === "question") {
        index = this.process(record);
        this.tools.set(id, index);
        const group = this.nodes[index];
        if (group.kind === "process")
          this.nodes[index] = {
            ...group,
            tools: [...group.tools, { id }],
            entries: [...group.entries, { kind: "tool", id }],
          };
      }
      const node = index === undefined ? undefined : this.nodes[index];
      if (index !== undefined && node?.kind === "process")
        this.nodes[index] = {
          ...node,
          tools: node.tools.map((tool) =>
            tool.id === id
              ? {
                  ...tool,
                  status: tool.result ? tool.status : "waiting_approval",
                  question:
                    interaction.kind === "question"
                      ? interaction
                      : tool.question,
                }
              : tool,
          ),
        };
    }
    if (
      record.event_type === "interaction/decided" &&
      record.data.kind === "question"
    ) {
      const id = this.interactions.get(record.data.interaction_id);
      const index = id ? this.tools.get(id) : undefined;
      const node = index === undefined ? undefined : this.nodes[index];
      const decision = record.data;
      if (
        index !== undefined &&
        node?.kind === "process" &&
        [
          "waiting",
          "continued",
          "reply_queued",
          "answered",
          "cancelled",
        ].includes(decision.status)
      )
        this.nodes[index] = {
          ...node,
          tools: node.tools.map((tool) =>
            tool.id === id && tool.question
              ? {
                  ...tool,
                  question: {
                    ...tool.question,
                    status: decision.status as QuestionInteraction["status"],
                    answer: decision.answer ?? tool.question.answer,
                    answered_by: decision.actor_ref,
                    pending_reply_input_id: decision.pending_reply_input_id,
                  },
                }
              : tool,
          ),
        };
    }
    if (record.event_type === "run/settled") {
      const index = this.runs.get(record.data.run_id);
      const node = index === undefined ? undefined : this.nodes[index];
      if (index !== undefined && node?.kind === "record")
        this.nodes[index] = { ...node, settled: true };
      return;
    }
    if (record.event_type === "run/ended")
      this.runs.set(record.data.run_id, this.nodes.length);
    if (
      [
        "input/message",
        "assistant/message",
        "assistant/attempt",
        "run/ended",
        "artifact/retained",
        "compaction/summary",
      ].includes(record.event_type)
    ) {
      const id =
        record.event_type === "assistant/message" ||
        record.event_type === "assistant/attempt"
          ? `attempt:${record.data.attempt_id}`
          : `event:${record.seq}`;
      this.currentGroup = undefined;
      this.nodes.push({ kind: "record", id, record });
    }
  }
}

export interface ConversationTurn {
  id: string;
  firstNode?: string;
  startedAt?: string;
  end?: Event<"run/ended">;
  foldable: boolean;
  attention: boolean;
}

// Replies remain independent roots so final replies can stay outside process folds.
// Missing history never fabricates a start time. Input and result rows stay visible.
export function conversationTurns(
  records: DurableRecord[],
  nodes: ConversationNode[],
): Map<string, ConversationTurn> {
  const turns = new Map<string, ConversationTurn>();
  for (const node of nodes) {
    const runId = node.kind === "process" ? node.runId : node.record.run_id;
    if (!runId) continue;
    const isReply =
      node.kind === "record" &&
      ["assistant/message", "assistant/attempt"].includes(
        node.record.event_type,
      );
    if (node.kind !== "process" && !isReply) continue;
    const turn = turns.get(runId) ?? {
      id: runId,
      firstNode: node.id,
      foldable: true,
      attention: false,
    };
    if (node.kind === "process") {
      turn.attention ||= node.tools.some(toolNeedsAttention);
    }
    turns.set(runId, turn);
  }
  for (const record of records) {
    if (!record.run_id) continue;
    const turn = turns.get(record.run_id) ?? {
      id: record.run_id,
      foldable: false,
      attention: false,
    };
    if (record.event_type === "run/started")
      turn.startedAt = record.occurred_at;
    if (record.event_type === "run/ended") turn.end = record;
    if (
      record.event_type === "run/started" ||
      record.event_type === "run/ended"
    )
      turns.set(record.run_id, turn);
  }
  for (const turn of turns.values()) turn.foldable = Boolean(turn.end);
  return turns;
}

export function toolNeedsAttention(tool: ToolNode): boolean {
  const execution = tool.result?.data.sandbox_execution;
  return (
    (tool.question &&
      ["waiting", "continued"].includes(tool.question.status)) ||
    Boolean(
      tool.status &&
      !["succeeded", "prepared", "running", "dispatching"].includes(
        tool.status,
      ),
    ) ||
    tool.result?.data.outcome.certainty === "unknown" ||
    execution?.state === "running" ||
    execution?.state === "outcome_unknown" ||
    execution?.state === "cancel_requested" ||
    (execution?.state === "completed" && execution.exit_code !== 0)
  );
}
