import { useState } from "react";
import { Link } from "react-router";
import type { ApiResponse } from "@/api/client";
import { Button } from "@/components/button";
import { Switch } from "@/components/ui/switch";
import { AsyncBoundary, EmptyState } from "@/components/feedback";
import { Panel } from "@/components/layout";
import { useApiQuery } from "@/hooks/use-api";
import type { BindingCollection } from "@/types/agents";
import type { MCPServer } from "@/types/agent-resources";
import { agentAdminRoot, agentKeys } from "@/features/agents/data/agent-api";
import {
  ConfigActions,
  EnabledState,
  useResourceSave,
} from "@/features/agents/resources/admin-shared";
import { ResourcePicker } from "@/features/agents/resources/resource-picker";

type Binding = { id?: string; mcp_server_id: string; enabled: boolean };
export function AgentMCPBindings({
  agentId,
  onSaved,
  readOnly = false,
}: {
  agentId: string;
  onSaved: () => void;
  readOnly?: boolean;
}) {
  const path = agentAdminRoot + "/definitions/" + agentId + "/mcp-bindings";
  const query = useApiQuery<BindingCollection<Binding>>(
    [...agentKeys, agentId, "mcp-bindings"],
    path,
  );
  return (
    <AsyncBoundary
      loading={query.isPending}
      error={query.error}
      onRetry={() => query.refetch()}
    >
      {query.data && (
        <MCPBindingsForm
          key={`${agentId}:${readOnly ? query.data.etag : "edit"}`}
          initial={query.data}
          path={path}
          onSaved={onSaved}
          readOnly={readOnly}
        />
      )}
    </AsyncBoundary>
  );
}
function MCPBindingsForm({
  initial,
  path,
  onSaved,
  readOnly = false,
}: {
  initial: ApiResponse<BindingCollection<Binding>>;
  path: string;
  onSaved: () => void;
  readOnly?: boolean;
}) {
  const from = (value: BindingCollection<Binding>) =>
    value.items.map((v) => ({
      mcp_server_id: v.mcp_server_id,
      enabled: v.enabled,
    }));
  const [draft, setDraft] = useState(from(initial.data)),
    [baseline, setBaseline] = useState(from(initial.data)),
    [picking, setPicking] = useState(false);
  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline);
  const save = useResourceSave({
    enabled: !readOnly,
    path,
    initial,
    method: "PUT",
    dirty,
    adopt: (value) => {
      setDraft(from(value));
      setBaseline(from(value));
    },
    complete: onSaved,
  });
  const locked = save.pending || save.blocked;
  return (
    <Panel bodyClassName="p-6">
      <div className="space-y-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="font-semibold">
              MCP 服务绑定{" "}
              <span className="text-muted">{draft.length} / 32</span>
            </h2>
            <p className="mt-1 text-sm text-muted">
              启用后授权整个 MCP
              服务，包括后续新增的工具和资源。授权对象是此智能体，服务使用自身配置的凭据。
            </p>
          </div>
          {!readOnly && (
            <Button
              variant="outline"
              disabled={locked || draft.length >= 32}
              onClick={() => setPicking(true)}
            >
              添加服务
            </Button>
          )}
        </div>
        {save.recovery}
        {draft.length ? (
          <div className="divide-y rounded-lg border">
            {draft.map((b, index) => (
              <div
                key={b.mcp_server_id}
                className="flex items-center gap-4 p-4"
              >
                <MCPServerLabel id={b.mcp_server_id} />
                {readOnly ? (
                  <EnabledState enabled={b.enabled} />
                ) : (
                  <>
                    <Switch
                      aria-label={"启用 MCP 服务 " + b.mcp_server_id}
                      checked={b.enabled}
                      disabled={locked}
                      onCheckedChange={(enabled) =>
                        setDraft(
                          draft.map((v) => (v === b ? { ...v, enabled } : v)),
                        )
                      }
                    />
                    <Button
                      variant="ghost"
                      disabled={locked || index === 0}
                      onClick={() => {
                        const next = [...draft];
                        [next[index - 1], next[index]] = [
                          next[index],
                          next[index - 1],
                        ];
                        setDraft(next);
                      }}
                    >
                      上移
                    </Button>
                    <Button
                      variant="ghost"
                      disabled={locked}
                      onClick={() => setDraft(draft.filter((v) => v !== b))}
                    >
                      移除
                    </Button>
                  </>
                )}
              </div>
            ))}
          </div>
        ) : (
          <EmptyState title="尚未绑定 MCP 服务" />
        )}
        {!readOnly && (
          <ConfigActions
            dirty={dirty}
            pending={save.pending}
            blocked={save.blocked}
          >
            <Button
              disabled={locked || !dirty}
              pending={save.pending}
              onClick={() => void save.save({ items: draft })}
            >
              保存 MCP 绑定
            </Button>
            <Button
              variant="outline"
              disabled={locked || !dirty}
              onClick={() => setDraft(baseline)}
            >
              取消修改
            </Button>
          </ConfigActions>
        )}
        {picking && (
          <ResourcePicker<MCPServer>
            title="选择 MCP 服务"
            path={agentAdminRoot + "/mcp-servers"}
            identify={(v) => v.id}
            label={(v) => v.name}
            description={(v) => v.config.url + (v.enabled ? "" : " · 已停用")}
            disabled={(v) => draft.some((b) => b.mcp_server_id === v.id)}
            onChoose={(v) => {
              setDraft([
                ...draft,
                {
                  mcp_server_id: v.id,
                  enabled: true,
                },
              ]);
              setPicking(false);
            }}
            onClose={() => setPicking(false)}
          />
        )}
      </div>
    </Panel>
  );
}
function MCPServerLabel({ id }: { id: string }) {
  const query = useApiQuery<MCPServer>(
    ["agent-resources", "mcp", id],
    agentAdminRoot + "/mcp-servers/" + id,
  );
  return (
    <div className="min-w-0 flex-1">
      <Link
        to={"/admin/mcp-servers/" + id}
        className="text-sm font-medium hover:underline"
      >
        {query.data?.data.name ?? "MCP 服务 " + id}
      </Link>
      <p className="mt-1 truncate font-mono text-xs text-muted">
        {query.error
          ? "服务信息不可用，可移除绑定"
          : (query.data?.data.config.url ?? "加载中…")}
      </p>
    </div>
  );
}
