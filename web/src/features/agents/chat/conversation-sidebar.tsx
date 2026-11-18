import { useState } from "react";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation } from "react-router";
import {
  Bot,
  Check,
  ChevronDown,
  ChevronUp,
  Pin,
  Search,
  SquarePen,
  StarOff,
} from "lucide-react";
import { request } from "@/api/client";
import { Button } from "@/components/button";
import { RowAction, RowActions } from "@/components/row-actions";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ErrorNotice } from "@/components/feedback";
import { useAgentFavorite } from "../data/use-agent-favorite";
import { agentQuery } from "../data/agent-api";
import type { CatalogAgent, SessionSummary } from "@/types/agents";
import { SessionSearch } from "./session-list";

export function ConversationSidebar({
  agentId,
  agentName,
  ready = true,
}: {
  agentId?: string;
  agentName?: string;
  ready?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [search, setSearch] = useState(false);
  const favorites = useInfiniteQuery({
    queryKey: ["agent-favorites"],
    initialPageParam: 1,
    queryFn: ({ pageParam, signal }) =>
      request<CatalogAgent[]>(
        `/agents/favorites?page=${pageParam}&page_size=100`,
        { signal },
      ),
    getNextPageParam: (last, pages) =>
      pages.reduce((count, page) => count + page.data.length, 0) <
      (last.pagination?.total ?? 0)
        ? pages.length + 1
        : undefined,
  });
  const favorite = useAgentFavorite();
  const all = favorites.data?.pages.flatMap((page) => page.data) ?? [];
  const visible = expanded ? all : all.slice(0, 5);
  const selectedName =
    agentName ?? all.find((agent) => agent.id === agentId)?.name;
  return (
    <div className="conversation-navigation">
      <div className="conversation-navigation-top">
        <Popover open={selecting} onOpenChange={setSelecting}>
          <PopoverTrigger
            className="workspace-sidebar-switcher"
            aria-label={`选择智能体${selectedName ? `：${selectedName}` : ""}`}
          >
            <span className="conversation-agent-mark">
              <Bot aria-hidden strokeWidth={1.7} />
            </span>
            <span className="min-w-0 flex-1">
              <strong className="block truncate text-sm">
                {selectedName ?? (agentId ? "智能体" : "选择智能体")}
              </strong>
              <small className="mt-0.5 block truncate text-[11px] text-muted">
                {agentId ? "智能体 #" + agentId : "从收藏中选择"}
              </small>
            </span>
            <ChevronDown className="size-4 shrink-0 text-muted" aria-hidden />
          </PopoverTrigger>
          <PopoverContent
            align="start"
            sideOffset={4}
            className="conversation-agent-menu w-80 p-1"
            aria-label="选择智能体"
          >
            {favorites.isPending && (
              <p className="conversation-sidebar-note" role="status">
                正在加载…
              </p>
            )}
            {favorites.isError && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void favorites.refetch()}
              >
                收藏加载失败，重试
              </Button>
            )}
            <ErrorNotice error={favorite.error} />
            {!favorites.isPending && !favorites.isError && !all.length && (
              <p className="conversation-sidebar-note">尚未收藏</p>
            )}
            <div className="conversation-favorites">
              {visible.map((agent) => (
                <div className="conversation-favorite-row" key={agent.id}>
                  <Link
                    to={`/chats?agent=${agent.id}`}
                    className="conversation-nav-row"
                    aria-current={agentId === agent.id ? "page" : undefined}
                    title={agent.name}
                    onClick={(event) => {
                      if (
                        event.button !== 0 ||
                        event.metaKey ||
                        event.ctrlKey ||
                        event.shiftKey ||
                        event.altKey
                      )
                        return;
                      if (agent.id === agentId) event.preventDefault();
                      setSelecting(false);
                    }}
                  >
                    <Bot
                      className="mx-1 size-5 shrink-0 text-muted"
                      strokeWidth={1.7}
                    />
                    <span>{agent.name}</span>
                    {!agent.availability.available && <small>暂不可用</small>}
                    {agentId === agent.id && (
                      <Check className="conversation-agent-check" aria-hidden />
                    )}
                  </Link>
                  <div className="conversation-favorite-actions">
                    <RowActions
                      label={agent.name}
                      disabled={favorite.isPending}
                    >
                      <RowAction
                        icon={<StarOff />}
                        onSelect={() =>
                          favorite.mutate({ id: agent.id, favorited: true })
                        }
                      >
                        取消收藏
                      </RowAction>
                    </RowActions>
                  </div>
                </div>
              ))}
            </div>
            {all.length > 5 && (
              <Button
                variant="ghost"
                size="sm"
                className="conversation-expand"
                aria-expanded={expanded}
                onClick={() => setExpanded(!expanded)}
              >
                {expanded ? <ChevronUp /> : <ChevronDown />}
                {expanded ? "收起收藏" : "展开更多"}
              </Button>
            )}
            {expanded && favorites.hasNextPage && (
              <Button
                variant="ghost"
                size="sm"
                disabled={favorites.isFetchingNextPage}
                onClick={() => void favorites.fetchNextPage()}
              >
                加载更多智能体
              </Button>
            )}
          </PopoverContent>
        </Popover>
      </div>
      <div className="conversation-history">
        <div className="conversation-section-heading">
          <h2>会话</h2>
          <div className="flex items-center">
            <Button
              variant="ghost"
              size="iconSm"
              aria-label="搜索会话"
              title="搜索会话"
              onClick={() => setSearch(true)}
            >
              <Search />
            </Button>
            <Button
              variant="ghost"
              size="iconSm"
              aria-label="新建对话"
              title="新建对话"
              render={
                <Link
                  to={agentId ? `/chats?agent=${agentId}` : "/agents/catalog"}
                >
                  <SquarePen />
                </Link>
              }
              nativeButton={false}
            />
          </div>
        </div>
        {ready ? (
          agentId ? (
            <ConversationHistory key={agentId} agentId={agentId} />
          ) : null
        ) : (
          <p className="conversation-sidebar-note">正在读取会话所属智能体…</p>
        )}
      </div>
      {search && (
        <SessionSearch agentId={agentId} onClose={() => setSearch(false)} />
      )}
    </div>
  );
}

