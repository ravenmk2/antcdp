import { useState } from "react";
import { type ServiceConnection, type Capability } from "@/shared/integrations";
import { serviceUI } from "@/shared/integration-providers";
import { request } from "@/lib/api";
import { writeReviewMessage } from "@/lib/write-error";
import { FormDrawer } from "@/components/platform/form-drawer";
import { useSubmission } from "@/components/platform/use-submission";
import { useFormErrors } from "@/components/platform/use-form-errors";
import { Check, Search } from "lucide-react";
import { Field } from "@/components/platform/field";
import { ErrorBox } from "@/components/platform/feedback";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  configErrors,
  credentialBody,
  credentialDraft,
  credentialErrors,
  clearSecrets,
  defaults,
  ProviderFields,
  CredentialFields,
  validCode,
  type Values,
} from "./Fields";
const purposes: Record<string, string> = {
  gitlab: "代码仓库、分支与 Webhook",
  jenkins: "持续集成与构建任务",
  openobserve: "日志与可观测数据",
  elasticsearch: "搜索与索引",
  mysql: "MySQL 关系型数据库",
  postgresql: "PostgreSQL 关系型数据库",
};
export function ConnectionEditor({
  capabilities,
  connection,
  etag,
  onClose,
  onSaved,
}: {
  capabilities: Capability[];
  connection?: ServiceConnection;
  etag?: string;
  onClose: () => void;
  onSaved: (v: ServiceConnection) => void;
}) {
  const [initial] = useState(connection),
    [tag] = useState(etag),
    [kind, setKind] = useState(
      initial?.service_type || capabilities[0]?.service_type || "",
    );
  const [typeQuery, setTypeQuery] = useState("");
  const available = capabilities.filter((c) =>
    (c.name + " " + c.service_type + " " + (purposes[c.service_type] || ""))
      .toLowerCase()
      .includes(typeQuery.trim().toLowerCase()),
  );
  const [step, setStep] = useState(initial ? 2 : 1),
    [name, setName] = useState(initial?.name || ""),
    [code, setCode] = useState(initial?.code || ""),
    [description, setDescription] = useState(initial?.description || ""),
    [enabled, setEnabled] = useState(initial?.enabled ?? true);
  const [original] = useState<Values>(() => ({
      ...defaults(kind),
      ...Object.fromEntries(
        Object.entries(initial?.config || {}).map(([k, v]) => [
          k,
          String(v ?? ""),
        ]),
      ),
    })),
    [values, setValues] = useState(original);
  const [credential, setCredential] = useState(() => credentialDraft(kind)),
    [created, setCreated] = useState<ServiceConnection>(),
    [confirmAddress, setConfirmAddress] = useState(false);
  const save = useSubmission(),
    errors = useFormErrors(),
    adapter = serviceUI[kind]!;
  const dirty = initial
    ? name !== initial.name ||
      description !== initial.description ||
      enabled !== initial.enabled ||
      JSON.stringify(values) !== JSON.stringify(original)
    : !!(name || code || description || step > 1);
  function changeKind(id: string) {
    setKind(id);
    setValues(defaults(id));
    setCredential(credentialDraft(id));
    errors.clear();
  }
  function valid() {
    const fields = configErrors(kind, values);
    if (!name.trim()) fields.name = "请输入连接名称。";
    if (!validCode(code.trim()))
      fields.code = "编码须以小写字母或数字开头，最多 64 位。";
    return errors.validate(fields);
  }
  function advance() {
    errors.clear();
    if (step === 1) {
      if (kind) setStep(2);
      return;
    }
    if (valid()) setStep(3);
  }
  async function submit(skip = false, confirmed = false) {
    errors.clear();
    if (!created && !valid()) {
      setStep(2);
      return;
    }
    if (
      !initial &&
      !skip &&
      !errors.validate(credentialErrors(kind, credential, "create"))
    ) {
      setStep(3);
      return;
    }
    if (
      initial &&
      !confirmed &&
      ["host", "port", "database", "base_url"].some(
        (k) => original[k] !== values[k],
      )
    ) {
      setConfirmAddress(true);
      return;
    }
    setConfirmAddress(false);
    let connectionSaved = !!created;
    await save.submit(
      async () => {
        let saved = created;
        const base = "/admin/service-connections/" + kind;
        if (!saved) {
          saved = (
            await request<ServiceConnection>(
              initial ? base + "/" + initial.id : base,
              {
                method: initial ? "PATCH" : "POST",
                etag: initial ? tag : undefined,
                body: {
                  name,
                  description,
                  config: adapter.connectionBody(values),
                  ...(initial ? { enabled } : { code: code.trim() }),
                },
              },
            )
          ).data;
          if (!initial) {
            setCreated(saved);
            connectionSaved = true;
          }
        }
        if (!initial && !skip) {
          const path = base + "/" + saved.id + "/credentials";
          const collection = await request(path);
          await request(path, {
            method: "POST",
            etag: collection.etag,
            body: credentialBody(kind, credential),
          });
        }
        setCredential((d) => clearSecrets(kind, d));
        onSaved(saved);
      },
      (e) => {
        setCredential((d) => clearSecrets(kind, d));
        errors.show(e, [
          "name",
          "code",
          "description",
          ...adapter.connectionFields.map((f) => f.key),
          ...adapter.secretFields.map((f) => f.key),
        ]);
        if (!initial) setStep(connectionSaved ? 3 : 2);
      },
    );
  }
  return (
    <FormDrawer
      title={initial ? "编辑连接" : "创建服务连接"}
      description={
        initial
          ? initial.name
          : ["选择服务类型", "配置服务连接", "添加首个系统凭证"][step - 1]!
      }
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
          {!initial && step > 1 && !created && (
            <Button
              variant="ghost"
              disabled={save.pending}
              onClick={() => {
                errors.clear();
                setStep(step - 1);
              }}
            >
              上一步
            </Button>
          )}
          {!initial && step === 3 && (
            <Button
              variant="outline"
              disabled={save.pending || (!created && save.blocked)}
              onClick={() => (created ? onSaved(created) : void submit(true))}
            >
              {created ? "打开已创建的连接" : "暂不添加凭证"}
            </Button>
          )}
          {step < 3 && !initial ? (
            <Button
              onClick={advance}
              disabled={
                !kind ||
                (step === 1 && !available.some((c) => c.service_type === kind))
              }
            >
              下一步
            </Button>
          ) : (
            <Button
              disabled={
                save.pending ||
                save.blocked ||
                confirmAddress ||
                (!!initial && !dirty)
              }
              onClick={() => void submit()}
            >
              {save.pending
                ? "正在保存…"
                : initial
                  ? "保存连接"
                  : created
                    ? "保存凭证"
                    : "创建连接并添加凭证"}
            </Button>
          )}
        </>
      )}
    >
      <form
        ref={errors.formRef}
        noValidate
        onSubmit={(e) => e.preventDefault()}
        className="space-y-5"
      >
        <ErrorBox>{errors.error}</ErrorBox>
        {created && (
          <p role="status">
            连接已创建。可以继续保存首个凭证，或打开连接详情。
          </p>
        )}
        {save.blocked && (
          <p role="alert">{writeReviewMessage}请核对连接或凭证列表。</p>
        )}
        <fieldset
          disabled={save.pending || save.blocked || confirmAddress}
          className="space-y-5"
        >
          {step === 1 && (
            <fieldset className="space-y-4">
              <legend className="mb-2 font-semibold">选择服务类型</legend>
              <div className="relative max-w-sm">
                <Search
                  aria-hidden
                  className="pointer-events-none absolute left-3 top-3 size-4 text-muted-foreground"
                />
                <Input
                  type="search"
                  aria-label="搜索服务类型"
                  placeholder="搜索服务名称或用途"
                  className="pl-9"
                  value={typeQuery}
                  onChange={(e) => setTypeQuery(e.target.value)}
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {available.map((c) => (
                  <label
                    key={c.service_type}
                    className="flex cursor-pointer items-center gap-3 rounded-xl border bg-card p-4 hover:border-input hover:bg-muted/50 has-checked:border-primary has-checked:bg-muted"
                  >
                    <input
                      type="radio"
                      name="service-type"
                      aria-label={c.name}
                      className="sr-only"
                      checked={kind === c.service_type}
                      onChange={() => changeKind(c.service_type)}
                    />
                    <img
                      className="size-9 rounded-lg bg-white p-1"
                      src={"/service-icons/" + c.service_type + ".svg"}
                      alt=""
                    />
                    <span className="min-w-0 flex-1">
                      <strong className="block font-semibold">{c.name}</strong>
                      <small className="text-muted-foreground">
                        {purposes[c.service_type]}
                      </small>
                    </span>
                    {kind === c.service_type && (
                      <Check aria-hidden className="size-4" />
                    )}
                  </label>
                ))}
              </div>
              {!available.length && (
                <p role="status" className="py-4 text-sm text-muted-foreground">
                  没有匹配的服务类型
                </p>
              )}
            </fieldset>
          )}
          {step === 2 && (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="连接名称" required error={errors.fields.name}>
                  {(p) => (
                    <Input
                      {...p}
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                    />
                  )}
                </Field>
                <Field
                  label="连接编码"
                  hint="留空由系统生成"
                  error={errors.fields.code}
                >
                  {(p) => (
                    <Input
                      {...p}
                      readOnly={!!initial}
                      value={code}
                      onChange={(e) => setCode(e.target.value)}
                    />
                  )}
                </Field>
              </div>
              <Field label="说明" error={errors.fields.description}>
                {(p) => (
                  <Textarea
                    {...p}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                  />
                )}
              </Field>
              <ProviderFields
                fields={adapter.connectionFields}
                values={values}
                onChange={setValues}
                errors={errors.fields}
              />
              {initial && (
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={enabled}
                    onChange={(e) => setEnabled(e.target.checked)}
                  />
                  启用连接
                </label>
              )}
            </>
          )}
          {step === 3 && (
            <CredentialFields
              kind={kind}
              mode="create"
              draft={credential}
              update={setCredential}
              errors={errors.fields}
            />
          )}
        </fieldset>
        {confirmAddress && (
          <section role="alert" className="space-y-3 rounded-lg border p-4">
            <p>修改连接地址将改变此连接下全部凭证的访问目标。</p>
            <Button
              type="button"
              variant="outline"
              onClick={() => setConfirmAddress(false)}
            >
              继续编辑
            </Button>{" "}
            <Button type="button" onClick={() => void submit(false, true)}>
              确认修改地址
            </Button>
          </section>
        )}
      </form>
    </FormDrawer>
  );
}
