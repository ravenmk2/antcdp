import { AsyncBoundary, Notice } from "@/components/feedback";
import { PageHeader } from "@/components/layout";
import { ConnectionDetail } from "@/features/integrations/connection-detail";

import {
  Directory,
  useIntegrationDirectory,
} from "@/features/integrations/directory";
export function IntegrationsPage() {
  const {
    connectionId,
    projectId,
    location,
    admin,
    types,
    directory,
    project,
    summary,
    creating,
  } = useIntegrationDirectory({ kind: "project" });
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
      <div className="page">
        {" "}
        <ConnectionDetail
          key={`${location.pathname}:${summary.id}`}
          summary={summary}
          admin={admin}
          project={project.data?.data}
          capabilities={types.data?.data.items ?? []}
          renderHeader={(props) => <PageHeader {...props} />}
        />
      </div>
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

        items={directory.data?.data.items ?? []}
        types={types.data?.data.items ?? []}
        loading={directory.isPending || types.isPending}
        error={directory.error ?? types.error}
        retry={() => {
          void directory.refetch();
          void types.refetch();
        }}
      />
    </div>
  );
}
