import type { ActiveAttempt, DurableRecord } from "@/types/agent-events";
import type { ConversationNode, ToolNode } from "./conversation-projection";

type Reply = Extract<
  DurableRecord,
  { event_type: "assistant/message" | "assistant/attempt" }
>;
export type ProcessEntry =
  | { kind: "tool"; id: string }
  | { kind: "assistant"; id: string; record?: Reply; attempt?: ActiveAttempt };
export type PresentedProcess = {
  kind: "process";
  id: string;
  runId: string | null;
  anchor: string;
  tools: ToolNode[];
  entries: ProcessEntry[];
};
export type PresentedNode =
  | Extract<ConversationNode, { kind: "record" }>
  | PresentedProcess
  | { kind: "draft"; id: string; attempt: ActiveAttempt };

// Durable projection stays append-only. This view joins work in event order,
// including the live attempt, without crossing visible inputs or run boundaries.
export function conversationPresentation(
  nodes: ConversationNode[],
  attempt: ActiveAttempt | null,
): PresentedNode[] {
  const result: PresentedNode[] = [];
  let group: PresentedProcess | undefined;
  let pending: Extract<ConversationNode, { kind: "record" }> | undefined;
  const flush = () => {
    if (pending) result.push(pending);
    pending = undefined;
  };
  const process = (runId: string | null, id: string, anchor: string) => {
    if (group && group.runId !== runId) {
      flush();
      group = undefined;
    }
    if (!group) {
      group = { kind: "process", id, runId, anchor, tools: [], entries: [] };
      result.push(group);
    }
    if (pending) {
      const record = pending.record as Reply;
      group.entries.push({
        kind: "assistant",
        id: `message:${record.data.attempt_id}`,
        record,
      });
      pending = undefined;
    }
    return group;
  };
  for (const node of nodes) {
    const runId = node.kind === "process" ? node.runId : node.record.run_id;
    if (group && group.runId !== runId) {
      flush();
      group = undefined;
    }
    if (node.kind === "process") {
      const first = node.entries[0];
      const id =
        first?.kind === "reasoning"
          ? `process:attempt:${first.record.data.attempt_id}`
          : node.id;
      const target = process(runId, id, node.anchor);
      target.tools.push(...node.tools);
      target.entries.push(
        ...node.entries.map((entry): ProcessEntry =>
          entry.kind === "tool"
            ? entry
            : {
                kind: "assistant",
                id: `reasoning:${entry.record.data.attempt_id}`,
                record: entry.record,
              },
        ),
      );
      continue;
    }
    const record = node.record;
    if (record.event_type === "artifact/retained") continue;
    if (record.event_type === "assistant/attempt") {
      if (
        !record.data.retry &&
        !record.data.content.some(
          (block) =>
            block.type === "file_reference" ||
            ((block.type === "text" || block.type === "reasoning") &&
              block.text.trim()),
        )
      )
        continue;
      process(
        runId,
        `process:attempt:${record.data.attempt_id}`,
        record.seq,
      ).entries.push({
        kind: "assistant",
        id: `reasoning:${record.data.attempt_id}`,
        record,
      });
    } else if (record.event_type === "assistant/message") {
      // A text reply remains outside the fold until subsequent work proves it
      // was an intermediate reply. Never move the final text into the process.
      if (pending)
        process(
          runId,
          `process:attempt:${(pending.record as Reply).data.attempt_id}`,
          pending.record.seq,
        );
      pending = node;
    } else {
      flush();
      result.push(node);
      group = undefined;
    }
  }
  if (attempt) {
    const content = attempt.content.filter(
      (block) => block.type === "reasoning" || block.type === "tool_call",
    );
    if (content.length || pending) {
      const target = process(
        attempt.run_id,
        `process:attempt:${attempt.attempt_id}`,
        `attempt:${attempt.attempt_id}`,
      );
      if (content.length)
        target.entries.push({
          kind: "assistant",
          id: `reasoning:${attempt.attempt_id}`,
          attempt: { ...attempt, content },
        });
    }
    const text = attempt.content.filter(
      (block) => block.type !== "reasoning" && block.type !== "tool_call",
    );
    if (text.length || !content.length)
      result.push({
        kind: "draft",
        id: `attempt:${attempt.attempt_id}`,
        attempt: { ...attempt, content: text },
      });
  }
  flush();
  return result;
}
