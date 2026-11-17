import type { ActiveAttempt, DurableRecord } from "@/types/agent-events";
import type { ConversationNode, ToolNode } from "./conversation-projection";

type Reply = Extract<
  DurableRecord,
  { event_type: "assistant/message" | "assistant/attempt" }
>;
export type ProcessEntry =
  | { kind: "tool"; id: string; key?: string }
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
  private lastAttempt: ActiveAttempt | null = null;
  private toolGroups = new Map<string, string>();

  project(
    nodes: ConversationNode[],
    attempt: ActiveAttempt | null,
  ): PresentedNode[] {
    if (attempt) this.lastAttempt = attempt;
    const claimed = new Set<string>();
    const presented = conversationPresentation(nodes, attempt).map((node) => {
      if (node.kind !== "process") return node;
      const members = node.entries.map(
        (entry) =>
          `${node.runId}:${entry.kind === "tool" ? (entry.key ?? entry.id) : entry.id}`,
      );
      // A new reply body can split a previously shared reasoning/tool group.
      // Only one resulting group may retain the old mounted identity.
      let id =
        members
          .map((member) => this.identities.get(member))
          .find((id) => id !== undefined && !claimed.has(id)) ?? node.id;
      if (claimed.has(id)) id = `${node.id}:${members[0]}`;
      claimed.add(id);
      for (const member of members) this.identities.set(member, id);
      const drafts =
        this.lastAttempt?.content.filter(
          (block) => block.type === "tool_call",
        ) ?? [];
      const tools = node.tools.map((tool) => {
        const draft =
          tool.attemptId === this.lastAttempt?.attempt_id
            ? drafts[tool.ordinal ?? -1]
            : undefined;
        return tool.draft?.committed && draft
          ? {
              ...tool,
              draft: {
                ...tool.draft,
                name: draft.name ?? undefined,
                argumentsText: draft.arguments_text,
              },
            }
          : tool;
      });
      return { ...node, id, anchor: id, tools };
    });
    // Once visible, a tool belongs to its mounted group. Late text fragments
    // may add a reply boundary, but must not move an existing tool across it.
    const groups = presented.filter(
      (node): node is PresentedProcess => node.kind === "process",
    );
    for (const group of groups) {
      for (const entry of [...group.entries]) {
        if (entry.kind !== "tool") continue;
        const key = entry.key ?? entry.id;
        const owner = groups.find(
          (item) => item.id === this.toolGroups.get(key),
        );
        if (owner && owner !== group && owner.runId === group.runId) {
          const tool = group.tools.find((item) => item.id === entry.id)!;
          group.entries = group.entries.filter((item) => item !== entry);
          group.tools = group.tools.filter((item) => item !== tool);
          owner.entries.push(entry);
          owner.tools.push(tool);
        } else this.toolGroups.set(key, group.id);
      }
    }
    return presented.filter(
      (node) => node.kind !== "process" || node.entries.length > 0,
    );
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
            ? {
                ...entry,
                key: toolPresentationKey(
                  node.tools.find((tool) => tool.id === entry.id)!,
                ),
              }
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
        !record.data.rejected_tools?.length &&
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
      if (record.data.rejected_tools?.length) {
        const target = process(
          runId,
          `process:tools:${record.data.attempt_id}`,
          record.seq,
        );
        record.data.rejected_tools.forEach((tool, ordinal) => {
          const id = `tool:${record.data.attempt_id}:${ordinal}`;
          target.tools.push({
            id,
            attemptId: record.data.attempt_id,
            ordinal,
            status:
              record.data.status === "interrupted" ? "cancelled" : "failed",
            draft: { name: tool.name, argumentsText: tool.arguments_text },
            rejected: {
              diagnostic: record.data.diagnostic,
              reason: record.data.reason_code,
              interrupted: record.data.status === "interrupted",
              truncated: tool.truncated,
            },
          });
          target.entries.push({ kind: "tool", id, key: id });
        });
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
    const reasoning = attempt.content.filter(
      (block) => block.type === "reasoning" && block.text.trim(),
    );
    const text = attempt.content.filter(
      (block) => block.type === "text" && block.text.trim(),
    );
    const tools = attempt.content.filter((block) => block.type === "tool_call");
    if (reasoning.length) {
      process(
        attempt.run_id,
        `process:attempt:${attempt.attempt_id}`,
        `attempt:${attempt.attempt_id}`,
      ).entries.push({
        kind: "assistant",
        id: `reasoning:${attempt.attempt_id}`,
        attempt: { ...attempt, content: reasoning },
      });
    }
    if (text.length) {
      result.push({
        kind: "draft",
        id: `attempt:${attempt.attempt_id}`,
        attempt: { ...attempt, content: text },
      });
      group = undefined;
    }
    if (tools.length) {
      const target = process(
        attempt.run_id,
        `process:tools:${attempt.attempt_id}`,
        `attempt:${attempt.attempt_id}`,
      );
      tools.forEach((block, ordinal) => {
        const id = `tool:${attempt.attempt_id}:${ordinal}`;
        target.tools.push({
          id,
          attemptId: attempt.attempt_id,
          ordinal,
          draft: {
            name: block.name ?? undefined,
            argumentsText: block.arguments_text,
          },
        });
        target.entries.push({ kind: "tool", id, key: id });
      });
    }
  }
  return result;
}

function toolPresentationKey(tool: ToolNode) {
  return tool.attemptId !== undefined && tool.ordinal !== undefined
    ? `tool:${tool.attemptId}:${tool.ordinal}`
    : tool.id;
}
