import { Conversation } from "@/features/agents/chat/conversation";
import type { ReactNode } from "react";
import { useParams } from "react-router";
function ConversationHeader({ children }: { children: ReactNode }) {
  return (
    <aside className="agent-chat-actions-sidebar" aria-label="会话操作">
      {children}
    </aside>
  );
}
export function AgentSessionPage() {
  const { sessionId = "" } = useParams();
  return (
    <div className="agent-chat-page">
      <Conversation
        key={sessionId}
        sessionId={sessionId}
        service={false}
        sideActions
        Header={ConversationHeader}
      />
    </div>
  );
}
