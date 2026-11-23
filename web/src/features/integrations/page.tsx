import { Button } from "@/components/button";
import { AsyncBoundary, Notice } from "@/components/feedback";
import { PageHeader } from "@/components/layout";
import { OverlayPresence } from "@/components/overlay-presence";
import { ConnectionCreateDrawer } from "@/features/integrations/connection-create-drawer";
import { ConnectionDetail } from "@/features/integrations/connection-detail";
import { Plus } from "lucide-react";

import {
  Directory,
  useIntegrationDirectory,
  type IntegrationContext,
} from "@/features/integrations/directory";
export function IntegrationPage({
  context,
  divided = false,
}: {
  context: IntegrationContext;
  divided?: boolean;
}) {
  const {
    connectionId,
    projectId,
    location,
    setParams,
    admin,
    types,
    directory,
    project,
    summary,
    creating,
    canCreate,
    listPath,
    closeCreate,
  } = useIntegrationDirectory(context);
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
        title={admin ? "服务集成" : projectId ? "项目服务连接" : "个人服务连接"}
        variant={divided ? "divided" : "default"}
        description={
          admin
            ? "维护平台连接、项目与团队授权、平台凭证及 Webhook。"
            : projectId
              ? "使用平台授权的连接，或创建并维护项目自己的连接。"
              : "选择服务连接，配置个人首选凭据。"
        }
      />
      <Directory
        refreshing={directory.isFetching || types.isFetching}
        actions={
          canCreate && (
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
        {creating && (
          <ConnectionCreateDrawer
            onClose={closeCreate}
            projectId={projectId}
            listPath={listPath}
          />
        )}
      </OverlayPresence>
    </div>
  );
}
