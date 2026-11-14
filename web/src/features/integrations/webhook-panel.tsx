import { useRef, useState } from "react";
import { isVersionConflict, request } from "@/api/client";
import { useAuth } from "@/app/auth";
import { Button } from "@/components/button";
import { AsyncBoundary, Notice, StatusBadge } from "@/components/feedback";
import { CopyButton } from "@/components/copy-button";
import { Field, Input, Select } from "@/components/fields";
import { Panel } from "@/components/layout";
import { ConfirmDialog } from "@/components/overlays";
import { useApiQuery } from "@/hooks/use-api";
import { useFormErrors, useSubmission } from "@/hooks/use-form";
import { useUnsaved } from "@/hooks/use-unsaved";
import { diagnosticText, diagnosticTone } from "@/domain/service-providers";
import { formatDate } from "@/lib/utils";
import type { Diagnostic, WebhookSettings } from "@/types/integrations";
import { IntegrationError } from "./connection-editor";

const methodLabels: Record<string, string> = {
  secret_token: "Secret Token（请求头验证）",
  signing_token: "Signing Token（签名验证）",
};
export function WebhookPanel({
  base,
  connectionEnabled,
  methods,
}: {
  base: string;
  connectionEnabled: boolean;
  methods: string[];
}) {
  const { settings: appSettings } = useAuth();
  const settings = useApiQuery<WebhookSettings>(["webhook", base], base);
  const receiver = useApiQuery<{ receive_url: string }>(
    ["webhook-receiver", base],
    `${base}/receiver`,
  );
  const diagnostics = useApiQuery<{ latest: Diagnostic | null }>(
    ["webhook-diagnostics", base, settings.data?.etag, connectionEnabled],
    `${base}/diagnostics`,
  );
  const [method, setMethod] = useState("");
  const [secret, setSecret] = useState("");
  const [generated, setGenerated] = useState("");
  const [confirm, setConfirm] = useState<"import" | "generate" | null>(null);
  const [reading, setReading] = useState(false);
  const [readError, setReadError] = useState<unknown>(null);
  const [message, setMessage] = useState("");
  const saving = useRef(false);
  const errors = useFormErrors();
  const submission = useSubmission();
  const pending = submission.pending || reading;
  const blocked =
    pending ||
    submission.uncertain ||
    isVersionConflict(submission.error) ||
    !settings.data?.etag ||
    Boolean(settings.error);
  useUnsaved(
    Boolean(
      secret ||
      generated ||
      (method && method !== settings.data?.data.verification_method) ||
      submission.uncertain,
    ),
    pending,
    true,
  );
  async function refresh() {
    const result = await settings.refetch();
    if (result.error) throw result.error;
    await diagnostics.refetch();
  }
  async function reload() {
    if (pending) return;
    setReading(true);
    setReadError(null);
    try {
      await refresh();
      if (!submission.uncertain) {
        submission.setError(null);
        errors.clear();
        setMessage("已重新加载接收设置，草稿保留，请核对后再保存。");
      } else
        setMessage(
          "已读取当前设置。秘密无法读取，不能据此确认本次替换结果；不要重复提交，需核对远端 Hook 配置。",
        );
    } catch (error) {
      setReadError(error);
    } finally {
      setReading(false);
    }
  }
  async function mutate(action: "toggle" | "import" | "generate") {
    if (saving.current || blocked || !settings.data) return;
    saving.current = true;
    setMessage("");
    try {
      await submission.run(
        async () => {
          if (action === "toggle")
            await request(base, {
              method: "PATCH",
              etag: settings.data.etag,
              body: { enabled: !settings.data.data.enabled },
            });
          else if (action === "import") {
            await request(`${base}/verification`, {
              method: "PUT",
              etag: settings.data.etag,
              body: {
                verification_method:
                  method || settings.data.data.verification_method,
                secret: { token: secret },
              },
            });
            setSecret("");
            setGenerated("");
            setMethod("");
          } else {
            const result = await request<{
              webhook: WebhookSettings;
              secret: { token: string };
            }>(`${base}/verification/generate`, {
              method: "POST",
              etag: settings.data.etag,
              body: {},
            });
            setGenerated(result.data.secret.token);
            setSecret("");
            setMethod("");
          }
          setConfirm(null);
          await refresh();
        },
        (error) => {
          setConfirm(null);
          errors.show(error, ["verification_method", "token"], {
            "secret.token": "token",
          });
        },
      );
    } finally {
      saving.current = false;
    }
  }
  const latest = diagnostics.data?.data.latest;
  return (
    <div className="grid gap-5">
      <Panel title="Webhook 接收设置">
        <AsyncBoundary
          loading={(!settings.data && settings.isPending) || receiver.isPending}
          error={receiver.error ?? (!settings.data ? settings.error : null)}
          onRetry={() => {
            void settings.refetch();
            void receiver.refetch();
          }}
        >
          {settings.data && receiver.data && (
            <div className="grid gap-5">
              <Notice>
                每个连接使用同一接收地址和验证秘密。更换秘密后，需要同步更新所有使用此地址的远端
                Hook；不会自动配置远端。
              </Notice>
              <div className="grid gap-2">
                <span className="text-xs text-muted">接收地址</span>
                <div className="flex min-w-0 items-start gap-3 rounded-lg bg-surface-subtle p-3">
                  <code className="min-w-0 flex-1 break-all text-sm">
                    {receiver.data.data.receive_url}
                  </code>
                  <CopyButton
                    value={receiver.data.data.receive_url}
                    label="复制接收地址"
                  />
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <StatusBadge
                  tone={
                    connectionEnabled && settings.data.data.enabled
                      ? "success"
                      : "neutral"
                  }
                >
                  {!connectionEnabled
                    ? "接收暂停 · 连接已停用"
                    : settings.data.data.enabled
                      ? "接收已启用"
                      : "接收已停用"}
                </StatusBadge>
                <span className="text-sm text-muted">
                  验证秘密：
                  {settings.data.data.has_secret ? "已配置" : "未配置"}
                </span>
                <Button
                  variant="outline"
                  disabled={
                    blocked ||
                    (!settings.data.data.enabled &&
                      !settings.data.data.has_secret)
                  }
                  pending={submission.pending}
                  onClick={() => void mutate("toggle")}
                >
                  {settings.data.data.enabled ? "停用接收" : "启用接收"}
                </Button>
              </div>
              {!connectionEnabled && (
                <Notice tone="warning">
                  连接停用期间不会接收事件。接收开关与秘密配置保留，连接恢复后按此设置生效。
                </Notice>
              )}
              {!settings.data.data.has_secret && (
                <p className="text-sm text-muted">
                  先配置验证秘密，再启用接收。
                </p>
              )}
              <IntegrationError error={submission.error ?? settings.error} />
              {(submission.uncertain ||
                isVersionConflict(submission.error) ||
                !settings.data.etag ||
                settings.error) && (
                <Button
                  variant="outline"
                  pending={reading}
                  onClick={() => void reload()}
                >
                  {submission.uncertain ? "核实接收设置" : "重新加载接收设置"}
                </Button>
              )}
              <IntegrationError error={readError} />
              {message && (
                <Notice tone={submission.uncertain ? "warning" : "info"}>
                  {message}
                </Notice>
              )}
              <form
                ref={errors.formRef}
                className="grid gap-4 border-t border-t-border-subtle pt-5"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (
                    !blocked &&
                    errors.validate({
                      token: secret ? "" : "请输入新的验证秘密",
                    })
                  )
                    setConfirm("import");
                }}
              >
                <h3 className="text-sm font-semibold">验证设置</h3>
                <p className="text-sm text-muted">
                  当前方式：
                  {methodLabels[settings.data.data.verification_method] ??
                    settings.data.data.verification_method}
                </p>
                <fieldset disabled={blocked} className="grid min-w-0 gap-4">
                  <Field
                    label="验证方式"
                    error={errors.fields.verification_method}
                  >
                    <Select
                      name="verification_method"
                      value={method || settings.data.data.verification_method}
                      onValueChange={(value) => {
                        setMethod(value);
                        errors.change("verification_method");
                      }}
                    >
                      {methods.map((value) => (
                        <option key={value} value={value}>
                          {methodLabels[value] ?? value}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field
                    label="新验证秘密"
                    error={errors.fields.token}
                    hint="仅用于本连接的入站验证。保存后不可读取，不会自动启用接收。"
                  >
                    <Input
                      name="token"
                      type="password"
                      autoComplete="new-password"
                      value={secret}
                      onChange={(event) => {
                        setSecret(event.target.value);
                        errors.change("token");
                      }}
                    />
                  </Field>
                  <div className="flex flex-wrap gap-2">
                    <Button type="submit" variant="outline" disabled={blocked}>
                      导入并替换秘密
                    </Button>
                    {methods.includes("secret_token") && (
                      <Button
                        variant="outline"
                        disabled={blocked}
                        onClick={() => setConfirm("generate")}
                      >
                        生成新 Token
                      </Button>
                    )}
                  </div>
                </fieldset>
              </form>
              {generated && (
                <Notice tone="warning" title="一次性 Token">
                  <p>
                    请立即复制并同步远端 Hook。此 Token
                    只显示一次；切换页签会保留，离开详情后无法再次读取。
                  </p>
                  <div className="mt-3 flex min-w-0 items-start gap-2">
                    <code className="min-w-0 flex-1 break-all">
                      {generated}
                    </code>
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
            </div>
          )}
        </AsyncBoundary>
      </Panel>
      <Panel title="最近接收诊断">
        <AsyncBoundary
          loading={diagnostics.isPending || diagnostics.isFetching}
          error={diagnostics.error}
          onRetry={() => void diagnostics.refetch()}
        >
          {latest ? (
            <Notice tone={diagnosticTone(latest)}>
              {diagnosticText(latest)}
              <div className="mt-2 text-xs">
                接收时间：{formatDate(latest.finished_at, appSettings.timezone)}{" "}
                · 事件 {latest.summary.event_type ?? "—"} · 来源项目{" "}
                {latest.summary.source_project_id ?? "—"}
              </div>
            </Notice>
          ) : (
            <p className="text-sm text-muted">尚无通过验证的接收记录。</p>
          )}
        </AsyncBoundary>
      </Panel>
      <ConfirmDialog
        open={confirm !== null}
        title={
          confirm === "generate"
            ? "生成并替换验证 Token？"
            : "替换 Webhook 验证秘密？"
        }
        description={
          confirm === "generate"
            ? "将切换到 Secret Token 验证并立即替换现有秘密，接收开关保持不变。所有远端 Hook 都需同步更新。"
            : "新方式和秘密立即生效，接收开关保持不变。所有远端 Hook 都需同步更新。"
        }
        confirmLabel="确认替换"
        pending={pending}
        confirmDisabled={blocked}
        onClose={() => setConfirm(null)}
        onConfirm={() => {
          if (confirm) void mutate(confirm);
        }}
      />
    </div>
  );
}
