import { useSession } from "@/app/auth";
import { lastConversationPath } from "./conversation-memory";
import { useState } from "react";
import { Link, Navigate, useSearchParams } from "react-router";
import { ArrowUpRight, Bot, Search, Star } from "lucide-react";
import { Button } from "@/components/button";
import { AsyncBoundary, EmptyState, ErrorNotice } from "@/components/feedback";
import { StandaloneInput } from "@/components/fields";
import { Pagination } from "@/components/pagination";
import { useApiQuery } from "@/hooks/use-api";
import { useDebouncedSearch } from "@/hooks/use-search";
import { agentQuery } from "@/features/agents/data/agent-api";
import { useAgentFavorite } from "@/features/agents/data/use-agent-favorite";
import { NewConversation } from "@/features/agents/chat/new-conversation";
import type { CatalogAgent } from "@/types/agents";

export function ConversationsPage() {
  const { user } = useSession();
  const [params] = useSearchParams();
  const id = params.get("agent");
  return id ? (
    <NewConversation key={id} agentId={id} />
  ) : (
    <RestoreConversation userId={user.id} />
  );
}

function RestoreConversation({ userId }: { userId: string }) {
  const path = lastConversationPath(userId);
  return path ? <Navigate to={path} replace /> : null;
}

export function AgentDirectory() {
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const search = useDebouncedSearch(q, (value) => {
    setQ(value);
    setPage(1);
  });
  const params = agentQuery({ page, page_size: 20, q });
  const catalog = useApiQuery<CatalogAgent[]>(
    ["agent-start-catalog", false, params],
    `/agents/catalog?${params}`,
  );
  const favorite = useAgentFavorite();
  return (
    <div className="page agent-directory">
      <header className="agent-directory-heading">
        <div>
          <h1 className="page-title">智能体</h1>
          <p className="page-description">让合适的助手，与你一起完成工作。</p>
        </div>
        <div className="agent-directory-search">
          <Search className="size-4" aria-hidden />
          <StandaloneInput
            className="pl-10"
            aria-label="搜索智能体"
            placeholder="搜索你需要的智能体…"
            value={search.value}
            onChange={(e) => search.setValue(e.target.value)}
            onCompositionStart={() => {
              search.composing.current = true;
            }}
            onCompositionEnd={search.compositionEnd}
          />
        </div>
      </header>
      <ErrorNotice error={favorite.error} />
      <AsyncBoundary
        loading={catalog.isPending}
        error={catalog.error}
        onRetry={() => catalog.refetch()}
      >
        <div className="agent-directory-grid">
          {catalog.data?.data.map((agent) => (
            <article
              className="agent-directory-card"
              key={agent.id}
              data-tone={
                ["blue", "violet", "teal", "amber"][
                  [...agent.id].reduce(
                    (total, char) => total + char.charCodeAt(0),
                    0,
                  ) % 4
                ]
              }
              data-available={agent.availability.available}
            >
              <div className="agent-directory-card-heading">
                <div className="agent-directory-mark">
                  <Bot className="size-6" strokeWidth={1.7} />
                </div>
                <div className="agent-directory-identity">
                  {agent.availability.available ? (
                    <Link
                      className="agent-directory-target"
                      to={`/agents?agent=${agent.id}`}
                    >
                      <h2>{agent.name}</h2>
                    </Link>
                  ) : (
                    <h2>{agent.name}</h2>
                  )}
                  <span className="agent-directory-scope">
                    {
                      {
                        platform: "平台智能体",
                        team: "团队智能体",
                        project: "项目智能体",
                      }[agent.scope_kind]
                    }
                  </span>
                </div>
              </div>
              <p>
                {agent.description || "随时准备与你一起，探索问题、推进工作。"}
              </p>
              <div className="agent-directory-card-footer">
                <span className="agent-directory-availability">
                  {agent.availability.available ? "随时开始" : "暂不可用"}
                </span>
                {agent.availability.available && (
                  <ArrowUpRight
                    className="agent-directory-arrow size-4"
                    aria-hidden
                  />
                )}
              </div>
              <Button
                className="agent-directory-favorite absolute top-4 right-4 z-1"
                variant="ghost"
                size="iconSm"
                aria-label={`${agent.favorited ? "取消收藏" : "收藏"}${agent.name}`}
                title={agent.favorited ? "取消收藏" : "收藏"}
                aria-pressed={agent.favorited}
                disabled={favorite.isPending}
                onClick={() =>
                  favorite.mutate({ id: agent.id, favorited: agent.favorited })
                }
              >
                <Star
                  className={agent.favorited ? "fill-current text-primary" : ""}
                />
              </Button>
            </article>
          ))}
        </div>
        {catalog.data?.data.length === 0 && (
          <EmptyState
            icon={Bot}
            title="暂无匹配的智能体"
            description={
              q
                ? "试试其他关键词。"
                : "管理员启用并授权智能体后，会显示在这里。"
            }
          />
        )}
        {(catalog.data?.pagination?.total ?? 0) > 20 && (
          <Pagination
            page={page}
            size={20}
            sizeOptions={[20]}
            total={catalog.data?.pagination?.total}
            pending={catalog.isFetching}
            onChange={(value) => setPage(value)}
          />
        )}
      </AsyncBoundary>
    </div>
  );
}