function ConversationHistory({ agentId }: { agentId?: string }) {
  const { pathname } = useLocation();
  const cache = useQueryClient();
  const [loadingMore, setLoadingMore] = useState(false);
  const query = useInfiniteQuery({
    queryKey: ["agent-sessions", "sidebar", agentId],
    initialPageParam: 1,
    queryFn: ({ pageParam, signal }) =>
      request<SessionSummary[]>(
        `/agents/sessions?${agentQuery({ agent_type: "interactive", agent_id: agentId, archived: false, page: pageParam, page_size: 10 })}`,
        { signal },
      ),
    getNextPageParam: (last, pages) =>
      pages.reduce((count, page) => count + page.data.length, 0) <
      (last.pagination?.total ?? 0)
        ? pages.length + 1
        : undefined,
  });
  const rows = query.data?.pages.flatMap((page) => page.data) ?? [];
  const sessions = [
    ...new Map(rows.map((session) => [session.id, session])).values(),
  ];
  async function loadMore() {
    if (loadingMore) return;
    setLoadingMore(true);
    try {
      // Keep a background refresh from cancelling pagination, or vice versa.
      if (
        cache.getQueryState(["agent-sessions", "sidebar", agentId])
          ?.fetchStatus === "fetching"
      )
        await query.refetch({ cancelRefetch: false });
      await query.fetchNextPage({ cancelRefetch: false });
    } finally {
      setLoadingMore(false);
    }
  }
  return (
    <>
      {query.isPending && (
        <p className="conversation-sidebar-note" role="status">
          正在加载会话…
        </p>
      )}
      <div className="conversation-history-items">
        {sessions.map((session) => (
          <Link
            key={session.id}
            to={`/chats/${session.id}`}
            className="conversation-nav-row"
            title={session.title}
            aria-current={
              pathname === `/chats/${session.id}` ? "page" : undefined
            }
          >
            {session.pinned && <Pin className="size-3 shrink-0" />}
            <span>{session.title}</span>
            {session.attention.question_interaction_count +
              session.attention.approval_interaction_count >
            0 ? (
              <small>待回应</small>
            ) : session.attention.unviewed_run_count > 0 ? (
              <span
                className="ml-auto mr-1 size-1.5 shrink-0 rounded-full bg-emerald-500"
                role="img"
                aria-label="有未查看的回复结果"
                title="有未查看的回复结果"
              />
            ) : (
              session.active_run_status && (
                <span
                  className="agent-session-dot"
                  data-state={session.active_run_status}
                />
              )
            )}
          </Link>
        ))}
      </div>
      {query.isError && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() =>
            void (query.isFetchNextPageError
              ? query.fetchNextPage()
              : query.refetch())
          }
        >
          会话加载失败，重试
        </Button>
      )}
      {!query.isPending && !query.isError && !sessions.length && (
        <p className="conversation-sidebar-note">暂无会话</p>
      )}
      {query.hasNextPage && (
        <Button
          variant="ghost"
          size="sm"
          className="conversation-expand"
          disabled={loadingMore || query.isFetchingNextPage}
          onClick={() => void loadMore()}
        >
          {loadingMore || query.isFetchingNextPage
            ? "正在加载…"
            : "加载更多会话"}
        </Button>
      )}
    </>
  );
}
