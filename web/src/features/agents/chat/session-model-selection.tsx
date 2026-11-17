import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { request } from "@/api/client";
import { ErrorNotice } from "@/components/feedback";
import { useApiQuery } from "@/hooks/use-api";
import type {
  CatalogAgent,
  ModelSelection,
  SessionConfiguration,
  SessionDetail,
  StartOptions,
} from "@/types/agents";
import { agentAdminRoot, agentRoot } from "../data/agent-api";
import { useConversationSend } from "../data/agent-runtime";
import { ModelSelectionControls } from "./model-selection";

export function SessionModelSelection({
  session,
  onPending,
}: {
  session: SessionDetail;
  onPending: (pending: boolean) => void;
}) {
  const cache = useQueryClient();
  const config = session.configuration;
  const path = `${agentRoot}/sessions/${config.id}`;
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>();
  const send = useConversationSend(`session:${config.id}`);
  const options = useApiQuery<CatalogAgent | StartOptions>(
    ["agent-session", config.id, "model-options"],
    config.agent_type === "service"
      ? `${agentAdminRoot}/definitions/${config.agent_id}/start-options`
      : `${agentRoot}/catalog/${config.agent_id}`,
    {
      enabled:
        session.permissions.manage &&
        session.state.agent_access_available &&
        !config.archived_at,
    },
  );
  async function change(value: ModelSelection) {
    setPending(true);
    onPending(true);
    setError(undefined);
    try {
      // Read the current revision before writing; concurrent changes still fail
      // If-Match instead of silently replacing another tab's selection.
      const current = await request<SessionConfiguration>(
        `${path}/configuration`,
      );
      const result = await request<SessionConfiguration>(
        `${path}/configuration`,
        {
          method: "PATCH",
          etag: current.etag,
          body: { model_selection: value },
        },
      );
      cache.setQueryData(["agent-session", config.id, "configuration"], result);
    } catch (cause) {
      setError(cause);
    } finally {
      // Refresh even after an uncertain response. Do not resend a mutation or
      // send input with the previous selection hash while reconciliation runs.
      await cache.invalidateQueries({ queryKey: ["agent-session", config.id] });
      setPending(false);
      onPending(false);
    }
  }
  return (
    <div>
      <ModelSelectionControls
        models={options.data?.data.model_options ?? []}
        value={{
          model_binding_id: session.selection.model_binding_id,
          thinking_option_key: session.selection.thinking_option_key,
        }}
        locked={Boolean(config.model_locked_at)}
        disabled={
          pending ||
          send.state.phase !== "idle" ||
          !session.permissions.manage ||
          !session.state.agent_access_available ||
          Boolean(config.archived_at)
        }
        modelName={session.selection.model_name}
        thinkingLabel={session.selection.thinking_label}
        onChange={(value) => void change(value)}
      />
      <ErrorNotice error={error || options.error} />
    </div>
  );
}
