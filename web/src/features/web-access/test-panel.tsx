import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/button";
import { Field, Select } from "@/components/fields";
import { AsyncBoundary, ErrorNotice, Notice } from "@/components/feedback";
import { Drawer, OverlayCancelButton } from "@/components/overlays";
import type { WebAccessProvider, WebOperation } from "@/types/agent-resources";
import { webRequest, webAccessKeys } from "./api";
import {
  capabilityLabel,
  WebDiagnosticView,
  type WebDiagnostic,
} from "./shared";

export function TestPanel({
  provider,
  onClose,
}: {
  provider: WebAccessProvider;
  onClose: () => void;
}) {
  const cache = useQueryClient();
  const current = useQuery({
    queryKey: [...webAccessKeys, "test-config", provider.id],
    queryFn: ({ signal }) =>
      webRequest<WebAccessProvider>(`/providers/${provider.id}`, { signal }),
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnMount: "always",
    gcTime: 0,
  });
  const [operation, setOperation] = useState<WebOperation>(
    provider.supported_operations[0],
  );
  const [pending, setPending] = useState(false),
    [stopped, setStopped] = useState(false),
    [error, setError] = useState<unknown>(),
    [result, setResult] = useState<WebDiagnostic>();
  const controller = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      controller.current?.abort();
      controller.current = null;
      void cache.invalidateQueries({ queryKey: webAccessKeys });
    },
    [cache],
  );
  function stop() {
    controller.current?.abort();
    controller.current = null;
    setPending(false);
    setStopped(true);
    void cache.invalidateQueries({ queryKey: webAccessKeys });
  }
  async function run() {
    if (controller.current || !current.data?.etag) return;
    const active = new AbortController();
    controller.current = active;
    setPending(true);
    setStopped(false);
    setError(undefined);
    setResult(undefined);
    try {
      const response = await webRequest<{
        operation: WebOperation;
        diagnostic: WebDiagnostic;
      }>(`/providers/${provider.id}/test`, {
        method: "POST",
        etag: current.data.etag,
        body: { operation },
        signal: active.signal,
      });
      if (controller.current === active) setResult(response.data.diagnostic);
    } catch (e) {
      if (controller.current === active && !active.signal.aborted) setError(e);
    } finally {
      if (controller.current === active) {
        controller.current = null;
        setPending(false);
      }
      void cache.invalidateQueries({ queryKey: webAccessKeys });
    }
  }
  return (
    <Drawer
      open
      title="测试连接"
      description={provider.name}
      onClose={() => {
        stop();
        onClose();
      }}
      footer={<OverlayCancelButton>关闭</OverlayCancelButton>}
    >
      <div className="space-y-5">
        <AsyncBoundary
          loading={current.isPending}
          error={current.error}
          onRetry={() => void current.refetch()}
        >
          <p className="text-sm text-muted">
            使用固定公开输入测试已保存配置，最多等待 30
            秒。每项能力保留最近一次结果。
          </p>
          <Field label="测试能力">
            <Select
              value={operation}
              disabled={pending}
              onValueChange={(v) => {
                setOperation(v as WebOperation);
                setResult(undefined);
                setStopped(false);
              }}
            >
              {provider.supported_operations.map((op) => (
                <option key={op} value={op}>
                  {capabilityLabel[op]}
                </option>
              ))}
            </Select>
          </Field>
          <div className="flex gap-2">
            <Button
              pending={pending}
              disabled={
                pending ||
                !current.data?.etag ||
                !current.data.data.enabled ||
                !current.data.data.authentication.has_secret
              }
              onClick={() => void run()}
            >
              开始测试
            </Button>
            {pending && (
              <Button variant="outline" onClick={stop}>
                停止测试
              </Button>
            )}
          </div>
        </AsyncBoundary>
        <ErrorNotice error={error} />
        {stopped && (
          <Notice tone="warning">
            已停止等待；这不能证明远端没有执行。可关闭面板后刷新最近诊断核对。
          </Notice>
        )}
        {result && <WebDiagnosticView value={result} />}
      </div>
    </Drawer>
  );
}
