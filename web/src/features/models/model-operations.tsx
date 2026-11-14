import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FlaskConical, ScanSearch } from "lucide-react";
import { Button } from "@/components/button";
import { Drawer, OverlayCancelButton } from "@/components/overlays";
import {
  AsyncBoundary,
  ErrorNotice,
  Notice,
  StatusBadge,
} from "@/components/feedback";
import type {
  ModelProvider,
  ModelDefinition,
  ProviderType,
  ModelTestResult,
} from "@/types/models";
import { modelKeys, modelRequest } from "./model-api";
import { DiagnosticView } from "./model-shared";
import { ModelDiscoveryResults } from "./model-discovery";

export function ModelTestPanel({
  provider,
  type,
  kind,
  modelId,
  onClose,
}: {
  provider: ModelProvider;
  providerEtag: string;
  type: ProviderType;
  kind: "provider" | "model" | "discovery";
  modelId?: string;
  onClose: () => void;
}) {
  const target =
    kind === "model" ? `/definitions/${modelId}` : `/providers/${provider.id}`;
  const current = useQuery({
    queryKey: [...modelKeys, "test-config", target],
    queryFn: ({ signal }) =>
      modelRequest<ModelProvider | ModelDefinition>(target, { signal }),
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnMount: "always",
    gcTime: 0,
  });
  const [levels, setLevels] = useState(["generation"]);
  const [pending, setPending] = useState(false);
  const [stopped, setStopped] = useState(false);
  const [error, setError] = useState<unknown>();
  const [result, setResult] = useState<ModelTestResult>();
  const controller = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      controller.current?.abort();
      controller.current = null;
    },
    [],
  );
  function stop() {
    controller.current?.abort();
    controller.current = null;
    setPending(false);
    setStopped(true);
  }
  function close() {
    controller.current?.abort();
    controller.current = null;
    onClose();
  }
  async function run() {
    if (controller.current || !current.data?.etag) return;
    const active = new AbortController();
    controller.current = active;
    setPending(true);
    setStopped(false);
    setResult(undefined);
    setError(undefined);
    try {
      const response = await modelRequest<ModelTestResult>(
        `${target}/${kind === "discovery" ? "model-discovery" : "test"}`,
        {
          method: "POST",
          etag: current.data.etag,
          signal: active.signal,
          body:
            kind === "model"
              ? { levels }
              : kind === "provider"
                ? { level: "connectivity" }
                : {},
        },
      );
      if (controller.current === active) setResult(response.data);
    } catch (e) {
      if (controller.current === active && !active.signal.aborted) setError(e);
    } finally {
      if (controller.current === active) {
        controller.current = null;
        setPending(false);
      }
    }
  }
  const title =
    kind === "discovery"
      ? "发现模型"
      : kind === "model"
        ? "模型能力测试"
        : "测试连接";
  return (
    <Drawer
      open
      wide
      title={title}
      description={kind === "model" ? current.data?.data.name : provider.name}
      onClose={close}
      footer={<OverlayCancelButton>关闭</OverlayCancelButton>}
    >
      <div className="space-y-5">
        <AsyncBoundary
          loading={current.isPending}
          error={current.error}
          onRetry={() => void current.refetch()}
        >
          <p className="text-sm text-muted">
            {kind === "discovery"
              ? "获取远端模型后，选择并配置需要添加的模型。"
              : "对已保存配置发送有界测试请求，仅展示本次结果。"}
          </p>
          {kind === "model" && (
            <div className="flex flex-wrap gap-4">
              {[
                ["generation", "文本生成"],
                ["tools", "工具调用"],
                ["stream", "流式输出"],
                ["thinking", "思考"],
              ].map(([value, label]) => (
                <label key={value} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="size-4 accent-primary"
                    checked={levels.includes(value)}
                    disabled={pending}
                    onChange={(e) =>
                      setLevels((old) =>
                        e.target.checked
                          ? [...old, value]
                          : old.filter((item) => item !== value),
                      )
                    }
                  />
                  {label}
                </label>
              ))}
            </div>
          )}
          <div className="flex items-center gap-3">
            <Button
              pending={pending}
              disabled={
                current.isFetching ||
                !current.data?.etag ||
                !current.data?.data.enabled ||
                !provider.enabled ||
                (kind === "model" && !levels.length)
              }
              onClick={() => void run()}
            >
              {kind === "discovery" ? <ScanSearch /> : <FlaskConical />}
              {kind === "discovery" ? "获取模型" : "开始测试"}
            </Button>
            {pending && (
              <>
                <StatusBadge tone="info">
                  {kind === "discovery" ? "获取中" : "测试中"}
                </StatusBadge>
                <Button variant="ghost" onClick={stop}>
                  停止等待
                </Button>
              </>
            )}
          </div>
        </AsyncBoundary>
        {stopped && (
          <Notice tone="warning">
            已停止等待；远端可能已收到请求，本次结果不再展示。
          </Notice>
        )}
        <ErrorNotice error={error} />
        {Boolean(error) && (
          <Button variant="outline" onClick={() => void current.refetch()}>
            刷新配置
          </Button>
        )}
        {result?.diagnostic && (
          <DiagnosticView diagnostic={result.diagnostic} />
        )}
        {result?.models && (
          <>
            <div className="flex items-center gap-2">
              <StatusBadge tone="success">获取成功</StatusBadge>
              <span className="text-sm text-muted">
                {result.models.length} 个模型
              </span>
            </div>
            {result.truncated && (
              <Notice tone="warning">
                结果已截断，仅展示服务返回的部分模型。
              </Notice>
            )}
            <ModelDiscoveryResults
              provider={provider}
              type={type}
              models={result.models}
            />
          </>
        )}
      </div>
    </Drawer>
  );
}
