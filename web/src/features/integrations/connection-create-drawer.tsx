import { useLayoutEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Check } from "lucide-react";
import { ApiError, request } from "@/api/client";
import { Button } from "@/components/button";
import { AsyncBoundary, ErrorNotice, Notice } from "@/components/feedback";
import {
  Field,
  Input,
  NumberInput,
  Select,
  Textarea,
} from "@/components/fields";
import { ConfirmDialog, Drawer } from "@/components/overlays";
import { SheetClose } from "@/components/ui/sheet";
import { WizardSteps } from "@/components/wizard";
import { useApiQuery } from "@/hooks/use-api";
import { useFormErrors, useSubmission } from "@/hooks/use-form";
import { useUnsaved } from "@/hooks/use-unsaved";
import { defaultConfig, providerFor } from "@/domain/service-providers";
import type { ServiceConnection, ServiceType } from "@/types/integrations";

// getRandomValues also works on an HTTP intranet origin. Keep these codes for
// the lifetime of the draft, including reads after a lost write response.
function draftCode() {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
const validCode = (value: string) =>
  !value.trim() || /^[a-z0-9][a-z0-9_-]{0,63}$/.test(value.trim());

export function ConnectionCreateDrawer({
  onClose,
  projectId,
  listPath = "/admin/integrations",
}: {
  onClose: () => void;
  projectId?: string;
  listPath?: string;
}) {
  const apiPrefix = projectId ? `/projects/${projectId}` : "/admin";
  const owns = (item: ServiceConnection) =>
    projectId
      ? item.ownership_type === "project" && item.project_id === projectId
      : item.ownership_type === "platform";
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const queryClient = useQueryClient();
  const types = useApiQuery<{ items: ServiceType[] }>(
    ["service-types"],
    "/service-types",
  );
  const [step, setStep] = useState(0);
  const [type, setType] = useState("");
  const [replacement, setReplacement] = useState("");
  const [config, setConfig] = useState<Record<string, string>>({});
  const [form, setForm] = useState({
    name: "",
    code: "",
    description: "",
    enabled: true,
  });
  const [codes] = useState(() => ({
    connection: draftCode(),
  }));
  const [created, setCreated] = useState<ServiceConnection | null>(null);
  const [uncertain, setUncertain] = useState<"connection" | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkMessage, setCheckMessage] = useState("");
  const [checkError, setCheckError] = useState<unknown>(null);
  const [caOpen, setCaOpen] = useState(false);
  const saving = useRef(false);
  const excludedConnections = useRef(new Set<string>());

  const heading = useRef<HTMLHeadingElement>(null);
  const previousStep = useRef(step);
  useLayoutEffect(() => {
    if (previousStep.current === step) return;
    previousStep.current = step;
    heading.current?.focus();
  }, [step]);
  const errors = useFormErrors();
  const submission = useSubmission();
  const provider = providerFor(type);
  const capability = types.data?.data.items.find(
    (item) => item.service_type === type,
  );
  const configDirty = Boolean(
    provider &&
    Object.entries(defaultConfig(provider)).some(
      ([key, value]) => (config[key] ?? "") !== value,
    ),
  );
  const dirty = Boolean(
    type || form.name || form.code || form.description || !form.enabled,
  );
  const busy = submission.pending || checking;
  const locked = busy || Boolean(uncertain);
  const markSaved = useUnsaved(dirty || Boolean(uncertain), busy);
  const available =
    types.data?.data.items.filter((item) => providerFor(item.service_type)) ??
    [];
  function close() {
    markSaved();
    onClose();
  }
  function changeStep(next: number) {
    errors.clear();
    setStep(next);
  }
  function choose(value: string) {
    if (value === type) return;
    const next = providerFor(value);
    setType(value);
    setConfig(next ? defaultConfig(next) : {});

    setCaOpen(false);
    errors.clear();
    setReplacement("");
  }
  async function finish(connection: ServiceConnection) {
    await queryClient.invalidateQueries({ queryKey: ["service-directory"] });
    markSaved();
    const next = new URLSearchParams(params);
    next.delete("create");
    navigate(
      {
        pathname: `${listPath}/${connection.id}`,
        search: next.toString(),
      },
      { state: { connectionCreated: true } },
    );
  }
  function reveal(fields: Record<string, string>) {
    if (fields.custom_ca_pem) setCaOpen(true);
    return errors.validate(fields);
  }
  function validate() {
    const fields: Record<string, string> = {};
    if (!created) {
      if (!form.name.trim()) fields.name = "请输入连接名称";
      else if (Array.from(form.name.trim()).length > 100)
        fields.name = "连接名称不能超过 100 个字符";
      if (!validCode(form.code))
        fields.code =
          "使用 1–64 位小写字母、数字、下划线或短横线，以字母或数字开头";
      if (Array.from(form.description).length > 1000)
        fields.description = "说明不能超过 1000 个字符";
      for (const field of provider?.configFields ?? []) {
        if (field.key !== "custom_ca_pem" && !config[field.key]?.trim())
          fields[field.key] = `请输入${field.label}`;
      }
      if (
        provider?.defaultPort &&
        (!/^\d+$/.test(config.port ?? "") ||
          Number(config.port) < 1 ||
          Number(config.port) > 65535)
      )
        fields.port = "请输入 1–65535 的整数端口";
      if (config.base_url) {
        try {
          const url = new URL(config.base_url);
          if (
            !["http:", "https:"].includes(url.protocol) ||
            url.username ||
            url.password ||
            url.search ||
            url.hash
          )
            throw new Error();
          if (config.base_url.length > 2048) throw new Error();
        } catch {
          fields.base_url =
            "请输入完整的 HTTP 或 HTTPS 地址，不包含账号、查询参数或锚点";
        }
      }
      if (new TextEncoder().encode(config.custom_ca_pem ?? "").length > 16384)
        fields.custom_ca_pem = "公共 CA 不能超过 16 KiB";
    }
    if (Object.keys(fields).length) setStep(1);
    return reveal(fields);
  }
  async function save() {
    if (saving.current || locked || !provider || !capability || !validate())
      return;
    saving.current = true;
    errors.clear();
    setCheckMessage("");
    try {
      await submission.run(
        async () => {
          let connection = created;
          if (!connection) {
            const before = await request<{ items: ServiceConnection[] }>(
              `${apiPrefix}/service-connections`,
            );
            excludedConnections.current = new Set(
              before.data.items.map((item) => item.id),
            );
            if (
              before.data.items.some(
                (item) =>
                  owns(item) &&
                  item.code === (form.code.trim() || codes.connection),
              )
            ) {
              throw new ApiError(
                "CONNECTION_CODE_CONFLICT",
                "连接编码已存在，请更换编码",
                409,
              );
            }
            connection = (
              await request<ServiceConnection>(
                `${apiPrefix}/service-connections/${type}`,
                {
                  method: "POST",
                  body: {
                    ...form,
                    name: form.name.trim(),
                    code: form.code.trim() || codes.connection,
                    config: provider.configBody(config),
                  },
                },
              )
            ).data;
            setCreated(connection);
            void queryClient.invalidateQueries({
              queryKey: ["service-directory"],
            });
          }
          await finish(connection);
        },
        (error) => {
          if (error.uncertain) {
            setUncertain("connection");
            return;
          }
          setStep(1);
          const aliases: Record<string, string> = Object.fromEntries(
            provider.configFields.map((field) => [
              `config.${field.key}`,
              field.key,
            ]),
          );
          setCaOpen(true);
          errors.show(
            error,
            [
              "name",
              "code",
              "description",
              ...provider.configFields.map((f) => f.key),
            ],
            aliases,
          );
        },
      );
    } finally {
      saving.current = false;
    }
  }
  async function verify() {
    if (checking || !uncertain || saving.current) return;
    setChecking(true);
    setCheckError(null);
    setCheckMessage("");
    try {
      if (uncertain === "connection") {
        const directory = await request<{ items: ServiceConnection[] }>(
          `${apiPrefix}/service-connections`,
        );
        const found = directory.data.items.find(
          (item) =>
            item.service_type === type &&
            owns(item) &&
            item.code === (form.code.trim() || codes.connection),
        );
        if (!found || excludedConnections.current.has(found.id)) {
          setCheckMessage(
            "暂未查到连接，结果仍待确认。请稍后再次核实；不会重复提交。",
          );
          return;
        }
        setCreated(found);
        setUncertain(null);
        submission.setError(null);
        errors.clear();
        setCheckMessage("已找到此编码的连接。请在连接详情核对配置。");
        void queryClient.invalidateQueries({ queryKey: ["service-directory"] });
      }
    } catch (error) {
      setCheckError(error);
    } finally {
      setChecking(false);
    }
  }
  const fieldChange = (name: string) => {
    errors.change(name);
    if (!uncertain) {
      errors.setError("");
      submission.setError(null);
    }
  };
  return (
    <>
      <Drawer
        open
        wide
        title="添加服务连接"
        description={
          created
            ? "连接已保留，关闭不会删除已创建的连接。"
            : "填写服务地址和连接参数。创建后可在详情中选择首选凭据。"
        }
        dirty={dirty || Boolean(uncertain)}
        pending={busy}
        onClose={close}
        footer={
          <>
            <SheetClose
              render={
                <Button className="mr-auto" variant="outline" disabled={busy}>
                  取消
                </Button>
              }
            />
            {created && (
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => void finish(created)}
              >
                进入连接详情
              </Button>
            )}
            {step > 0 && !created && (
              <Button
                variant="outline"
                disabled={locked}
                onClick={() => changeStep(step - 1)}
              >
                上一步
              </Button>
            )}
            {uncertain ? (
              <Button pending={checking} onClick={() => void verify()}>
                核实创建结果
              </Button>
            ) : (
              <Button
                type="submit"
                form="connection-create-form"
                pending={submission.pending}
                disabled={
                  types.isPending ||
                  Boolean(types.error) ||
                  !provider ||
                  Boolean(created)
                }
              >
                {step === 0 ? "下一步" : "创建连接"}
              </Button>
            )}
          </>
        }
      >
        <WizardSteps steps={["选择类型", "连接信息"]} current={step} />
        <h3
          ref={heading}
          tabIndex={-1}
          className="mt-6 mb-4 text-base font-semibold outline-none"
        >
          {step === 0 ? "选择要连接的服务" : `${provider?.name} 连接信息`}
        </h3>
        <form
          id="connection-create-form"
          ref={errors.formRef}
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            if (locked) return;
            if (step === 0) {
              if (provider) changeStep(1);
            } else void save();
          }}
          className="grid gap-5"
        >
          {uncertain ? (
            <Notice tone="warning">
              连接
              创建结果尚未确认。请先核实，避免重复创建。关闭不会撤销已提交的请求。
            </Notice>
          ) : (
            <ErrorNotice
              error={
                submission.error instanceof ApiError
                  ? submission.error.message
                  : errors.error || submission.error
              }
            />
          )}
          {submission.error instanceof ApiError && (
            <details className="text-xs text-muted">
              <summary className="cursor-pointer">技术详情</summary>
              <p className="mt-2 break-all font-mono">
                {submission.error.code}
                {submission.error.requestId
                  ? ` · ${submission.error.requestId}`
                  : ""}
              </p>
            </details>
          )}
          {checkMessage && <Notice>{checkMessage}</Notice>}
          <ErrorNotice error={checkError} />
          {step === 0 ? (
            <AsyncBoundary
              loading={types.isPending}
              error={types.error}
              onRetry={() => void types.refetch()}
              empty={!available.length}
              emptyTitle="暂无可添加的服务类型"
            >
              <fieldset
                disabled={locked}
                className="grid grid-cols-2 gap-3"
                aria-label="服务类型"
              >
                {available.map((item) => {
                  const definition = providerFor(item.service_type)!;
                  return (
                    <label
                      key={item.service_type}
                      className={`service-type-card relative flex cursor-pointer items-start gap-3 rounded-lg border p-4 ${type === item.service_type ? "border-primary bg-accent-soft" : "hover:bg-surface-hover"}`}
                    >
                      <input
                        type="radio"
                        name="service_type"
                        value={item.service_type}
                        checked={type === item.service_type}
                        className="sr-only"
                        onChange={() => {
                          if (type !== item.service_type && configDirty)
                            setReplacement(item.service_type);
                          else choose(item.service_type);
                        }}
                      />
                      <img
                        src={`/service-icons/${item.service_type}.svg`}
                        alt=""
                        className="mt-0.5 size-6 shrink-0"
                      />
                      <span className="min-w-0">
                        <strong className="text-sm">{definition.name}</strong>
                        <span className="mt-1 block text-xs leading-5 text-muted">
                          {definition.description}
                        </span>
                      </span>
                      {type === item.service_type && (
                        <Check
                          aria-hidden
                          className="absolute top-2 right-2 size-3 text-primary"
                        />
                      )}
                    </label>
                  );
                })}
              </fieldset>
            </AsyncBoundary>
          ) : (
            provider && (
              <>
                <fieldset
                  hidden={step !== 1}
                  disabled={locked || Boolean(created)}
                  className={`${step === 1 ? "grid" : "hidden"} min-w-0 gap-5`}
                >
                  <Field label="连接名称" required error={errors.fields.name}>
                    <Input
                      name="name"
                      value={form.name}
                      placeholder={`例如：团队 ${provider.name}`}
                      onChange={(event) => {
                        fieldChange("name");
                        setForm({ ...form, name: event.target.value });
                      }}
                    />
                  </Field>
                  <Field
                    label="连接编码（可选）"
                    hint="在当前归属范围内唯一；留空自动生成，创建后不可修改。"
                    error={errors.fields.code}
                  >
                    <Input
                      name="code"
                      disabled={Boolean(created)}
                      className="font-mono"
                      value={form.code}
                      onChange={(event) => {
                        fieldChange("code");
                        setForm({ ...form, code: event.target.value });
                      }}
                    />
                  </Field>
                  <section
                    className="grid gap-4 border-t border-t-border-subtle pt-5"
                    aria-label="连接参数"
                  >
                    <h4 className="text-sm font-semibold">连接参数</h4>
                    <div
                      className={
                        provider.defaultPort
                          ? "grid grid-cols-[minmax(0,1fr)_150px] gap-4"
                          : "grid gap-4"
                      }
                    >
                      {provider.configFields
                        .filter((field) => field.key !== "custom_ca_pem")
                        .map((field) => (
                          <Field
                            key={field.key}
                            label={field.label}
                            required
                            error={errors.fields[field.key]}
                            className={
                              provider.defaultPort &&
                              !["host", "port"].includes(field.key)
                                ? "col-span-2"
                                : undefined
                            }
                            hint={
                              field.key === "base_url"
                                ? "填写实例根地址，可包含部署子路径；无需附加 API 路径。"
                                : field.key === "tls_mode"
                                  ? "校验证书与主机名时使用系统信任或自定义公共 CA，不跳过证书校验。"
                                  : undefined
                            }
                          >
                            {field.options ? (
                              <Select
                                value={config[field.key] ?? ""}
                                onValueChange={(value) => {
                                  fieldChange(field.key);
                                  setConfig({ ...config, [field.key]: value });
                                }}
                              >
                                {field.options.map((option) => (
                                  <option
                                    key={option.value}
                                    value={option.value}
                                  >
                                    {option.label}
                                  </option>
                                ))}
                              </Select>
                            ) : field.key === "port" ? (
                              <NumberInput
                                name="port"
                                label="端口"
                                min={1}
                                max={65535}
                                value={config.port ?? ""}
                                disabled={locked || Boolean(created)}
                                onValueChange={(value) => {
                                  fieldChange("port");
                                  setConfig({ ...config, port: value });
                                }}
                              />
                            ) : (
                              <Input
                                name={field.key}
                                value={config[field.key] ?? ""}
                                placeholder={
                                  field.key === "base_url"
                                    ? "https://service.example.com"
                                    : undefined
                                }
                                onChange={(event) => {
                                  fieldChange(field.key);
                                  setConfig({
                                    ...config,
                                    [field.key]: event.target.value,
                                  });
                                }}
                              />
                            )}
                          </Field>
                        ))}
                    </div>
                    <details
                      open={caOpen}
                      onToggle={(event) => setCaOpen(event.currentTarget.open)}
                      className="rounded-lg border p-3"
                    >
                      <summary className="cursor-pointer text-sm">
                        自定义公共 CA{" "}
                        <span className="ml-2 text-xs text-muted">
                          {config.custom_ca_pem
                            ? "已填写"
                            : "可选 · 默认使用系统信任"}
                        </span>
                      </summary>
                      <div className="mt-4">
                        <Field
                          label="公共 CA"
                          hint="仅填写 PEM 公共证书，不填写私钥。数据库需启用 TLS 校验才使用 CA。"
                          error={errors.fields.custom_ca_pem}
                        >
                          <Textarea
                            name="custom_ca_pem"
                            rows={5}
                            className="font-mono"
                            value={config.custom_ca_pem ?? ""}
                            onChange={(event) => {
                              fieldChange("custom_ca_pem");
                              setConfig({
                                ...config,
                                custom_ca_pem: event.target.value,
                              });
                            }}
                          />
                        </Field>
                      </div>
                    </details>
                  </section>
                  <Field label="说明（可选）" error={errors.fields.description}>
                    <Textarea
                      name="description"
                      rows={2}
                      value={form.description}
                      onChange={(event) => {
                        fieldChange("description");
                        setForm({ ...form, description: event.target.value });
                      }}
                    />
                  </Field>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={form.enabled}
                      onChange={(event) =>
                        setForm({ ...form, enabled: event.target.checked })
                      }
                    />
                    创建后启用
                  </label>
                </fieldset>
              </>
            )
          )}
        </form>
      </Drawer>
      <ConfirmDialog
        open={Boolean(replacement)}
        title="更换服务类型？"
        description="更换类型将清空已填写的连接参数。"
        confirmLabel="更换类型"
        onClose={() => setReplacement("")}
        onConfirm={() => choose(replacement)}
      />
    </>
  );
}
