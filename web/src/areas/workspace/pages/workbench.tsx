import { useEffect, useState } from "react";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  ArrowUpRight,
  ChevronRight,
  CircleCheck,
  CircleHelp,
  CheckCheck,
  Folder,
  LoaderCircle,
  Pin,
  SlidersHorizontal,
  Star,
  Users,
} from "lucide-react";
import { request } from "@/api/client";
import { Button } from "@/components/button";
import { AsyncBoundary, ErrorNotice, StatusBadge } from "@/components/feedback";
import { Drawer, OverlayCancelButton } from "@/components/overlays";
import { Pagination } from "@/components/pagination";
import { useApiQuery } from "@/hooks/use-api";
import type {
  AttentionItem,
  AttentionKind,
  AttentionSummary,
} from "@/types/agents";
import type { Shortcuts } from "@/types/collaboration";
import { ShortcutEditor } from "@/areas/workspace/pages/shortcuts";
import { runStatusNames } from "@/features/agents/resources/admin-shared";
import { NewConversation } from "@/features/agents/chat/new-conversation";

function useForeground() {
  const [visible, setVisible] = useState(
    document.visibilityState === "visible",
  );
  useEffect(() => {
    const update = () => setVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  return visible;
}
const attentionInfo = {
  response_required: {
    label: "待回应",
    description: "需要你补充信息或批准的对话",
    icon: CircleHelp,
    count: "response_required_sessions",
    empty: "暂时没有待回应事项",
    emptyDescription: "需要你补充或确认时，会在这里出现。",
  },
  result_unviewed: {
    label: "待查看结果",
    description: "已结束但你尚未查看的任务",
    icon: CheckCheck,
    count: "result_unviewed_sessions",
    empty: "暂无待查看结果",
    emptyDescription: "任务结束后的新结果会汇总在这里。",
  },
} as const;
export function Workbench() {
  const visible = useForeground(),
    [expanded, setExpanded] = useState<AttentionKind | null>(null),
    [manage, setManage] = useState<"projects" | "teams" | null>(null);
  const summary = useQuery({
    queryKey: ["workspace-attention", "summary"],
    queryFn: ({ signal }) =>
      request<AttentionSummary>("/workspace/attention-summary", { signal }),
    enabled: visible,
    retry: false,
    refetchInterval: (query) =>
      visible && query.state.fetchStatus !== "fetching"
        ? query.state.error
          ? 30000
          : 15000
        : false,
  });
  const shortcuts = useApiQuery<Shortcuts>(
    ["workbench-shortcuts"],
    "/me/sidebar-shortcuts",
  );
  return (
    <div className="agent-workbench">
      <header className="agent-workbench-heading">
        <h1>工作台</h1>
        <p>从对话开始工作，关注需要你回应的对话和待查看结果。</p>
      </header>
      <div className="agent-workbench-start">
        <NewConversation />
      </div>
      <section className="agent-attention-grid" aria-label="需要关注">
        {(Object.keys(attentionInfo) as AttentionKind[]).map((kind) => {
          const info = attentionInfo[kind];
          return (
            <AttentionCard
              key={kind}
              kind={kind}
              visible={visible}
              count={summary.data?.data.counts[info.count]}
              countError={summary.isError}
              onExpand={() => setExpanded(kind)}
            />
          );
        })}
      </section>
      {summary.isError && (
        <p className="mt-3 text-xs text-warning">
          全局计数加载失败，列表仍可单独读取。
          <button
            className="ml-2 underline"
            onClick={() => void summary.refetch()}
          >
            重试计数
          </button>
        </p>
      )}
      <section className="agent-workbench-shortcuts" aria-label="常用入口">
        {(["projects", "teams"] as const).map((kind) => {
          const isProject = kind === "projects",
            Icon = isProject ? Star : Pin;
          return (
            <div key={kind} className="agent-shortcut-group">
              <header>
                <h2>
                  <Icon className="size-4" />
                  {isProject ? "关注项目" : "固定团队"}
                </h2>
                <div className="agent-shortcut-actions">
                  <Link to={`/${kind}`} className="agent-workbench-link">
                    {isProject ? "我的全部项目" : "我的全部团队"}
                    <ArrowUpRight className="size-3.5" />
                  </Link>
                  <Button
                    variant="ghost"
                    size="iconSm"
                    title={isProject ? "管理关注项目" : "管理固定团队"}
                    aria-label={isProject ? "管理关注项目" : "管理固定团队"}
                    disabled={!shortcuts.data}
                    onClick={() => setManage(kind)}
                  >
                    <SlidersHorizontal className="size-3.5" />
                  </Button>
                </div>
              </header>
              {shortcuts.isPending ? (
                <p className="agent-shortcut-message">正在读取常用入口…</p>
              ) : shortcuts.isError ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void shortcuts.refetch()}
                >
                  读取失败，重试
                </Button>
              ) : (
                <div className="agent-shortcut-items">
                  {shortcuts.data?.data[kind].items.map((item) => (
                    <Link
                      key={item.id}
                      to={`/${kind}/${item.id}`}
                      title={item.name}
                      className="agent-shortcut-link"
                    >
                      {isProject ? (
                        <Folder className="size-4" />
                      ) : (
                        <Users className="size-4" />
                      )}
                      <span>{item.name}</span>
                      <ChevronRight className="size-3.5" />
                    </Link>
                  ))}
                  {!shortcuts.data?.data[kind].items.length && (
                    <p className="agent-shortcut-message">
                      {isProject
                        ? "关注项目后，可在这里快速进入。"
                        : "固定团队后，可在这里快速进入。"}
                    </p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </section>
      {expanded && (
        <Drawer
          open
          wide
          title={attentionInfo[expanded].label}
          description={attentionInfo[expanded].description}
          onClose={() => setExpanded(null)}
          footer={<OverlayCancelButton>关闭</OverlayCancelButton>}
        >
          <AttentionEntries key={expanded} kind={expanded} visible={visible} />
        </Drawer>
      )}
      {manage && shortcuts.data && (
        <ShortcutEditor
          kind={manage}
          initial={shortcuts.data.data}
          onClose={() => {
            setManage(null);
            void shortcuts.refetch();
          }}
        />
      )}
    </div>
  );
}
function useAttentionQuery(
  kind: AttentionKind,
  page: number,
  size: number,
  visible: boolean,
) {
  return useQuery({
    queryKey: ["workspace-attention", kind, page, size],
    queryFn: ({ signal }) =>
      request<AttentionItem[]>(
        `/workspace/attention?kind=${kind}&page=${page}&page_size=${size}`,
        { signal },
      ),
    enabled: visible,
    retry: false,
    refetchInterval: (query) =>
      visible && query.state.fetchStatus !== "fetching"
        ? query.state.error
          ? 30000
          : 15000
        : false,
  });
}
function AttentionCard({
  kind,
  count,
  countError,
  visible,
  onExpand,
}: {
  kind: AttentionKind;
  count?: number;
  countError: boolean;
  visible: boolean;
  onExpand: () => void;
}) {
  const query = useAttentionQuery(kind, 1, 3, visible),
    info = attentionInfo[kind];
  const hasMore = (count ?? 0) > 3 || (query.data?.pagination?.total ?? 0) > 3;
  return (
    <article
      className="agent-attention-card"
      aria-labelledby={`attention-${kind}`}
    >
      <header>
        <h2 id={`attention-${kind}`}>
          <info.icon className="size-4" />
          {info.label}
          <span
            className="agent-attention-count"
            aria-label={`${info.label}数量：${countError ? "读取失败" : (count ?? "读取中")}`}
          >
            {countError ? "—" : (count ?? "…")}
          </span>
        </h2>
        {hasMore ? (
          <button
            className="agent-workbench-link"
            onClick={onExpand}
            aria-label={`查看全部${info.label}`}
          >
            查看全部
            <ArrowRight className="size-3.5" />
          </button>
        ) : null}
      </header>
      <div className="agent-attention-content">
        {query.isPending ? (
          <div className="agent-attention-empty" role="status">
            <LoaderCircle className="size-5 animate-spin" />
            <span>正在读取{info.label}…</span>
          </div>
        ) : query.isError ? (
          <div className="agent-attention-error">
            <ErrorNotice error={query.error} />
            <Button
              variant="outline"
              size="sm"
              onClick={() => void query.refetch()}
            >
              重新读取{info.label}
            </Button>
          </div>
        ) : query.data?.data.length ? (
          query.data.data.map((item) => (
            <AttentionRow key={item.session_id} item={item} />
          ))
        ) : (
          <div className="agent-attention-empty">
            <CircleCheck className="size-6" />
            <strong>{info.empty}</strong>
            <span>{info.emptyDescription}</span>
          </div>
        )}
      </div>
    </article>
  );
}
function AttentionEntries({
  kind,
  visible,
}: {
  kind: AttentionKind;
  visible: boolean;
}) {
  const [page, setPage] = useState(1),
    [size, setSize] = useState(20);
  const query = useAttentionQuery(kind, page, size, visible);
  return (
    <AsyncBoundary
      loading={query.isPending}
      error={query.error}
      onRetry={() => query.refetch()}
    >
      <div className="divide-y divide-border-subtle">
        {query.data?.data.map((item) => (
          <AttentionRow key={item.session_id} item={item} />
        ))}
      </div>
      {query.data?.data.length === 0 && (
        <div className="agent-attention-empty">
          <CircleCheck className="size-6" />
          <strong>{attentionInfo[kind].empty}</strong>
        </div>
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
  );
}
function AttentionRow({ item }: { item: AttentionItem }) {
  return (
    <Link
      className="agent-attention-row"
      to={`/agents/sessions/${item.session_id}`}
    >
      <span
        className="agent-attention-icon"
        data-tone={item.kind === "response_required" ? "warning" : "info"}
      >
        {item.kind === "response_required" ? (
          <CircleHelp className="size-4" />
        ) : (
          <CheckCheck className="size-4" />
        )}
      </span>
      <span className="agent-attention-main">
        <strong title={item.title}>{item.title}</strong>
        <span className="agent-attention-reason">
          {item.kind === "response_required" ? (
            <>
              {item.question_interaction_count > 0 && (
                <span>{item.question_interaction_count} 组问题</span>
              )}
              {item.approval_interaction_count > 0 && (
                <StatusBadge tone="warning">
                  {item.approval_interaction_count} 项审批
                </StatusBadge>
              )}
            </>
          ) : (
            <>
              <StatusBadge
                tone={
                  item.latest_result.status === "succeeded"
                    ? "success"
                    : "warning"
                }
              >
                {runStatusNames[item.latest_result.status]}
              </StatusBadge>
              <span>{item.unviewed_run_count} 个未查看结果</span>
            </>
          )}
        </span>
      </span>
      <ChevronRight className="agent-attention-arrow size-3.5" />
    </Link>
  );
}
