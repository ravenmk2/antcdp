import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { request } from "@/api/client";
import { Button } from "@/components/button";
import {
  AsyncBoundary,
  EmptyState,
  ErrorNotice,
  Notice,
} from "@/components/feedback";
import type { CloudComputer } from "@/types/cloud-computer";
import { agentRoot } from "@/features/agents/data/agent-api";
import { ComputerWorkbench } from "@/features/agents/cloud/computer-workbench";
import { sandboxKeys } from "@/features/agents/sandbox/shared";

export function PersonalCloudComputerPage() {
  const cache = useQueryClient();
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
      await cache.invalidateQueries({ queryKey: sandboxKeys });
    } catch (e) {
      setError(e);
    } finally {
      setPending(false);
    }
  }
  return (
    <div className="cloud-computer-page">
      <ErrorNotice error={error} />
      <AsyncBoundary
        loading={query.isPending}
        error={query.error}
        onRetry={() => query.refetch()}
      >
        <ComputerWorkbench
          key={computer?.id || "empty"}
          computer={computer || null}
        >
          {(current) =>
            current ? (
              <div className="space-y-5 text-center">
                {["uninitialized", "paused", "unavailable"].includes(
                  current.state,
                ) && (
                  <div className="mt-5">
                    <Button pending={pending} onClick={() => void activate()}>
                      {current.state === "paused" ? "唤醒电脑" : "准备电脑"}
                    </Button>
                  </div>
                )}
                {current.state === "provisioning" && (
                  <Notice>
                    正在准备运行环境，离开页面不会中断。准备完成后即可查看文件。
                  </Notice>
                )}
                {["deleting", "deleted"].includes(current.state) && (
                  <Notice>
                    云电脑
                    {current.state === "deleting" ? "正在删除" : "已永久删除"}
                    ，文件暂不可用。
                  </Notice>
                )}
              </div>
            ) : (
              <div>
                <EmptyState
                  title="电脑将在首次使用时创建"
                  description="现在准备电脑，或在对话需要命令、文件或技能时自动准备。"
                />
                <div className="mt-5 flex justify-center">
                  <Button pending={pending} onClick={() => void activate()}>
                    准备我的云电脑
                  </Button>
                </div>
              </div>
            )
          }
        </ComputerWorkbench>
      </AsyncBoundary>
    </div>
  );
}
