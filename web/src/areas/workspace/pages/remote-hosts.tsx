import { Notice } from "@/components/feedback";
import { PageHeader } from "@/components/layout";

import {
  HostDetail,
  HostDirectory,
  useHostDirectory,
} from "@/features/remote-hosts/directory";
export function RemoteHostsPage({
  scope = "project",
}: {
  scope?: "account" | "project";
}) {
  const { hostId, projectId, admin, directory, project, selected, creating } =
    useHostDirectory({ kind: scope });
  if (hostId && selected)
    return (
      <div className="page">
        {" "}
        <HostDetail
          key={selected.id}
          summary={selected}
          admin={admin}
          project={project.data?.data}
          renderHeader={(props) => <PageHeader {...props} />}
        />
      </div>
    );
  if (hostId && !creating && directory.data && !selected)
    return (
      <div className="page">
        <Notice tone="danger">主机不存在或当前账号不可见。</Notice>
      </div>
    );
  return (
    <div className="page">
      <PageHeader
        variant="divided"
        title={admin ? "远程主机" : projectId ? "项目远程主机" : "个人远程主机"}
        description={
          admin
            ? "维护 SSH 主机、公钥信任、首选凭据和连接诊断。"
            : "选择远程主机，配置当前范围的首选凭据。"
        }
      />
      <HostDirectory
        refreshing={directory.isFetching}
        items={directory.data?.data.items ?? []}
        loading={directory.isPending}
        error={directory.error}
        retry={() => void directory.refetch()}
      />
    </div>
  );
}
