import { useRef, useState } from "react";
import { useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { request } from "@/api/client";
import { Button } from "@/components/button";
import { ErrorNotice, Notice } from "@/components/feedback";
import {
  Field,
  Input,
  NumberInput,
  Select,
  Textarea,
} from "@/components/fields";
import { Drawer } from "@/components/overlays";
import { SheetClose } from "@/components/ui/sheet";
import { WizardSteps } from "@/components/wizard";
import { useFormErrors, useSubmission } from "@/hooks/use-form";
import { useUnsaved } from "@/hooks/use-unsaved";
import { authenticationBody } from "@/domain/service-providers";
import { sshProvider } from "@/domain/ssh-provider";
import type { Credential, ServiceConnection } from "@/types/integrations";

export function HostCreateDrawer({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const saving = useRef(false);
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [form, setForm] = useState({
    name: "",
    code: "",
    description: "",
    host: "",
    port: "22",
    enabled: true,
  });
  const [withCredential, setWithCredential] = useState(true);
  const [credential, setCredential] = useState({
    name: "",
    code: "",
    method: "ssh_password",
  });
  const [values, setValues] = useState<Record<string, string>>({});
  const [created, setCreated] = useState<ServiceConnection | null>(null);
  const errors = useFormErrors();
  const submission = useSubmission();
  const dirty = Boolean(
    form.name ||
    form.code ||
    form.description ||
    form.host ||
    form.port !== "22" ||
    !form.enabled ||
    credential.name ||
    credential.code ||
    credential.method !== "ssh_password" ||
    !withCredential ||
    Object.values(values).some(Boolean),
  );
  const markSaved = useUnsaved(dirty, submission.pending);
  function close() {
    markSaved();
    onClose();
  }
  function finish(host: ServiceConnection) {
    markSaved();
    navigate(`/admin/remote-hosts/${host.id}`);
  }
  function validateHost() {
    return errors.validate({
      name: !form.name.trim() ? "请输入主机名称" : "",
      host: !form.host.trim() ? "请输入主机名或 IP" : "",
      port:
        !Number.isInteger(Number(form.port)) ||
        Number(form.port) < 1 ||
        Number(form.port) > 65535
          ? "请输入 1–65535 的整数端口"
          : "",
    });
  }
  const method =
    sshProvider.methods.find((item) => item.value === credential.method) ??
    sshProvider.methods[0];
  async function save(includeCredential: boolean) {
    if (saving.current || submission.pending || submission.uncertain) return;
    if (!created && !validateHost()) {
      setStep(0);
      return;
    }
    if (
      includeCredential &&
      method &&
      !errors.validate({
        credential_name: !credential.name.trim() ? "请输入首个凭证名称" : "",
        ...Object.fromEntries(
          [...method.identity, ...method.secret].map((field) => [
            field.key,
            !values[field.key]?.trim() ? `请输入${field.label}` : "",
          ]),
        ),
      })
    )
      return;
    saving.current = true;
    let credentialStage = false;
    try {
      await submission.run(
        async () => {
          let host = created;
          if (!host) {
            const response = await request<ServiceConnection>(
              "/admin/remote-hosts",
              {
                method: "POST",
                body: {
                  name: form.name.trim(),
                  code: form.code.trim(),
                  description: form.description,
                  enabled: form.enabled,
                  config: { host: form.host, port: Number(form.port) },
                },
              },
            );
            host = response.data;
            setCreated(host);
            await queryClient.invalidateQueries({
              queryKey: ["remote-host-directory"],
            });
          }
          if (includeCredential && method) {
            credentialStage = true;
            const base = `/admin/remote-hosts/${host.id}/credentials`;
            const collection = await request<{ items: Credential[] }>(base);
            await request(base, {
              method: "POST",
              etag: collection.etag,
              body: {
                code: credential.code.trim(),
                name: credential.name.trim(),
                description: "",
                expires_at: null,
                authentication: authenticationBody(method, values),
              },
            });
          }
          finish(host);
        },
        (error) => {
          if (!credentialStage) setStep(0);
          errors.show(
            error,
            [
              "name",
              "code",
              "host",
              "port",
              "credential_name",
              "credential_code",
              "username",
              "token",
              "private_key",
              "passphrase",
            ],
            {
              "config.host": "host",
              "config.port": "port",
              ...(credentialStage
                ? {
                    name: "credential_name",
                    code: "credential_code",
                    "authentication.identity_config.username": "username",
                    "authentication.secret.token": "token",
                    "authentication.secret.private_key": "private_key",
                    "authentication.secret.passphrase": "passphrase",
                  }
                : {}),
            },
          );
        },
      );
    } finally {
      saving.current = false;
    }
  }
  return (
    <Drawer
      open
      wide
      title="添加 SSH 主机"
      description="主机信息 → 首个凭证；公钥信任在创建后单独核对"
      dirty={dirty}
      pending={submission.pending}
      onClose={close}
      footer={
        <>
          <SheetClose asChild>
            <Button variant="outline" disabled={submission.pending}>
              取消
            </Button>
          </SheetClose>
          {step > 0 && !created && (
            <Button
              variant="outline"
              disabled={submission.pending || submission.uncertain}
              onClick={() => {
                errors.clear();
                setStep(0);
              }}
            >
              上一步
            </Button>
          )}
          {step === 0 ? (
            <Button
              type="submit"
              form="host-create-form"
              disabled={submission.pending || submission.uncertain}
            >
              下一步
            </Button>
          ) : (
            <>
              <Button
                variant="outline"
                pending={submission.pending}
                disabled={submission.uncertain && !created}
                onClick={() => (created ? finish(created) : void save(false))}
              >
                {created ? "进入主机详情" : "仅创建主机"}
              </Button>
              <Button
                type="submit"
                form="host-create-form"
                pending={submission.pending}
                disabled={!withCredential || submission.uncertain}
              >
                {created ? "重试创建凭证" : "创建主机和凭证"}
              </Button>
            </>
          )}
        </>
      }
    >
      <WizardSteps steps={["主机信息", "首个凭证"]} current={step} />
      <form
        id="host-create-form"
        noValidate
        ref={errors.formRef}
        className="mt-6"
        onSubmit={(event) => {
          event.preventDefault();
          if (step === 0) {
            if (validateHost()) setStep(1);
          } else {
            void save(withCredential);
          }
        }}
        onChange={() => errors.clear()}
      >
        <fieldset
          disabled={submission.pending || submission.uncertain}
          className="min-w-0"
        >
          <ErrorNotice error={errors.error || submission.error} />
          {step === 0 ? (
            <div className="form-grid">
              <Field label="主机名称" required error={errors.fields.name}>
                <Input
                  name="name"
                  value={form.name}
                  onChange={(event) =>
                    setForm({ ...form, name: event.target.value })
                  }
                />
              </Field>
              <Field label="编码（可选）" error={errors.fields.code}>
                <Input
                  name="code"
                  className="mono"
                  value={form.code}
                  onChange={(event) =>
                    setForm({ ...form, code: event.target.value })
                  }
                />
              </Field>
              <Field label="主机名 / IP" required error={errors.fields.host}>
                <Input
                  name="host"
                  autoComplete="off"
                  value={form.host}
                  onChange={(event) =>
                    setForm({ ...form, host: event.target.value })
                  }
                />
              </Field>
              <Field label="SSH 端口" required error={errors.fields.port}>
                <NumberInput
                  name="port"
                  label="端口"
                  min={1}
                  max={65535}
                  value={form.port}
                  disabled={submission.pending}
                  onValueChange={(value) => {
                    setForm({ ...form, port: value });
                  }}
                />
              </Field>
              <Field label="说明" className="form-full">
                <Textarea
                  value={form.description}
                  onChange={(event) =>
                    setForm({ ...form, description: event.target.value })
                  }
                />
              </Field>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={form.enabled}
                  onChange={(event) =>
                    setForm({ ...form, enabled: event.target.checked })
                  }
                />
                创建后启用
              </label>
            </div>
          ) : (
            <div className="grid gap-4">
              <Notice>
                创建主机不会自动信任公钥。请先测试握手并从可信来源核对 SHA256
                指纹。
              </Notice>
              {created && (
                <Notice tone="warning">
                  主机「{created.name}」已创建，无需重复创建主机。
                </Notice>
              )}
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={withCredential}
                  onChange={(event) => setWithCredential(event.target.checked)}
                />
                同时创建首个系统凭证
              </label>
              {withCredential && method && (
                <div className="form-grid">
                  <Field
                    label="凭证名称"
                    required
                    error={errors.fields.credential_name}
                  >
                    <Input
                      name="credential_name"
                      value={credential.name}
                      onChange={(event) =>
                        setCredential({
                          ...credential,
                          name: event.target.value,
                        })
                      }
                    />
                  </Field>
                  <Field
                    label="凭证编码（可选）"
                    error={errors.fields.credential_code}
                  >
                    <Input
                      name="credential_code"
                      className="mono"
                      value={credential.code}
                      onChange={(event) =>
                        setCredential({
                          ...credential,
                          code: event.target.value,
                        })
                      }
                    />
                  </Field>
                  <Field label="认证方式" className="form-full">
                    <Select
                      value={credential.method}
                      onValueChange={(value) => {
                        errors.clear();
                        setCredential({
                          ...credential,
                          method: value,
                        });
                        setValues({});
                      }}
                    >
                      {sshProvider.methods.map((item) => (
                        <option key={item.value} value={item.value}>
                          {item.label}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  {[...method.identity, ...method.secret].map((field) => (
                    <Field
                      key={field.key}
                      label={field.label}
                      error={errors.fields[field.key]}
                      required
                      className={
                        field.type === "textarea" ? "form-full" : undefined
                      }
                    >
                      {field.type === "textarea" ? (
                        <Textarea
                          className="font-mono"
                          name={field.key}
                          value={values[field.key] ?? ""}
                          onChange={(event) =>
                            setValues({
                              ...values,
                              [field.key]: event.target.value,
                            })
                          }
                        />
                      ) : (
                        <Input
                          name={field.key}
                          type={field.type ?? "text"}
                          autoComplete="off"
                          value={values[field.key] ?? ""}
                          onChange={(event) =>
                            setValues({
                              ...values,
                              [field.key]: event.target.value,
                            })
                          }
                        />
                      )}
                    </Field>
                  ))}
                </div>
              )}
            </div>
          )}
        </fieldset>
      </form>
    </Drawer>
  );
}
