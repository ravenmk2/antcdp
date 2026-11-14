import { Notice } from "@/components/feedback";
import { PageHeader } from "@/components/layout";

import {
  HostDetail,
  HostDirectory,
  useHostDirectory,
} from "@/features/remote-hosts/directory";
export function RemoteHostsPage() {
  const { hostId, projectId, admin, directory, project, selected, creating } =
    useHostDirectory({ kind: "account" });
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
        title={
          admin ? "远程主机" : projectId ? "项目 SSH 凭证" : "个人 SSH 凭证"
        }
        description={
          admin
            ? "维护 SSH 主机、公钥信任、归属凭证与连接诊断。"
            : "选择主机并维护当前归属凭证；主机地址和公钥信任由系统管理员管理。"
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
