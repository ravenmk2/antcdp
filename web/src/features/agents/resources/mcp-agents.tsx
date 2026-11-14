import { useState } from "react";
import { Link } from "react-router";
import { useApiQuery } from "@/hooks/use-api";
import { agentAdminRoot } from "@/features/agents/data/agent-api";
import { AsyncBoundary, EmptyState } from "@/components/feedback";
import { SimpleTable } from "@/components/table";
import { Pagination } from "@/components/pagination";
import { EnabledState } from "./admin-shared";

export function MCPAgents({ serverId }: { serverId: string }) {
  const [page, setPage] = useState(1),
    [size, setSize] = useState(20);
  const query = useApiQuery<
    {
      id: string;
      name: string;
      enabled: boolean;
      binding_enabled: boolean;
    }[]
  >(
    ["agent-resources", "mcp", serverId, "agents", page, size],
    `${agentAdminRoot}/mcp-servers/${serverId}/agents?page=${page}&page_size=${size}`,
  );
  return (
    <AsyncBoundary
      loading={query.isPending}
      error={query.error}
      onRetry={() => query.refetch()}
    >
      {query.data?.data.length ? (
        <SimpleTable
          headers={["智能体", "服务绑定", "智能体状态"]}
          label="使用此 MCP 服务的智能体"
        >
          {query.data.data.map((agent) => (
            <tr key={agent.id}>
              <td>
                <Link
                  to={`/admin/agents/${agent.id}?tab=tools`}
                  className="font-medium text-primary hover:underline"
                >
                  {agent.name}
                </Link>
              </td>
              <td>
                <EnabledState enabled={agent.binding_enabled} />
              </td>
              <td>
                <EnabledState enabled={agent.enabled} />
              </td>
            </tr>
          ))}
        </SimpleTable>
      ) : (
        <EmptyState
          title="暂无智能体绑定此服务"
          description="在智能体的工具配置中添加整个 MCP 服务。"
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
  );
}
