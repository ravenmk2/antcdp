import { useSession } from "@/app/auth";
import {
  forgetUnavailableAgent,
  lastAgentConversationPath,
  rememberConversation,
} from "./conversation-memory";
import { useEffect, useState } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router";
import { Bot, Search, Star } from "lucide-react";
import { IconButton } from "@/components/button";
import { AsyncBoundary, ErrorNotice, StatusBadge } from "@/components/feedback";
import { StandaloneInput } from "@/components/fields";
import { SimpleTable } from "@/components/table";
import { TableToolbar } from "@/components/table-toolbar";
import { PageHeader } from "@/components/layout";
import { DescriptionPreview } from "@/components/description-preview";
import { usePageSize } from "@/hooks/use-page-size";
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
    <SelectedAgent key={id} agentId={id} userId={user.id} />
  ) : (
    <RestoreConversation userId={user.id} />
  );
}

function SelectedAgent({
  agentId,
  userId,
}: {
  agentId: string;
  userId: string;
}) {
  const navigate = useNavigate();
  const valid = /^[1-9]\d*$/.test(agentId);
  const agent = useApiQuery<CatalogAgent>(
    ["agent-start-detail", false, agentId],
    `/agents/catalog/${agentId}`,
    { enabled: valid },
  );
  const missing =
    !valid ||
    agent.error?.status === 404 ||
    agent.error?.status === 403 ||
    agent.error?.code === "AGENT_UNAVAILABLE" ||
    (agent.isSuccess && !agent.data.data?.availability.available);
  useEffect(() => {
    if (missing) {
      forgetUnavailableAgent(userId, agentId);
      void navigate("/chats", { replace: true });
    } else if (agent.data?.data?.availability.available) {
      rememberConversation(userId, { agentId });
    }
  }, [missing, agent.data, userId, agentId, navigate]);
  if (missing) return null;
  return (
    <AsyncBoundary
      loading={agent.isPending}
      loadingFallback={null}
      error={agent.error}
      onRetry={() => agent.refetch()}
    >
      <NewConversation agentId={agentId} />
    </AsyncBoundary>
  );
}

function RestoreConversation({ userId }: { userId: string }) {
  const path = lastAgentConversationPath(userId);
  return path ? <Navigate to={path} replace /> : null;
}

export function AgentDirectory() {
  const [page, setPage] = useState(1);
  const [size, setSize] = usePageSize("workspace-agent-catalog");
  const [q, setQ] = useState("");
  const search = useDebouncedSearch(q, (value) => {
    setQ(value);
    setPage(1);
  });
  const params = agentQuery({ page, page_size: size, q });
  const catalog = useApiQuery<CatalogAgent[]>(
    ["agent-start-catalog", false, params],
    `/agents/catalog?${params}`,
  );
  const favorite = useAgentFavorite();
  return (
    <div className="page workspace-directory-page">
      <PageHeader
        title="助手"
        className="mb-0 border-b border-border pb-5"
        titleClassName="mb-0"
      />
      <TableToolbar
        className="border-0"
        toolbarClassName="px-0 py-4"
        refreshing={catalog.isFetching}
        onRefresh={() => void catalog.refetch()}
        onReset={() => {
          search.setValue("");
          setQ("");
          setPage(1);
        }}
      >
        <form
          className="relative flex items-center"
          onSubmit={(e) => {
            e.preventDefault();
            search.submit();
          }}
        >
          <Search
            aria-hidden
            className="pointer-events-none absolute left-3 size-4 text-muted"
          />
          <StandaloneInput
            className="pl-9"
            aria-label="搜索助手"
            placeholder="搜索助手"
            value={search.value}
            onChange={(e) => search.setValue(e.target.value)}
            onCompositionStart={() => {
              search.composing.current = true;
            }}
            onCompositionEnd={search.compositionEnd}
          />
        </form>
      </TableToolbar>
      <ErrorNotice error={favorite.error} />
      <AsyncBoundary
        loading={catalog.isPending}
        error={catalog.error}
        onRetry={() => catalog.refetch()}
        empty={!catalog.data?.data.length}
        emptyTitle="暂无匹配的助手"
        emptyDescription={
          q ? "试试其他关键词。" : "管理员启用并授权助手后，会显示在这里。"
        }
        emptyIcon={Bot}
      >
        <SimpleTable
          label="助手"
          className="workspace-resource-table"
          headers={["助手名称", "描述", "归属", "状态", "收藏"]}
        >
          {catalog.data?.data.map((agent) => {
            const available = agent.availability.available;
            const identity = (
              <>
                <Bot
                  aria-hidden
                  className="size-7 shrink-0 text-(--workspace-selection-ink)"
                  strokeWidth={1.7}
                />
                <strong className="truncate">{agent.name}</strong>
              </>
            );
            return (
              <tr key={agent.id}>
                <td>
                  {available ? (
                    <Link
                      className="inline-flex max-w-full items-center gap-3 rounded-md text-foreground hover:text-primary"
                      to={`/chats?agent=${agent.id}`}
                      title={agent.name}
                    >
                      {identity}
                    </Link>
                  ) : (
                    <span
                      className="inline-flex max-w-full items-center gap-3 text-muted"
                      title={agent.name}
                    >
                      {identity}
                    </span>
                  )}
                </td>
                <td>
                  {agent.description ? (
                    <div className="flex items-center gap-1">
                      <span className="line-clamp-2">{agent.description}</span>
                      <DescriptionPreview
                        name={agent.name}
                        description={agent.description}
                        label="助手描述"
                      />
                    </div>
                  ) : (
                    "—"
                  )}
                </td>
                <td>
                  {
                    { platform: "平台", team: "团队", project: "项目" }[
                      agent.scope_kind
                    ]
                  }
                </td>
                <td>
                  <StatusBadge tone={available ? "success" : "neutral"}>
                    {available ? "可用" : "暂不可用"}
                  </StatusBadge>
                </td>
                <td>
                  <IconButton
                    size="iconSm"
                    className={agent.favorited ? "star-active" : undefined}
                    label={`${agent.favorited ? "取消收藏" : "收藏"}${agent.name}`}
                    aria-pressed={agent.favorited}
                    disabled={favorite.isPending}
                    onClick={() =>
                      favorite.mutate({
                        id: agent.id,
                        favorited: agent.favorited,
                      })
                    }
                  >
                    <Star />
                  </IconButton>
                </td>
              </tr>
            );
          })}
        </SimpleTable>
      </AsyncBoundary>
      {catalog.data && (
        <Pagination
          className="border-0 bg-transparent px-0 pt-4"
          page={page}
          size={size}
          total={catalog.data.pagination?.total}
          pending={catalog.isFetching}
          onChange={(next, nextSize) => {
            setPage(next);
            if (nextSize !== size) setSize(nextSize);
          }}
        />
      )}
    </div>
  );
}
