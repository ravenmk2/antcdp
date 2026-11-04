import { useRef, useState } from "react";
import type { RemoteHost, Diagnostic } from "@/shared/remote-hosts";
import { request, errorMessage } from "@/lib/api";
import { writeReviewMessage } from "@/lib/write-error";
import { useSubmission } from "@/components/platform/use-submission";
import { FormDialog } from "@/components/platform/form-dialog";
import { Field } from "@/components/platform/field";
import { ErrorBox } from "@/components/platform/feedback";
import { CopyButton } from "@/components/platform/copy-button";
import { useNavigationProtection } from "@/components/platform/navigation-guard";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { ShieldCheck } from "lucide-react";
type Edit = {
  mode: "manual" | "probe" | "remove";
  captured: string[];
  tag: string;
  key: string;
  fingerprint?: string;
};
export function HostKeys({
  host,
  path,
  etag,
  onSaved,
}: {
  host: RemoteHost;
  path: string;
  etag: string;
  onSaved: () => void;
}) {
  const keys = host.config?.host_keys || [],
    fingerprints = host.host_key_fingerprints || {};
  const [edit, setEdit] = useState<Edit>(),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    lock = useRef(false);
  useNavigationProtection(busy ? "pending" : undefined);
  async function probe() {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const d = (
        await request<Diagnostic>(path + "/test", {
          method: "POST",
          etag,
          body: {},
        })
      ).data;
      if (!d.summary.host_key) {
        setError("未取得主机公钥，请检查地址、端口与网络。");
        return;
      }
      setEdit({
        mode: "probe",
        captured: keys,
        tag: etag,
        key: d.summary.host_key,
        fingerprint: d.summary.fingerprint,
      });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <section className="max-w-4xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">主机公钥</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            从可信来源核对公钥后，再用于 SSH 主机身份验证。
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            disabled={busy || keys.length >= 8}
            onClick={() =>
              setEdit({ mode: "manual", tag: etag, captured: keys, key: "" })
            }
          >
            手动录入
          </Button>
          <Button
            disabled={busy || !host.enabled || keys.length >= 8}
            onClick={() => void probe()}
          >
            {busy ? "正在探测…" : "探测公钥"}
          </Button>
        </div>
      </div>
      {keys.length >= 8 && (
        <p className="text-sm text-muted-foreground">
          已信任 8 个公钥，已达上限。
        </p>
      )}
      {!host.enabled && (
        <p className="text-sm text-muted-foreground">
          主机已停用，启用后可探测公钥。
        </p>
      )}
      <ErrorBox>{error}</ErrorBox>
      <div className="divide-y rounded-xl border bg-card px-4">
        {!keys.length && (
          <div className="py-8 text-sm text-muted-foreground">
            尚未信任公钥。验证凭证前，请先核对并保存主机身份。
          </div>
        )}
        {keys.map((k) => (
          <div
            key={k}
            className="flex flex-wrap items-center justify-between gap-3 py-4"
          >
            <div className="min-w-0">
              <h3 className="flex items-center gap-2 font-medium">
                <ShieldCheck className="size-4" />
                {k.split(" ")[0]}
              </h3>
              <div className="mt-1 flex items-center gap-1">
                <code className="break-all text-xs">
                  {fingerprints[k] || "指纹未提供"}
                </code>
                {fingerprints[k] && (
                  <CopyButton value={fingerprints[k]!} label="复制公钥指纹" />
                )}
              </div>
            </div>
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() =>
                setEdit({
                  mode: "remove",
                  tag: etag,
                  captured: keys,
                  key: k,
                  fingerprint: fingerprints[k],
                })
              }
            >
              移除公钥
            </Button>
          </div>
        ))}
      </div>
      {edit && (
        <KeyEditor
          edit={edit}
          path={path}
          onClose={() => setEdit(undefined)}
          onSaved={() => {
            setEdit(undefined);
            onSaved();
          }}
        />
      )}
    </section>
  );
}
function KeyEditor({
  edit,
  path,
  onClose,
  onSaved,
}: {
  edit: Edit;
  path: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [key, setKey] = useState(edit.key),
    [confirmed, setConfirmed] = useState(false),
    [error, setError] = useState(""),
    save = useSubmission();
  const remove = edit.mode === "remove";
  async function submit() {
    setError("");
    if (!remove && (!confirmed || !key.trim())) return;
    const next = remove
      ? edit.captured.filter((k) => k !== key)
      : [...edit.captured, key.trim()];
    await save.submit(
      async () => {
        await request(path, {
          method: "PATCH",
          etag: edit.tag,
          body: { config: { host_keys: next } },
        });
        onSaved();
      },
      (e) => setError(errorMessage(e)),
    );
  }
  return (
    <FormDialog
      open
      title={remove ? "移除主机公钥" : "核对主机公钥"}
      description={
        remove
          ? "移除后，使用此公钥的主机将无法通过身份验证。"
          : "请通过独立可信渠道核对主机管理员提供的公钥或 SHA256 指纹。"
      }
      dirty={!remove && (confirmed || key !== edit.key)}
      pending={save.pending}
      onClose={onClose}
      footer={(close) => (
        <>
          <Button variant="outline" disabled={save.pending} onClick={close}>
            取消
          </Button>
          <Button
            disabled={
              save.pending ||
              save.blocked ||
              (!remove && (!confirmed || !key.trim()))
            }
            variant={remove ? "destructive" : "default"}
            onClick={() => void submit()}
          >
            {remove ? "确认移除" : "加入信任"}
          </Button>
        </>
      )}
    >
      <ErrorBox>{error}</ErrorBox>
      {save.blocked && (
        <p role="alert">{writeReviewMessage}请重新读取主机并核对公钥。</p>
      )}
      <Field label="OpenSSH 公钥">
        {(p) => (
          <Textarea
            {...p}
            rows={3}
            readOnly={edit.mode !== "manual"}
            value={key}
            onChange={(e) => {
              setKey(e.target.value);
              setConfirmed(false);
            }}
          />
        )}
      </Field>
      {edit.fingerprint && (
        <p className="break-all font-mono text-sm">{edit.fingerprint}</p>
      )}
      {!remove && (
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
          />
          已通过可信来源核对主机身份
        </label>
      )}
    </FormDialog>
  );
}
