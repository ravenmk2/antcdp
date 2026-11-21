import { useState } from "react";
import { request } from "@/api/client";
import { Button } from "@/components/button";
import { AsyncBoundary, ErrorNotice } from "@/components/feedback";
import { Panel } from "@/components/layout";
import { useApiQuery } from "@/hooks/use-api";
import type { SandboxConnection } from "@/types/cloud-computer";
import { sandboxAdminRoot } from "../data/agent-api";

export function ConnectionEditor() {
  const path = sandboxAdminRoot + "/connection";
  const query = useApiQuery<SandboxConnection>(["sandbox-connection"], path);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<unknown>();
  const connection = query.data?.data;
  async function check() {
    setChecking(true);
    setError(undefined);
    try {
      await request(path + "/health-check", { method: "POST", body: {} });
      await query.refetch();
    } catch (cause) {
      setError(cause);
    } finally {
      setChecking(false);
    }
  }
  return (
    <AsyncBoundary
      loading={query.isPending}
      error={query.error}
      onRetry={() => query.refetch()}
    >
      {connection && (
        <Panel title="服务连接">
          <div className="grid gap-4 p-5">
            <p>由部署配置 config.toml 管理。</p>
            {connection.configured ? (
              <>
                <dl className="grid grid-cols-[max-content_1fr] gap-x-5 gap-y-2">
                  <dt>服务类型</dt>
                  <dd>{connection.type}</dd>
                  <dt>服务地址</dt>
                  <dd>{connection.endpoint}</dd>
                  <dt>访问模式</dt>
                  <dd>{connection.access_mode}</dd>
                  <dt>连接超时</dt>
                  <dd>{connection.connect_timeout_seconds} 秒</dd>
                  <dt>操作超时</dt>
                  <dd>{connection.operation_timeout_seconds} 秒</dd>
                  <dt>最近检查</dt>
                  <dd>
                    {connection.last_diagnostic
                      ? connection.last_diagnostic.healthy
                        ? "连接正常"
                        : connection.last_diagnostic.error_code
                      : "尚未检查"}
                  </dd>
                </dl>
                {connection.maintenance_state === "blocked" ? (
                  <p>
                    仍有资源绑定到先前的沙箱服务。请恢复原部署配置并核对资源。
                  </p>
                ) : (
                  <Button
                    className="justify-self-start"
                    pending={checking}
                    onClick={() => void check()}
                  >
                    检查连接
                  </Button>
                )}
              </>
            ) : (
              <p>尚未配置沙箱服务</p>
            )}
            <ErrorNotice error={error} />
          </div>
        </Panel>
      )}
    </AsyncBoundary>
  );
}
