import type { ReactNode } from "react";
import { Link, useParams } from "react-router";
import { Button } from "@/components/button";
import { AsyncBoundary, Notice } from "@/components/feedback";
import { PageHeader } from "@/components/layout";
import { useApiQuery } from "@/hooks/use-api";
import { Conversation } from "@/features/agents/chat/conversation";
import { NewConversation } from "@/features/agents/chat/new-conversation";
import { agentAdminRoot } from "@/features/agents/data/agent-api";
import type { AgentDefinition } from "@/types/agents";

function DebugHeader({ children }: { children: ReactNode }) {
  return <header className="agent-chat-header">{children}</header>;
}
export function AgentDebugPage() {
  const { agentId = "", sessionId } = useParams();
  const query = useApiQuery<AgentDefinition>(
    ["agent-debug", agentId],
    `${agentAdminRoot}/definitions/${agentId}`,
  );
  return (
    <div className={sessionId ? "agent-chat-page" : "page"}>
      <div className={sessionId ? "shrink-0 px-7 pt-5" : undefined}>
        <PageHeader
          title={
            query.data?.data.name
              ? `调试 · ${query.data.data.name}`
              : "智能体调试"
          }
          actions={
            <Button
              render={<Link to={`/admin/agents/${agentId}`}>返回配置</Link>}
              nativeButton={false}
              role="link"
              variant="outline"
            />
          }
        />
      </div>
      <AsyncBoundary
        loading={query.isPending}
        error={query.error}
        onRetry={() => query.refetch()}
      >
        {query.data?.data.agent_type === "service" ? (
          sessionId ? (
            <Conversation
              key={sessionId}
              sessionId={sessionId}
              service
              Header={DebugHeader}
              expectedAgentId={agentId}
            />
          ) : (
            <NewConversation service agentId={agentId} />
          )
        ) : query.data ? (
          <Notice>交互型智能体请从工作台使用本人身份开始对话。</Notice>
        ) : null}
      </AsyncBoundary>
    </div>
  );
}
