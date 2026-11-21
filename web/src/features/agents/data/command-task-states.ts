import { useMemo } from "react";
import { queryOptions, useQueries } from "@tanstack/react-query";
import { ApiError, request } from "@/api/client";
import { agentRoot } from "./agent-api";
import type { PresentedNode } from "./conversation-presentation";
import type { TaskStatus } from "./conversation-projection";

// Read-only UI projection. Preserve the command, output and certainty in each
// tool result while sharing one status observation across calls for a task.
export function useCommandTaskStates(
  sessionId: string,
  nodes: PresentedNode[],
) {
  const { pending, finished } = useMemo(() => {
    const pending = new Map<string, string>();
    const finished = new Map<string, TaskStatus>();
    for (const node of nodes) {
      if (node.kind !== "process") continue;
      for (const tool of node.tools) {
        const task = tool.result?.data.sandbox_execution;
        if (!task) continue;
        if (task.state === "completed") {
          finished.set(task.task_id, task);
          pending.delete(task.task_id);
        } else if (!finished.has(task.task_id) && !pending.has(task.task_id)) {
          pending.set(task.task_id, tool.id);
        }
      }
    }
    return { pending, finished };
  }, [nodes]);
  const live = useQueries({
    queries: Array.from(pending, ([id, callId]) =>
      queryOptions({
        queryKey: ["agent-session", sessionId, "task-status", id],
        queryFn: async ({ signal }) => {
          const { data } = await request<TaskStatus>(
            `${agentRoot}/sessions/${sessionId}/tool-calls/${callId}/task`,
            { signal },
          );
          if (data.task_id !== id) throw new Error("任务标识不一致");
          return { task_id: id, state: data.state, exit_code: data.exit_code };
        },
        staleTime: (query) =>
          query.state.data?.state === "completed" ? Infinity : 0,
        retry: false,
        refetchInterval: (query) => {
          const { data, error } = query.state;
          if (
            data?.state === "completed" ||
            (error instanceof ApiError &&
              [401, 403, 404].includes(error.status))
          )
            return false;
          return error ? 5000 : 1500;
        },
      }),
    ),
    combine: (queries) =>
      queries.flatMap((q) => (q.data && !q.isError ? [q.data] : [])),
  });
  return useMemo(() => {
    if (!finished.size && !live.length) return nodes;
    const latest = new Map(finished);
    for (const task of live) latest.set(task.task_id, task);
    return nodes.map((node) => {
      if (node.kind !== "process") return node;
      let changed = false;
      const tools = node.tools.map((tool) => {
        const snapshot = tool.result?.data.sandbox_execution;
        if (!snapshot || snapshot.state === "completed") return tool;
        const taskStatus = latest.get(snapshot.task_id);
        if (!taskStatus) return tool;
        changed = true;
        return { ...tool, taskStatus };
      });
      return changed ? { ...node, tools } : node;
    });
  }, [nodes, finished, live]);
}
