import { useState } from "react";
import { request } from "@/api/client";
import { Button } from "@/components/button";
import { AsyncBoundary, ErrorNotice, Notice } from "@/components/feedback";
import { CopyButton } from "@/components/copy-button";
import { Field, Input, Select } from "@/components/fields";
import { Panel } from "@/components/layout";
import { useApiQuery } from "@/hooks/use-api";
import { useFormErrors, useSubmission } from "@/hooks/use-form";
import { diagnosticText, diagnosticTone } from "@/domain/service-providers";
import type { Diagnostic, WebhookSettings } from "@/types/integrations";

export function WebhookPanel({
  base,
  methods,
}: {
  base: string;
  connectionEnabled: boolean;
  methods: string[];
}) {
  const settings = useApiQuery<WebhookSettings>(["webhook", base], base);
  const receiver = useApiQuery<{ receive_url: string }>(
    ["webhook-receiver", base],
    `${base}/receiver`,
  );
  const diagnostics = useApiQuery<{ latest: Diagnostic | null }>(
    ["webhook-diagnostics", base],
    `${base}/diagnostics`,
  );
  const [method, setMethod] = useState("");
  const [secret, setSecret] = useState("");
  const [generated, setGenerated] = useState("");
  const errors = useFormErrors();
  const submission = useSubmission();
  async function refresh() {
    await Promise.all([settings.refetch(), diagnostics.refetch()]);
  }
  return (
    <div className="grid gap-5">
      <Panel title="Webhook 接收设置">
        <AsyncBoundary
          loading={settings.isPending || receiver.isPending}
          error={settings.error ?? receiver.error}
          onRetry={() => {
            void settings.refetch();
            void receiver.refetch();
          }}
        >
          {settings.data && receiver.data && (
            <>
              <Notice className="mb-4">
                每个连接只有一个接收地址。轮换秘密后，所有使用此地址的远端 Hook
                都必须同步更新；其他连接不受影响。
              </Notice>
              <div className="mb-4 flex items-center gap-2 rounded-lg bg-surface-subtle p-3">
                <code className="min-w-0 flex-1 break-all text-xs">
                  {receiver.data.data.receive_url}
                </code>
                <CopyButton
                  value={receiver.data.data.receive_url}
                  label="复制接收地址"
                />
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <span>
                  接收状态：{settings.data.data.enabled ? "已启用" : "已停用"}
                </span>
                <span>
                  秘密：{settings.data.data.has_secret ? "已配置" : "未配置"}
                </span>
                <Button
                  variant="outline"
                  pending={submission.pending}
                  onClick={() =>
                    void submission.run(async () => {
                      await request(base, {
                        method: "PATCH",
                        etag: settings.data?.etag,
                        body: { enabled: !settings.data?.data.enabled },
                      });
                      await refresh();
                    })
                  }
                >
                  {settings.data.data.enabled ? "停用接收" : "启用接收"}
                </Button>
              </div>
              <form
                ref={errors.formRef}
                className="mt-6 grid gap-4 border-t pt-5"
                onSubmit={(event) => {
                  event.preventDefault();
                }}
              >
                <ErrorNotice error={errors.error} />
                <ErrorNotice error={submission.error} />
                <Field label="验证方式">
                  <Select
                    value={method || settings.data.data.verification_method}
                    onValueChange={(value) => setMethod(value)}
                  >
                    {methods.map((value) => (
                      <option key={value} value={value}>
                        {value}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field
                  label="新验证秘密"
                  hint="导入会同时更换验证方式；不会自动启用接收"
                >
                  <Input
                    type="password"
                    autoComplete="off"
                    value={secret}
                    onChange={(event) => setSecret(event.target.value)}
                  />
                </Field>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    disabled={!secret}
                    pending={submission.pending}
                    onClick={() =>
                      void submission.run(
                        async () => {
                          await request(`${base}/verification`, {
                            method: "PUT",
                            etag: settings.data?.etag,
                            body: {
                              verification_method:
                                method ||
                                settings.data.data.verification_method,
                              secret: { token: secret },
                            },
                          });
                          setSecret("");
                          await refresh();
                        },
                        (error) =>
                          errors.show(error, [
                            "verification_method",
                            "secret.token",
                          ]),
                      )
                    }
                  >
                    导入并替换秘密
                  </Button>
                  <Button
                    variant="outline"
                    pending={submission.pending}
                    onClick={() =>
                      void submission.run(async () => {
                        const response = await request<{
                          webhook: WebhookSettings;
                          secret: { token: string };
                        }>(`${base}/verification/generate`, {
                          method: "POST",
                          etag: settings.data?.etag,
                          body: {},
                        });
                        setGenerated(response.data.secret.token);
                        await refresh();
                      })
                    }
                  >
                    生成新 Token
                  </Button>
                </div>
              </form>
              {generated && (
                <Notice tone="warning" className="mt-4" title="一次性 Token">
                  请立即复制并更新远端 Hook；关闭后无法再次读取。
                  <div className="mt-2 flex items-center gap-2">
                    <code className="break-all">{generated}</code>
                    <CopyButton value={generated} label="复制一次性 Token" />
                  </div>
                  <Button
                    className="mt-3"
                    size="sm"
                    variant="outline"
                    onClick={() => setGenerated("")}
                  >
                    我已保存，清除显示
                  </Button>
                </Notice>
              )}
            </>
          )}
        </AsyncBoundary>
      </Panel>
      <Panel title="最近接收诊断">
        <AsyncBoundary
          loading={diagnostics.isPending}
          error={diagnostics.error}
          onRetry={() => void diagnostics.refetch()}
        >
          {diagnostics.data?.data.latest ? (
            <Notice tone={diagnosticTone(diagnostics.data.data.latest)}>
              {diagnosticText(diagnostics.data.data.latest)}
              <div className="mt-2 text-xs">
                事件 {diagnostics.data.data.latest.summary.event_type ?? "—"} ·
                来源项目{" "}
                {diagnostics.data.data.latest.summary.source_project_id ?? "—"}
              </div>
            </Notice>
          ) : (
            <p className="text-sm text-muted">尚无通过验证的接收记录。</p>
          )}
        </AsyncBoundary>
      </Panel>
    </div>
  );
}
