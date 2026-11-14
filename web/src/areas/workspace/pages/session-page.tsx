import { Conversation } from "@/features/agents/chat/conversation";
import type { ReactNode } from "react";
import { useParams } from "react-router";
function ConversationHeader({ children }: { children: ReactNode }) {
  return <header className="agent-chat-header">{children}</header>;
}
export function AgentSessionPage() {
  const { sessionId = "" } = useParams();
  return (
    <div className="agent-chat-page">
      <Conversation
        key={sessionId}
        sessionId={sessionId}
        service={false}
        Header={ConversationHeader}
      />
    </div>
  );
}
