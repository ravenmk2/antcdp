import { Button } from "@/components/button";
import { ConsoleListPage } from "@/areas/console/components/list-page";
import { Notice } from "@/components/feedback";
import { PageHeader } from "@/components/layout";
import { OverlayPresence } from "@/components/overlay-presence";
import { Plus } from "lucide-react";

import { HostCreateDrawer } from "@/features/remote-hosts/host-create-drawer";

import {
  HostDetail,
  HostDirectory,
  useHostDirectory,
} from "@/features/remote-hosts/directory";
export function RemoteHostsPage({
  project: projectScope = false,
}: {
  project?: boolean;
}) {
  const {
    hostId,
    projectId,
    setParams,
    admin,
    directory,
    project,
    selected,
    creating,
    closeCreate,
  } = useHostDirectory({ kind: projectScope ? "project" : "platform" });
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
    <ConsoleListPage nested>
      <PageHeader
        title={admin ? "远程主机" : projectId ? "项目远程主机" : "个人远程主机"}
        description={
          admin
            ? "维护 SSH 主机、公钥信任、首选凭据和连接诊断。"
            : "选择远程主机，配置当前范围的首选凭据。"
        }
      />
      <HostDirectory
        refreshing={directory.isFetching}
        actions={
          admin && (
            <Button
              onClick={() => {
                setParams((current) => {
                  const next = new URLSearchParams(current);
                  next.set("create", "1");
                  return next;
                });
              }}
            >
              <Plus />
              添加主机
            </Button>
          )
        }
        items={directory.data?.data.items ?? []}
        loading={directory.isPending}
        error={directory.error}
        retry={() => void directory.refetch()}
      />
      <OverlayPresence>
        {creating && <HostCreateDrawer onClose={closeCreate} />}
      </OverlayPresence>
    </ConsoleListPage>
  );
}
