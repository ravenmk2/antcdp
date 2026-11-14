import { CopyButton } from "@/components/copy-button";
import { DescriptionPreview } from "@/components/description-preview";
import { AsyncBoundary, StatusBadge } from "@/components/feedback";
import { StandaloneInput, StandaloneSelect } from "@/components/fields";
import { Panel } from "@/components/layout";
import { SimpleTable } from "@/components/table";
import { TableToolbar } from "@/components/table-toolbar";
import { providerFor } from "@/domain/service-providers";
import { useApiQuery } from "@/hooks/use-api";
import type { Resource } from "@/types/collaboration";
import type { ServiceConnection, ServiceType } from "@/types/integrations";
import { ArrowRight, Cable } from "lucide-react";
import {
  Link,
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router";

export type IntegrationContext =
  { kind: "system" } | { kind: "account" } | { kind: "project" };
export function useIntegrationDirectory(context: IntegrationContext) {
  const { connectionId, projectId: routeProjectId } = useParams();
  const projectId = context.kind === "project" ? routeProjectId : undefined;
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const admin = context.kind === "system";
  const types = useApiQuery<{ items: ServiceType[] }>(
    ["service-types"],
    "/service-types",
  );
  const directory = useApiQuery<{ items: ServiceConnection[] }>(
    ["service-directory"],
    "/service-connections",
  );
  const project = useApiQuery<Resource>(
    ["project", projectId],
    `/projects/${projectId ?? ""}`,
    { enabled: Boolean(projectId) },
  );
  const summary = directory.data?.data.items.find(
    (item) => item.id === connectionId,
  );
  const creating =
    admin && (params.get("create") === "1" || connectionId === "new");
  function closeCreate() {
    const next = new URLSearchParams(params);
    next.delete("create");
    navigate(
      { pathname: "/admin/integrations", search: next.toString() },
      { replace: true },
    );
  }
  return {
    connectionId,
    projectId,
    location,
    params,
    setParams,
    navigate,
    admin,
    types,
    directory,
    project,
    summary,
    creating,
    closeCreate,
  };
}

export function Directory({
  actions,
  refreshing,
  items,
  types,
  loading,
  error,
  retry,
}: {
  actions?: React.ReactNode;
  refreshing: boolean;
  items: ServiceConnection[];
  types: ServiceType[];
  loading: boolean;
  error: unknown;
  retry: () => void;
}) {
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "";
  const type = params.get("type") ?? "";
  const status = params.get("status") ?? "";
  const filtered = items.filter(
    (item) =>
      (!q ||
        `${item.name} ${item.code} ${item.description}`
          .toLowerCase()
          .includes(q.toLowerCase())) &&
      (!type || item.service_type === type) &&
      (!status || item.enabled === (status === "enabled")),
  );
  function filter(key: string, value: string) {
    setParams((current) => {
      const next = new URLSearchParams(current);
      if (value) next.set(key, value);
      else next.delete(key);
      return next;
    });
  }
  return (
    <Panel bodyClassName="p-0">
      <TableToolbar
        onReset={() => setParams({})}
        onRefresh={retry}
        refreshing={refreshing}
        actions={actions}
      >
        <form
          className="flex shrink-0 items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            filter(
              "q",
              String(new FormData(event.currentTarget).get("q") ?? ""),
            );
          }}
        >
          <StandaloneInput
            name="q"
            aria-label="搜索服务连接"
            defaultValue={q}
            placeholder="搜索名称、编码或说明"
          />
        </form>
        <StandaloneSelect
          aria-label="服务类型"
          value={type}
          onValueChange={(value) => filter("type", value)}
        >
          <option value="">全部服务</option>
          {[
            ...new Set([
              ...types.map((item) => item.service_type),
              ...items.map((item) => item.service_type),
            ]),
          ].map((value) => (
            <option key={value} value={value}>
              {providerFor(value)?.name ?? value} ·{" "}
              {items.filter((item) => item.service_type === value).length}
            </option>
          ))}
        </StandaloneSelect>
        <StandaloneSelect
          aria-label="连接状态"
          value={status}
          onValueChange={(value) => filter("status", value)}
        >
          <option value="">全部状态</option>
          <option value="enabled">已启用</option>
          <option value="disabled">已停用</option>
        </StandaloneSelect>
      </TableToolbar>
      <AsyncBoundary
        loading={loading}
        error={error}
        onRetry={retry}
        empty={!filtered.length}
        emptyTitle={
          q || type || status ? "没有匹配的服务连接" : "还没有服务连接"
        }
        emptyDescription={
          q || type || status
            ? "请调整关键词、服务类型或状态筛选。"
            : "服务连接由系统管理员添加，添加后可在此配置访问凭证。"
        }
      >
        <SimpleTable
          actions
          label="服务连接"
          headers={["连接", "编码", "服务类型", "启停", "操作"]}
        >
          {filtered.map((item) => (
            <tr key={item.id}>
              <td>
                <div className="flex min-w-52 items-center gap-3">
                  <ServiceIcon type={item.service_type} />
                  <div className="flex min-w-0 items-center gap-1">
                    <Link
                      className="min-w-0 max-w-sm whitespace-normal break-all font-medium text-foreground hover:text-primary"
                      to={`${location.pathname.replace(/\/$/, "")}/${item.id}?${params}`}
                    >
                      {item.name}
                    </Link>
                    {item.description && (
                      <DescriptionPreview
                        name={item.name}
                        description={item.description}
                        label="连接说明"
                      />
                    )}
                  </div>
                </div>
              </td>
              <td>
                <div className="flex items-center gap-2">
                  <code className="min-w-0 max-w-64 whitespace-normal break-all text-xs">
                    {item.code}
                  </code>
                  <CopyButton
                    value={item.code}
                    label={`复制 ${item.name} 的连接编码`}
                  />
                </div>
              </td>
              <td>
                {providerFor(item.service_type)?.name ?? item.service_type}
              </td>
              <td>
                <StatusBadge tone={item.enabled ? "success" : "neutral"}>
                  {item.enabled ? "已启用" : "已停用"}
                </StatusBadge>
              </td>
              <td>
                <Link
                  className="link inline-flex"
                  aria-label={`查看 ${item.name}`}
                  to={`${location.pathname.replace(/\/$/, "")}/${item.id}?${params}`}
                >
                  <ArrowRight className="size-4" />
                </Link>
              </td>
            </tr>
          ))}
        </SimpleTable>
      </AsyncBoundary>
    </Panel>
  );
}

function ServiceIcon({ type }: { type: string }) {
  return (
    <span className="resource-icon">
      {providerFor(type) ? (
        <img src={`/service-icons/${type}.svg`} alt="" className="size-5" />
      ) : (
        <Cable className="size-5" />
      )}
    </span>
  );
}
