import { Button } from "@/components/button";
import { AsyncBoundary, EmptyState, StatusBadge } from "@/components/feedback";
import { StandaloneInput, StandaloneSelect } from "@/components/fields";
import { Drawer, OverlayCancelButton } from "@/components/overlays";
import { Pagination } from "@/components/pagination";
import { TableToolbar } from "@/components/table-toolbar";
import { runStatusNames } from "@/features/agents/resources/admin-shared";
import { useApiQuery } from "@/hooks/use-api";
import { useDebouncedSearch } from "@/hooks/use-search";
import type { SessionSummary } from "@/types/agents";
import { Pin } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { agentQuery, agentRoot } from "../data/agent-api";

export function SessionSearch({
  onClose,
  agentId,
}: {
  onClose: () => void;
  agentId?: string;
}) {
  const [all, setAll] = useState(false);
  return (
    <Drawer
      open
      wide
      title="搜索个人会话"
      description="查看和搜索本人的交互型会话。"
      onClose={onClose}
      footer={<OverlayCancelButton>关闭</OverlayCancelButton>}
    >
      {agentId && (
        <Button
          variant="ghost"
          className="mb-3"
          aria-pressed={all}
          onClick={() => setAll(!all)}
        >
          {all ? "仅搜索当前智能体" : "搜索全部智能体的会话"}
        </Button>
      )}
      <SessionList
        key={all ? "all" : agentId}
        agentId={all ? undefined : agentId}
        onNavigate={onClose}
      />
    </Drawer>
  );
}
export function SessionList({
  onNavigate,
  agentId,
}: {
  onNavigate?: () => void;
  agentId?: string;
}) {
  const [page, setPage] = useState(1),
    [size, setSize] = useState(20),
    [q, setQ] = useState(""),
    [archived, setArchived] = useState("false"),
    [attention, setAttention] = useState("all");
  const search = useDebouncedSearch(q, (value) => {
    setQ(value);
    setPage(1);
  });
  const params = agentQuery({
    agent_id: agentId,
    agent_type: "interactive",
    page,
    page_size: size,
    q,
    archived,
    attention,
  });
  const query = useApiQuery<SessionSummary[]>(
    ["agent-sessions", "interactive", params],
    `${agentRoot}/sessions?${params}`,
  );
  return (
    <>
      <TableToolbar
        onRefresh={() => query.refetch()}
        refreshing={query.isFetching}
        onReset={() => {
          setQ("");
          setArchived("false");
          setAttention("all");
          setPage(1);
        }}
      >
        <StandaloneInput
          aria-label="搜索会话"
          placeholder="搜索会话标题"
          value={search.value}
          onChange={(event) => search.setValue(event.target.value)}
          className="w-64"
        />
        <StandaloneSelect
          aria-label="会话归档状态"
          value={archived}
          onValueChange={(value) => {
            setArchived(value);
            if (value !== "false") setAttention("all");
            setPage(1);
          }}
        >
          <option value="false">进行中的会话</option>
          <option value="true">已归档</option>
          <option value="all">全部会话</option>
        </StandaloneSelect>
        <StandaloneSelect
          aria-label="关注类型"
          value={attention}
          onValueChange={(value) => {
            setAttention(value);
            if (value !== "all") setArchived("false");
            setPage(1);
          }}
        >
          <option value="all">全部关注状态</option>
          <option value="response_required">待回应</option>
          <option value="result_unviewed">待查看结果</option>
        </StandaloneSelect>
      </TableToolbar>
      <AsyncBoundary
        loading={query.isPending}
        error={query.error}
        onRetry={() => query.refetch()}
      >
        <div className="divide-y divide-border-subtle">
          {query.data?.data.map((session) => (
            <Link
              className="flex items-start justify-between gap-5 rounded-lg p-4 hover:bg-surface-hover"
              key={session.id}
              onClick={onNavigate}
              to={`/chats/${session.id}`}
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  {session.pinned && (
                    <Pin className="size-3.5 shrink-0 text-primary" />
                  )}
                  <h3 className="truncate font-medium" title={session.title}>
                    {session.title}
                  </h3>
                </div>
                <p className="mt-2 text-xs text-muted">
                  {new Date(session.last_activity_at).toLocaleString()}
                  {session.archived_at && " · 已归档"}
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                {session.active_run_status && (
                  <StatusBadge tone="info">
                    {runStatusNames[session.active_run_status]}
                  </StatusBadge>
                )}
                {session.attention.question_interaction_count +
                  session.attention.approval_interaction_count >
                  0 && <StatusBadge tone="warning">待回应</StatusBadge>}
                {session.attention.unviewed_run_count > 0 && (
                  <StatusBadge>
                    {session.attention.unviewed_run_count} 个结果未查看
                  </StatusBadge>
                )}
              </div>
            </Link>
          ))}
        </div>
        {query.data?.data.length === 0 && (
          <EmptyState
            title="暂无匹配会话"
            description="调整筛选，或开始一段新对话。"
          />
        )}
        <Pagination
          page={page}
          size={size}
          total={query.data?.pagination?.total}
          pending={query.isFetching}
          onChange={(next, count) => {
            setPage(next);
            setSize(count);
          }}
        />
      </AsyncBoundary>
    </>
  );
}
