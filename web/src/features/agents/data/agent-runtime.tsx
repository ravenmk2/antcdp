import { Button } from "@/components/button";
import { ErrorNotice, Notice } from "@/components/feedback";
import { useNavigationGuard } from "@/components/navigation-guard";
import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { type AgentCommand, type CommandState } from "./command-store";

import { useAgentRuntime } from "./runtime-context";
export { AgentRuntimeProvider, useAgentRuntime } from "./runtime-context";
export function useConversationSend(id: string) {
  const { sends } = useAgentRuntime();
  const flow = useMemo(() => sends.get(id), [sends, id]);
  const state = useSyncExternalStore(flow.subscribe, flow.getSnapshot);
  const release = useNavigationGuard(
    state.phase === "sending" ||
      state.phase === "uncertain" ||
      state.phase === "failed",
  );
  useEffect(() => {
    if (state.phase === "idle" || state.phase === "accepted") {
      release();
      return;
    }
    const beforeUnload = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [state.phase, release]);
  return { flow, state, release };
}
export function useConversationDraft(id: string) {
  const { drafts } = useAgentRuntime();
  const draft = useMemo(() => drafts.get(id), [drafts, id]);
  const state = useSyncExternalStore(draft.subscribe, draft.getSnapshot);
  useEffect(() => {
    if (!state.text && !state.files.length && !state.file_refs.length) return;
    const beforeUnload = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [state]);
  return { draft, state };
}
export function useAgentCommand<T>(intentId: string) {
  const { commands } = useAgentRuntime();
  const command = useMemo(
    () => commands.get<T>(intentId),
    [commands, intentId],
  );
  const state = useSyncExternalStore(command.subscribe, command.getSnapshot);
  const pending = state.phase === "pending",
    uncertain = state.phase === "uncertain";
  const release = useNavigationGuard(pending || uncertain);
  useEffect(() => {
    if (!pending && !uncertain) {
      release();
      return;
    }
    const beforeUnload = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [pending, uncertain, release]);
  return {
    command,
    state,
    pending,
    uncertain,
    recovery: <CommandRecovery command={command} />,
  };
}
export function CommandRecovery<T>({ command }: { command: AgentCommand<T> }) {
  const state = useSyncExternalStore(command.subscribe, command.getSnapshot);
  return (
    <>
      <ErrorNotice error={state.receiptMissing ? undefined : state.error} />
      {state.phase === "uncertain" && (
        <Notice tone="warning" title="提交结果尚未确认">
          原请求及幂等键仍保留。先查询受理结果，或重试同一请求，避免重复创建或执行。
          {state.receiptMissing && (
            <p className="mt-2">暂未查到回执，这不代表原操作没有执行。</p>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => void command.reconcile()}>
              查询受理结果
            </Button>
            <Button variant="outline" onClick={() => void command.retry()}>
              重试原请求
            </Button>
          </div>
        </Notice>
      )}
    </>
  );
}
export function useConversationStream(sessionId: string) {
  const { stream } = useAgentRuntime();
  const observation = useMemo(
    () => stream.observe(sessionId),
    [stream, sessionId],
  );
  const state = useSyncExternalStore(
    observation.subscribe,
    observation.getSnapshot,
  );
  const connection = useSyncExternalStore(
    stream.subscribeConnection,
    stream.getConnectionStatus,
  );
  return { state, connection, observation };
}
export function useCommandResult<T>(
  state: CommandState<T>,
  complete: (data: T) => void,
) {
  const handled = useRef<string | null>(null);
  useEffect(() => {
    if (
      state.phase !== "succeeded" ||
      !state.response ||
      !state.key ||
      state.key === handled.current
    )
      return;
    handled.current = state.key;
    complete(state.response.data);
  }, [state, complete]);
}
