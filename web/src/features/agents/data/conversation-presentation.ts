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

/** Preserve mounted process controls when pagination reveals an earlier start. */
export class ConversationPresenter {
  private identities = new Map<string, string>();

  project(
    nodes: ConversationNode[],
    attempt: ActiveAttempt | null,
  ): PresentedNode[] {
    return conversationPresentation(nodes, attempt).map((node) => {
      if (node.kind !== "process") return node;
      const members = node.entries.map((entry) => `${node.runId}:${entry.id}`);
      const id =
        members.map((member) => this.identities.get(member)).find(Boolean) ??
        node.id;
      for (const member of members) this.identities.set(member, id);
      return id === node.id ? node : { ...node, id };
    });
  }
}

// Only adjacent reasoning and tools share a process fold. Every reply body is
// a boundary, including intermediate and interrupted replies. The turn fold
// independently hides intermediate replies while preserving the final body.
export function conversationPresentation(
  nodes: ConversationNode[],
  attempt: ActiveAttempt | null,
): PresentedNode[] {
  const result: PresentedNode[] = [];
  let group: PresentedProcess | undefined;
  const process = (runId: string | null, id: string, anchor: string) => {
    if (group && group.runId !== runId) {
      group = undefined;
    }
    if (!group) {
      group = { kind: "process", id, runId, anchor, tools: [], entries: [] };
      result.push(group);
    }
    return group;
  };
  for (const node of nodes) {
    const runId = node.kind === "process" ? node.runId : node.record.run_id;
    if (group && group.runId !== runId) {
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
        !record.data.content.some(
          (block) =>
            block.type === "file_reference" ||
            ((block.type === "text" || block.type === "reasoning") &&
              block.text.trim()),
        )
      )
        continue;
      const reasoning = record.data.content.filter(
        (block) => block.type === "reasoning" && block.text.trim(),
      );
      if (reasoning.length)
        process(
          runId,
          `process:attempt:${record.data.attempt_id}`,
          record.seq,
        ).entries.push({
          kind: "assistant",
          id: `reasoning:${record.data.attempt_id}`,
          record: { ...record, data: { ...record.data, content: reasoning } },
        });
      const content = record.data.content.filter(
        (block) =>
          block.type === "file_reference" ||
          (block.type === "text" && block.text.trim()),
      );
      if (content.length) {
        result.push({
          ...node,
          record: { ...record, data: { ...record.data, content } },
        });
        group = undefined;
      }
    } else if (record.event_type === "assistant/message") {
      result.push(node);
      group = undefined;
    } else {
      result.push(node);
      group = undefined;
    }
  }
  if (attempt) {
    const content = attempt.content.filter(
      (block) => block.type === "reasoning" || block.type === "tool_call",
    );
    if (content.length) {
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
  return result;
}
