import { useState } from "react";
import { type RemoteHost } from "@/shared/remote-hosts";
import { request } from "@/lib/api";
import { useFormErrors } from "@/components/platform/use-form-errors";
import { useSubmission } from "@/components/platform/use-submission";
import { useNavigationProtection } from "@/components/platform/navigation-guard";
import { writeReviewMessage } from "@/lib/write-error";
import { FormDrawer } from "@/components/platform/form-drawer";
import { Field } from "@/components/platform/field";
import { ErrorBox } from "@/components/platform/feedback";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  CredentialFields,
  credentialDraft,
  credentialBody,
  credentialErrors,
  clearSecrets,
  configErrors,
  validCode,
  type Values,
} from "./Fields";
function draft(host?: RemoteHost) {
  return {
    name: host?.name || "",
    code: host?.code || "",
    description: host?.description || "",
    host: host?.config?.host || "",
    port: String(host?.config?.port || 22),
  };
}
function fields(d: ReturnType<typeof draft>) {
  return {
    ...configErrors({ host: d.host, port: d.port }),
    name: d.name.trim() ? "" : "请输入主机名称。",
    code: validCode(d.code.trim())
      ? ""
      : "请使用小写字母、数字、连字符或下划线。",
  };
}
function HostFields({
  value: d,
  onChange: update,
  errors,
  editing,
}: {
  value: ReturnType<typeof draft>;
  onChange: (d: ReturnType<typeof draft>) => void;
  errors: Values;
  editing?: boolean;
}) {
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        {(
          [
            ["name", "主机名称"],
            ["code", "主机编码"],
            ["host", "主机名 / IP"],
            ["port", "SSH 端口"],
          ] as const
        ).map(([key, label]) => (
          <Field
            key={key}
            label={label}
            required={key !== "code"}
            error={errors[key]}
            hint={key === "code" && !editing ? "留空由系统生成" : undefined}
          >
            {(p) => (
              <Input
                {...p}
                readOnly={editing && key === "code"}
                value={d[key]}
                inputMode={key === "port" ? "numeric" : undefined}
                onChange={(e) => update({ ...d, [key]: e.target.value })}
              />
            )}
          </Field>
        ))}
      </div>
      <Field label="说明" error={errors.description}>
        {(p) => (
          <Textarea
            {...p}
            value={d.description}
            onChange={(e) => update({ ...d, description: e.target.value })}
          />
        )}
      </Field>
    </div>
  );
}
export function CreateHost({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: (h: RemoteHost) => void;
}) {
  const [d, update] = useState(() => draft()),
    [step, setStep] = useState(1),
    [cred, setCred] = useState(() => credentialDraft("ssh")),
    [created, setCreated] = useState<RemoteHost>();
  const save = useSubmission(),
    errors = useFormErrors(),
    dirty = !!(
      d.name ||
      d.code ||
      d.description ||
      d.host ||
      d.port !== "22" ||
      cred.name
    );
  async function submit(skip: boolean) {
    errors.clear();
    if (!created && !errors.validate(fields(d))) {
      setStep(1);
      return;
    }
    if (!skip && !errors.validate(credentialErrors("ssh", cred, "create")))
      return;
    let saved = created;
    await save.submit(
      async () => {
        if (!saved) {
          saved = (
            await request<RemoteHost>("/admin/remote-hosts", {
              method: "POST",
              body: {
                name: d.name,
                code: d.code,
                description: d.description,
                config: { host: d.host, port: Number(d.port) },
              },
            })
          ).data;
          setCreated(saved);
        }
        if (!skip) {
          const base = "/admin/remote-hosts/" + saved.id + "/credentials";
          const collection = await request(base);
          await request(base, {
            method: "POST",
            etag: collection.etag,
            body: credentialBody("ssh", cred),
          });
        }
        onSaved(saved);
      },
      (e) => {
        setCred((v) => clearSecrets("ssh", v));
        setStep(saved ? 2 : 1);
        errors.show(e, [
          "name",
          "code",
          "host",
          "port",
          "description",
          "username",
          "token",
          "private_key",
          "passphrase",
          "expires_at",
        ]);
      },
    );
  }
  return (
    <FormDrawer
      title="创建 SSH 主机"
      description={step === 1 ? "主机信息" : "首个系统凭证"}
      dirty={dirty}
      pending={save.pending}
      onClose={onClose}
      footer={(close) => (
        <>
          <Button
            variant="outline"
            disabled={save.pending}
            onClick={() => close()}
          >
            取消
          </Button>
          {step === 1 ? (
            <Button
              onClick={() => {
                if (errors.validate(fields(d))) setStep(2);
              }}
            >
              下一步
            </Button>
          ) : (
            <>
              {!created && (
                <Button
                  variant="ghost"
                  disabled={save.pending}
                  onClick={() => setStep(1)}
                >
                  上一步
                </Button>
              )}
              <Button
                variant="outline"
                disabled={save.pending || (!created && save.blocked)}
                onClick={() => (created ? onSaved(created) : void submit(true))}
              >
                {created ? "打开已创建的主机" : "仅创建主机"}
              </Button>
              <Button
                disabled={save.pending || save.blocked}
                onClick={() => void submit(false)}
              >
                {created ? "保存凭证" : "创建主机和凭证"}
              </Button>
            </>
          )}
        </>
      )}
    >
      <form
        noValidate
        ref={errors.formRef}
        onSubmit={(e) => e.preventDefault()}
        className="space-y-4"
      >
        <ErrorBox>{errors.error}</ErrorBox>
        {created && <p role="status">主机已创建，可以继续保存凭证。</p>}
        {save.blocked && <p role="alert">{writeReviewMessage}</p>}
        <fieldset disabled={save.pending || save.blocked}>
          {step === 1 ? (
            <HostFields value={d} onChange={update} errors={errors.fields} />
          ) : (
            <CredentialFields
              kind="ssh"
              mode="create"
              draft={cred}
              update={setCred}
              errors={errors.fields}
            />
          )}
        </fieldset>
      </form>
    </FormDrawer>
  );
}
export function EditHost({
  host,
  tag,
  onClose,
  onSaved,
}: {
  host: RemoteHost;
  tag: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [snapshot] = useState(() => ({ value: draft(host), id: host.id, tag })),
    [d, update] = useState(snapshot.value),
    [confirm, setConfirm] = useState(false);
  const save = useSubmission(),
    errors = useFormErrors(),
    dirty = JSON.stringify(d) !== JSON.stringify(snapshot.value);
  useNavigationProtection(
    save.pending ? "pending" : dirty ? "dirty" : undefined,
  );
  const [discard, setDiscard] = useState(false);
  async function submit(confirmed = false) {
    errors.clear();
    if (!dirty || !errors.validate(fields(d))) return;
    if (
      !confirmed &&
      (d.host !== snapshot.value.host ||
        Number(d.port) !== Number(snapshot.value.port))
    ) {
      setConfirm(true);
      return;
    }
    setConfirm(false);
    await save.submit(
      async () => {
        await request("/admin/remote-hosts/" + snapshot.id, {
          method: "PATCH",
          etag: snapshot.tag,
          body: {
            name: d.name,
            description: d.description,
            config: { host: d.host, port: Number(d.port) },
          },
        });
        onSaved();
      },
      (e) => errors.show(e, ["name", "host", "port", "description"]),
    );
  }
  return (
    <form
      ref={errors.formRef}
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      className="max-w-3xl space-y-5 rounded-xl border bg-card p-5"
    >
      <h2 className="font-semibold">编辑主机配置</h2>
      <ErrorBox>{errors.error}</ErrorBox>
      {save.blocked && <p role="alert">{writeReviewMessage}</p>}
      <fieldset disabled={save.pending || save.blocked || confirm}>
        <HostFields
          editing
          value={d}
          onChange={update}
          errors={errors.fields}
        />
      </fieldset>
      {confirm && (
        <section role="alert" className="space-y-2">
          <p>修改主机名或端口会清空原来的公钥信任，需要重新核对主机身份。</p>
          <Button
            type="button"
            variant="outline"
            onClick={() => setConfirm(false)}
          >
            继续编辑
          </Button>{" "}
          <Button type="button" onClick={() => void submit(true)}>
            确认修改地址
          </Button>
        </section>
      )}
      {discard && (
        <section role="alert">
          <p>放弃未保存的主机修改？</p>
          <Button
            type="button"
            variant="outline"
            onClick={() => setDiscard(false)}
          >
            继续编辑
          </Button>{" "}
          <Button type="button" onClick={onClose}>
            放弃修改
          </Button>
        </section>
      )}
      <div className="flex justify-end gap-2 border-t pt-4">
        <Button
          type="button"
          variant="outline"
          disabled={save.pending}
          onClick={() => (dirty ? setDiscard(true) : onClose())}
        >
          取消编辑
        </Button>
        <Button
          disabled={
            save.pending || save.blocked || !dirty || confirm || discard
          }
        >
          保存主机
        </Button>
      </div>
    </form>
  );
}
