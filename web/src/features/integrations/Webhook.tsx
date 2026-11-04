import { useOperationToast } from "@/components/platform/operation-toast";
import { EnabledStatus } from "@/components/platform/status-text";
import { useState } from "react";
import { type WebhookSettings, type Diagnostic } from "@/shared/integrations";
import { request, errorMessage } from "@/lib/api";
import { useQuery } from "@/lib/use-query";
import { useSubmission } from "@/components/platform/use-submission";
import { Field } from "@/components/platform/field";
import { ErrorBox, AsyncState } from "@/components/platform/feedback";
import { FormDialog } from "@/components/platform/form-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/platform/native-select";
import { CopyButton } from "@/components/platform/copy-button";
import { DiagnosticResult } from "./Diagnostics";
import { SecretValue } from "./Fields";
import { writeReviewMessage } from "@/lib/write-error";
export function Webhook({
  base,
  methods,
  enabled,
}: {
  base: string;
  methods: string[];
  enabled: boolean;
}) {
  const [revision, setRevision] = useState(0),
    settings = useQuery<WebhookSettings>(base, revision),
    receiver = useQuery<{ receive_url: string }>(base + "/receiver"),
    diagnosis = useQuery<{ latest: Diagnostic | null }>(
      base + "/diagnostics",
      revision,
    );
  const [op, setOp] = useState<{
      type: "toggle" | "replace";
      value: WebhookSettings;
      tag: string;
    }>(),
    [once, setOnce] = useState(""),
    notify = useOperationToast();
  return (
    <section className="max-w-3xl space-y-5">
      <h2 className="text-lg font-semibold">Webhook 接收设置</h2>

      <AsyncState
        loading={settings.loading}
        error={settings.error}
        onRetry={settings.refresh}
      >
        {settings.data && (
          <div className="space-y-4 rounded-xl border bg-card p-5">
            <div className="flex items-center justify-between gap-3">
              <h3 className="font-medium">
                接收状态 · <EnabledStatus enabled={settings.data.enabled} />
              </h3>
              <Button
                variant="outline"
                disabled={!settings.data.has_secret}
                onClick={() =>
                  setOp({
                    type: "toggle",
                    value: settings.data!,
                    tag: settings.response!.etag,
                  })
                }
              >
                {settings.data.enabled ? "停用接收" : "启用接收"}
              </Button>
            </div>
            {!enabled && (
              <p className="text-sm text-muted-foreground">
                父连接已停用，接收设置仍可维护。
              </p>
            )}
            <AsyncState
              loading={receiver.loading}
              error={receiver.error}
              onRetry={receiver.refresh}
            >
              {receiver.data && (
                <div className="flex items-center justify-between gap-3 rounded-lg bg-muted p-3">
                  <code className="break-all text-sm">
                    {receiver.data.receive_url}
                  </code>
                  <CopyButton
                    value={receiver.data.receive_url}
                    label="复制接收地址"
                  />
                </div>
              )}
            </AsyncState>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
              <span>
                {settings.data.has_secret
                  ? "已配置验证秘密"
                  : "尚未配置验证秘密"}
              </span>
              <Button
                variant="outline"
                onClick={() =>
                  setOp({
                    type: "replace",
                    value: settings.data!,
                    tag: settings.response!.etag,
                  })
                }
              >
                配置验证秘密
              </Button>
            </div>
          </div>
        )}
      </AsyncState>
      <AsyncState
        loading={diagnosis.loading}
        error={diagnosis.error}
        onRetry={diagnosis.refresh}
      >
        <DiagnosticResult value={diagnosis.data?.latest || null} />
      </AsyncState>
      {op && (
        <Edit
          key={op.type}
          base={base}
          methods={methods}
          op={op}
          onClose={() => setOp(undefined)}
          onSaved={(token) => {
            setOnce(token || "");
            notify("接收设置已保存。");
            setOp(undefined);
            setRevision((v) => v + 1);
          }}
        />
      )}
      {once && (
        <FormDialog
          open
          dirty
          title="保存新生成的 Token"
          description="此 Token 仅显示一次，请复制到远端 Hook 配置。"
          onClose={() => setOnce("")}
          footer={<Button onClick={() => setOnce("")}>已保存并关闭</Button>}
        >
          <SecretValue value={once} />
          <CopyButton value={once} label="复制新 Token" />
        </FormDialog>
      )}
    </section>
  );
}
function Edit({
  base,
  methods,
  op,
  onClose,
  onSaved,
}: {
  base: string;
  methods: string[];
  op: { type: "toggle" | "replace"; value: WebhookSettings; tag: string };
  onClose: () => void;
  onSaved: (token?: string) => void;
}) {
  const [token, setToken] = useState(""),
    [method, setMethod] = useState(
      op.value.verification_method || methods[0] || "secret_token",
    ),
    [generate, setGenerate] = useState(false),
    [error, setError] = useState(""),
    save = useSubmission();
  async function run() {
    setError("");
    if (op.type === "replace" && !generate && !token) {
      setError("请输入验证秘密。");
      return;
    }
    await save.submit(
      async () => {
        if (op.type === "toggle") {
          await request(base, {
            method: "PATCH",
            etag: op.tag,
            body: { enabled: !op.value.enabled },
          });
          onSaved();
        } else if (generate) {
          const r = await request<{ secret: { token: string } }>(
            base + "/verification/generate",
            { method: "POST", etag: op.tag, body: {} },
          );
          onSaved(r.data.secret.token);
        } else {
          await request(base + "/verification", {
            method: "PUT",
            etag: op.tag,
            body: { verification_method: method, secret: { token } },
          });
          onSaved();
        }
      },
      (e) => {
        setToken("");
        setError(errorMessage(e));
      },
    );
  }
  return (
    <FormDialog
      open
      title={
        op.type === "toggle"
          ? op.value.enabled
            ? "停用接收"
            : "启用接收"
          : "配置验证秘密"
      }
      description={
        op.type === "toggle"
          ? "变更此连接的入站事件接收开关。"
          : "替换后所有使用此连接的远端 Hook 都需要更新秘密。"
      }
      dirty={!!token}
      pending={save.pending}
      onClose={onClose}
      footer={(close) => (
        <>
          <Button variant="outline" disabled={save.pending} onClick={close}>
            取消
          </Button>
          <Button
            disabled={save.pending || save.blocked}
            onClick={() => void run()}
          >
            {save.pending ? "正在保存…" : "确认保存"}
          </Button>
        </>
      )}
    >
      <ErrorBox>{error}</ErrorBox>
      {save.blocked && <p role="alert">{writeReviewMessage}</p>}
      {op.type === "replace" && (
        <fieldset disabled={save.pending || save.blocked} className="space-y-4">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={generate}
              onChange={(e) => {
                setGenerate(e.target.checked);
                setToken("");
              }}
            />
            生成新的 Secret Token
          </label>
          {!generate && (
            <>
              <Field label="验证方式">
                {(p) => (
                  <NativeSelect
                    {...p}
                    value={method}
                    onChange={(e) => setMethod(e.target.value)}
                  >
                    {methods.map((m) => (
                      <option key={m} value={m}>
                        {m === "secret_token" ? "Secret Token" : m}
                      </option>
                    ))}
                  </NativeSelect>
                )}
              </Field>
              <Field label="验证秘密" required>
                {(p) => (
                  <Input
                    {...p}
                    type="password"
                    autoComplete="new-password"
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                  />
                )}
              </Field>
            </>
          )}
        </fieldset>
      )}
    </FormDialog>
  );
}
