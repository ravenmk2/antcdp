import { CopyButton } from "@/components/copy-button";
import { DescriptionPreview } from "@/components/description-preview";
import { TableToolbar } from "@/components/table-toolbar";
import {
  Link,
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router";
import { ArrowRight, Cable, Plus } from "lucide-react";
import { Button } from "@/components/button";
import { AsyncBoundary, Notice, StatusBadge } from "@/components/feedback";
import { StandaloneInput, StandaloneSelect } from "@/components/fields";
import { PageHeader, Panel } from "@/components/layout";
import { SimpleTable } from "@/components/table";
import { OverlayPresence } from "@/components/overlay-presence";
import { ConnectionCreateDrawer } from "./connection-create-drawer";
import { useApiQuery } from "@/hooks/use-api";
import { providerFor } from "@/domain/service-providers";
import type { Resource } from "@/types/collaboration";
import type { ServiceConnection, ServiceType } from "@/types/integrations";
import { ConnectionDetail } from "./connection-detail";

export function IntegrationsPage() {
  const { connectionId, projectId } = useParams();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const admin = location.pathname.startsWith("/admin");
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
  if (
    connectionId &&
    !creating &&
    (directory.isPending ||
      types.isPending ||
      (!directory.data && directory.error) ||
      (!types.data && types.error) ||
      (projectId && (project.isPending || project.error)))
  )
    return (
      <div className="page">
        <AsyncBoundary
          loading={
            directory.isPending ||
            types.isPending ||
            Boolean(projectId && project.isPending)
          }
          error={directory.error ?? types.error ?? project.error}
          onRetry={() => {
            void directory.refetch();
            void types.refetch();
            if (projectId) void project.refetch();
          }}
        />
      </div>
    );
  if (connectionId && summary)
    return (
      <ConnectionDetail
        key={`${location.pathname}:${summary.id}`}
        summary={summary}
        admin={admin}
        project={project.data?.data}
        capabilities={types.data?.data.items ?? []}
      />
    );
  if (connectionId && !creating && directory.data && !summary)
    return (
      <div className="page">
        <Notice tone="danger">连接不存在或当前账号不可见。</Notice>
      </div>
    );
  return (
    <div className="page">
      <PageHeader
        title={admin ? "服务集成" : projectId ? "项目服务凭证" : "个人服务凭证"}
        description={
          admin
            ? "维护服务连接、归属凭证、首选/兜底、Webhook 与诊断。"
            : "选择服务连接，只维护当前归属的访问凭证；连接内部配置不会展示。"
        }
      />
      <Directory
        refreshing={directory.isFetching || types.isFetching}
        actions={
          admin && (
            <Button
              onClick={() => {
                const next = new URLSearchParams(location.search);
                next.set("create", "1");
                setParams(next);
              }}
            >
              <Plus />
              添加连接
            </Button>
          )
        }
        items={directory.data?.data.items ?? []}
        types={types.data?.data.items ?? []}
        loading={directory.isPending || types.isPending}
        error={directory.error ?? types.error}
        retry={() => {
          void directory.refetch();
          void types.refetch();
        }}
      />
      <OverlayPresence>
        {creating && <ConnectionCreateDrawer onClose={closeCreate} />}
      </OverlayPresence>
    </div>
  );
}

function Directory({
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
        emptyDescription="管理员可添加已实现的服务类型；不会显示未实现的占位服务。"
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
