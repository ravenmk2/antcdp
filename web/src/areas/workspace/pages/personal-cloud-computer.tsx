import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { request } from "@/api/client";
import { Button } from "@/components/button";
import {
  AsyncBoundary,
  EmptyState,
  ErrorNotice,
  Notice,
} from "@/components/feedback";
import { PageHeader, Panel } from "@/components/layout";
import type { CloudComputer } from "@/types/cloud-computer";
import { agentRoot } from "@/features/agents/data/agent-api";
import { ComputerFacts } from "@/features/agents/cloud/computer-view";
import { WorkspaceFiles } from "@/features/agents/sandbox/workspace-files";
import { sandboxKeys } from "@/features/agents/sandbox/shared";

export function PersonalCloudComputerPage() {
  const [pending, setPending] = useState(false),
    [error, setError] = useState<unknown>();
  const query = useQuery({
    queryKey: [...sandboxKeys, "personal"],
    queryFn: ({ signal }) =>
      request<CloudComputer | null>(`${agentRoot}/cloud-computer`, { signal }),
    retry: false,
    refetchInterval: (q) =>
      q.state.data?.data?.state === "provisioning" ? 3000 : false,
  });
  const computer = query.data?.data;
  async function activate() {
    setPending(true);
    setError(undefined);
    try {
      await request(`${agentRoot}/cloud-computer/activate`, {
        method: "POST",
        body: {},
      });
      await query.refetch();
    } catch (e) {
      setError(e);
    } finally {
      setPending(false);
    }
  }
  return (
    <div className="page space-y-6">
      <PageHeader
        title="我的云电脑"
        description="你的交互型会话共用这台电脑，可并行运行并共享文件。文件长期保留，项目目录各自独立。"
        actions={
          <Button
            variant="outline"
            pending={query.isFetching}
            onClick={() => void query.refetch()}
          >
            刷新状态
          </Button>
        }
      />
      <ErrorNotice error={error} />
      <AsyncBoundary
        loading={query.isPending}
        error={query.error}
        onRetry={() => query.refetch()}
      >
        {computer ? (
          <Panel bodyClassName="p-6">
            <ComputerFacts computer={computer} />
            {["uninitialized", "paused", "unavailable"].includes(
              computer.state,
            ) && (
              <div className="mt-5">
                <Button pending={pending} onClick={() => void activate()}>
                  {computer.state === "paused" ? "唤醒电脑" : "准备电脑"}
                </Button>
              </div>
            )}
          </Panel>
        ) : (
          <Panel bodyClassName="p-8">
            <EmptyState
              title="电脑将在首次使用时创建"
              description="现在准备电脑，或在对话需要命令、文件或技能时自动准备。"
            />
            <div className="mt-5 flex justify-center">
              <Button pending={pending} onClick={() => void activate()}>
                准备我的云电脑
              </Button>
            </div>
          </Panel>
        )}
        {computer?.state === "ready" ? (
          <Panel title="云电脑文件" bodyClassName="p-5">
            <WorkspaceFiles computerId={computer.id} />
          </Panel>
        ) : computer?.state === "provisioning" ? (
          <Notice>
            正在准备运行环境，离开页面不会中断。准备完成后即可查看文件。
          </Notice>
        ) : null}
      </AsyncBoundary>
    </div>
  );
}
