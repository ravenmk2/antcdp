import { Link } from "react-router";
import { Button } from "@/components/button";
import { AsyncBoundary, StatusBadge } from "@/components/feedback";
import { StandaloneInput } from "@/components/fields";
import { PageHeader, Panel } from "@/components/layout";
import { Pagination } from "@/components/pagination";
import { SimpleTable } from "@/components/table";
import { useApiQuery } from "@/hooks/use-api";
import { useDebouncedSearch } from "@/hooks/use-search";
import { useListParams } from "@/features/agents/resources/admin-shared";
import type { User } from "@/types/auth";

export function RobotsPage() {
  const { params, page, size, change } = useListParams();
  const q = params.get("q") ?? "";
  const search = useDebouncedSearch(q, (value) =>
    change({ q: value, page: "1" }),
  );
  const query = useApiQuery<(User & { managed_agent_id: string | null })[]>(
    ["robots", q, page, size],
    `/admin/robots?${new URLSearchParams({ q, page: String(page), page_size: String(size) })}`,
  );
  return (
    <div className="page">
      <PageHeader
        title="机器人账号"
        description="服务型智能体创建的专属执行账号。账号不能登录，资料、权限和凭据通过所属智能体管理。"
      />
      <Panel bodyClassName="space-y-5 p-5">
        <div className="flex items-center justify-between">
          <StandaloneInput
            aria-label="搜索机器人"
            placeholder="搜索名称或账号"
            className="max-w-sm"
            value={search.value}
            onChange={(e) => search.setValue(e.target.value)}
          />
          <Button
            variant="outline"
            pending={query.isFetching}
            onClick={() => void query.refetch()}
          >
            刷新
          </Button>
        </div>
        <AsyncBoundary
          loading={query.isPending}
          error={query.error}
          onRetry={() => query.refetch()}
          empty={query.data?.data.length === 0}
          emptyTitle="暂无机器人账号"
        >
          <SimpleTable
            label="机器人账号"
            headers={["机器人", "状态", "所属智能体"]}
          >
            {query.data?.data.map((user) => (
              <tr key={user.id}>
                <td>
                  <strong>{user.display_name}</strong>
                  <p className="mt-1 text-xs text-muted">{user.username}</p>
                </td>
                <td>
                  <StatusBadge
                    tone={user.status === "active" ? "success" : "neutral"}
                  >
                    {user.status === "active" ? "已启用" : "已停用"}
                  </StatusBadge>
                </td>
                <td>
                  {user.managed_agent_id ? (
                    <Link
                      className="text-primary"
                      to={`/admin/agents/${user.managed_agent_id}?tab=resources`}
                    >
                      管理所属智能体
                    </Link>
                  ) : (
                    "—"
                  )}
                </td>
              </tr>
            ))}
          </SimpleTable>
          <Pagination
            page={page}
            size={size}
            total={query.data?.pagination?.total}
            pending={query.isFetching}
            onChange={(next, count) =>
              change({ page: String(next), page_size: String(count) })
            }
          />
        </AsyncBoundary>
      </Panel>
    </div>
  );
}
