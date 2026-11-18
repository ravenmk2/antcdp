import { Conversation } from "@/features/agents/chat/conversation";
import type { ReactNode } from "react";
import { useParams } from "react-router";
import { useApiQuery } from "@/hooks/use-api";
import { AsyncBoundary } from "@/components/feedback";
import type { SessionDetail } from "@/types/agents";
function ConversationHeader({ children }: { children: ReactNode }) {
  return (
    <aside className="agent-chat-actions-sidebar" aria-label="会话操作">
      {children}
    </aside>
  );
}
export function AgentSessionPage() {
  const { sessionId = "" } = useParams();
  const valid = /^[1-9]\d*$/.test(sessionId);
  const detail = useApiQuery<SessionDetail>(
    ["agent-session", sessionId, "detail"],
    `/agents/sessions/${sessionId}`,
    { enabled: valid },
  );
  if (!valid || detail.error?.status === 403 || detail.error?.status === 404)
    return null;
  return (
    <div className="agent-chat-page">
      <AsyncBoundary
        loading={detail.isPending}
        loadingFallback={null}
        error={detail.error}
        onRetry={() => detail.refetch()}
      >
        {detail.data?.data && (
          <Conversation
            key={sessionId}
            sessionId={sessionId}
            service={false}
            sideActions
            Header={ConversationHeader}
          />
        )}
      </AsyncBoundary>
    </div>
  );
}
