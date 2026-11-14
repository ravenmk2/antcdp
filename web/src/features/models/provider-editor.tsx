import { useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/button";
import {
  Field,
  Input,
  Textarea,
  Select,
  NumberInput,
} from "@/components/fields";
import { AsyncBoundary, ErrorNotice, Notice } from "@/components/feedback";
import { Drawer, OverlayCancelButton } from "@/components/overlays";
import { Switch } from "@/components/ui/switch";
import { useFormErrors } from "@/hooks/use-form";
import { useUnsaved } from "@/hooks/use-unsaved";
import type { ApiResponse } from "@/api/client";
import { isVersionConflict } from "@/api/client";
import type { ModelProvider, ProviderKind, ProviderType } from "@/types/models";
import { modelKeys, modelRequest } from "./model-api";
import { ModelIconField } from "./model-icon";
import { useModelWrite } from "./model-write";
import {
  Section,
  useVersionedModelSave,
  restoreModelFocus,
} from "./model-shared";

function providerDraft(provider?: ModelProvider, type?: ProviderType) {
  return {
    name: provider?.name ?? "",
    icon_key: provider?.icon_key ?? null,
    code: provider?.code ?? "",
    description: provider?.description ?? "",
    provider_type: provider?.provider_type ?? ("deepseek" as ProviderKind),
    enabled: provider?.enabled ?? true,
    base_url: provider?.config.base_url ?? type?.default_base_url ?? "",
    region: provider?.config.region ?? "",
    custom_ca_pem: provider?.config.custom_ca_pem ?? "",
    connect_timeout_seconds: String(
      provider?.config.connect_timeout_seconds ?? 10,
    ),
    request_timeout_seconds: String(
      provider?.config.request_timeout_seconds ?? 120,
    ),
    auth_method: "api_key" as "api_key" | "none",
    secret: "",
  };
}

export function ModelProviderCreateDrawer({
  catalog,
  onClose,
  onSaved,
}: {
  catalog: ProviderType[];
  onClose: () => void;
  onSaved: (provider: ModelProvider) => void;
}) {
  return <ProviderForm catalog={catalog} onClose={onClose} onSaved={onSaved} />;
}

export function ModelProviderEditor({
  id,
  catalog,
  onClose,
  onSaved,
}: {
  id: string;
  catalog: ProviderType[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [returnFocus] = useState(() =>
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null,
  );
  function close() {
    onClose();
    restoreModelFocus(returnFocus);
  }
  function saved() {
    onSaved();
    restoreModelFocus(returnFocus);
  }
  const query = useQuery({
    queryKey: [...modelKeys, "provider-editor", id],
    queryFn: ({ signal }) =>
      modelRequest<ModelProvider>(`/providers/${id}`, { signal }),
    staleTime: Infinity,
    gcTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: false,
  });
  if (!query.data)
    return (
      <Drawer
        open
        wide
        title="编辑模型提供商"
        onClose={close}
        restoreFocusTo={returnFocus}
        finalFocus={false}
      >
        <AsyncBoundary
          loading={query.isPending}
          error={query.error}
          onRetry={() => void query.refetch()}
        />
      </Drawer>
    );
  return (
    <ProviderForm
      initial={query.data}
      catalog={catalog}
      onClose={close}
      onSaved={saved}
      returnFocus={returnFocus}
    />
  );
}

function ProviderForm({
  initial,
  catalog,
  onClose,
  onSaved,
  returnFocus,
}: {
  initial?: ApiResponse<ModelProvider>;
  catalog: ProviderType[];
  onClose: () => void;
  onSaved: (provider: ModelProvider) => void;
  returnFocus?: HTMLElement | null;
}) {
  const [baseline, setBaseline] = useState(() =>
    providerDraft(
      initial?.data,
      catalog.find((item) => item.provider_type === "deepseek"),
    ),
  );
  const [draft, setDraft] = useState(baseline);
  const errors = useFormErrors();
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [lastErrors, setLastErrors] = useState(errors.fields);
  if (lastErrors !== errors.fields) {
    setLastErrors(errors.fields);
    if (
      [
        "connect_timeout_seconds",
        "request_timeout_seconds",
        "region",
        "custom_ca_pem",
      ].some((key) => errors.fields[key])
    )
      setAdvancedOpen(true);
  }
  const command = useModelWrite<ModelProvider>(reportError);
  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline);
  const save = useVersionedModelSave<ModelProvider>(
    `/providers/${initial?.data.id}`,
    initial?.etag ?? "",
    (data) => {
      const value = providerDraft(data);
      setDraft(value);
      setBaseline(value);
    },
    finish,
    reportError,
  );
  const pending = command.pending || save.pending;
  const locked = pending || command.uncertain;
  const markSaved = useUnsaved(dirty || command.uncertain, pending);
  const selectedType = catalog.find(
    (type) => type.provider_type === draft.provider_type,
  );
  function finish(data: ModelProvider) {
    markSaved();
    onSaved(data);
  }
  function reportError(error: unknown) {
    errors.show(error, Object.keys(draft), {
      "config.base_url": "base_url",
      "config.region": "region",
      "config.custom_ca_pem": "custom_ca_pem",
      "config.connect_timeout_seconds": "connect_timeout_seconds",
      "config.request_timeout_seconds": "request_timeout_seconds",
      "authentication.secret.value": "secret",
      "authentication.secret": "secret",
    });
  }
  function update<K extends keyof typeof draft>(
    key: K,
    value: (typeof draft)[K],
  ) {
    setDraft((current) => ({ ...current, [key]: value }));
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    if (locked) return;
    const issues: Record<string, string> = {};
    if (!draft.name.trim()) issues.name = "请输入提供商名称";
    if ([...draft.name.trim()].length > 100)
      issues.name = "名称不能超过 100 个字符";
    if ([...draft.description].length > 1000)
      issues.description = "说明不能超过 1000 个字符";
    if (draft.code && !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(draft.code))
      issues.code = "编码使用小写字母、数字、连字符或下划线，以字母或数字开头";
    if (new TextEncoder().encode(draft.custom_ca_pem).length > 16384)
      issues.custom_ca_pem = "CA 证书不能超过 16 KiB";
    try {
      const url = new URL(draft.base_url);
      if (
        !["https:", "http:"].includes(url.protocol) ||
        url.username ||
        url.password ||
        url.search ||
        url.hash
      )
        issues.base_url = "请输入不含认证、查询参数或片段的 HTTP(S) 地址";
    } catch {
      issues.base_url = "请输入有效的服务地址";
    }
    for (const [key, min, max] of [
      ["connect_timeout_seconds", 1, 30],
      ["request_timeout_seconds", 10, 600],
    ] as const)
      if (
        !Number.isInteger(Number(draft[key])) ||
        Number(draft[key]) < min ||
        Number(draft[key]) > max
      )
        issues[key] = `请输入 ${min}–${max} 之间的整数`;
    if (!initial && draft.auth_method === "api_key" && !draft.secret)
      issues.secret = "请输入 API Key";
    if (!errors.validate(issues)) return;
    const body = {
      name: draft.name.trim(),
      icon_key: draft.icon_key,
      description: draft.description,
      enabled: draft.enabled,
      config: {
        base_url: draft.base_url.trim(),
        region: draft.region || null,
        custom_ca_pem: draft.custom_ca_pem || null,
        connect_timeout_seconds: Number(draft.connect_timeout_seconds),
        request_timeout_seconds: Number(draft.request_timeout_seconds),
      },
    };
    if (initial) void save.save(body);
    else
      command.run(
        "/providers",
        {
          method: "POST",
          body: {
            ...body,
            ...(draft.code ? { code: draft.code } : {}),
            provider_type: draft.provider_type,
            authentication: {
              auth_method: draft.auth_method,
              secret:
                draft.auth_method === "api_key"
                  ? { operation: "replace", value: draft.secret }
                  : { operation: "clear" },
            },
          },
        },

        (response) => finish(response.data),
      );
  }
  const footer = (
    <>
      <OverlayCancelButton />
      <Button
        type="submit"
        form="model-provider-form"
        pending={pending}
        disabled={
          command.uncertain || (Boolean(initial) && (save.blocked || !dirty))
        }
      >
        {initial ? "保存修改" : "创建提供商"}
      </Button>
    </>
  );
  const form = (
    <form
      id="model-provider-form"
      ref={errors.formRef}
      onSubmit={submit}
      noValidate
      className="model-editor-form space-y-7"
    >
      <ErrorNotice error={errors.error} />
      {command.recovery}
      {initial && save.recovery}
      <fieldset disabled={locked} className="space-y-7">
        <Section title="基本信息">
          <div className="grid grid-cols-2 gap-4">
            <Field label="提供商名称" required error={errors.fields.name}>
              <Input
                name="name"
                value={draft.name}
                maxLength={200}
                onChange={(e) => update("name", e.target.value)}
                autoFocus
              />
            </Field>
            <Field
              label="提供商类型"
              required
              hint={initial ? "创建后固定" : "类型决定可用协议与认证方式"}
            >
              <Select
                name="provider_type"
                value={draft.provider_type}
                disabled={Boolean(initial)}
                onValueChange={(value) => {
                  const type = catalog.find(
                    (item) => item.provider_type === value,
                  )!;
                  setDraft((current) => ({
                    ...current,
                    provider_type: value as ProviderKind,
                    auth_method: type.auth_methods.includes("none")
                      ? "none"
                      : "api_key",
                    secret: "",
                    base_url:
                      !current.base_url ||
                      current.base_url === selectedType?.default_base_url
                        ? type.default_base_url
                        : current.base_url,
                  }));
                }}
              >
                {catalog.map((type) => (
                  <option key={type.provider_type} value={type.provider_type}>
                    {type.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <ModelIconField
            value={draft.icon_key}
            onChange={(value) => update("icon_key", value)}
            fallback={selectedType?.default_icon_key ?? "model"}
          />
        </Section>
        <Section
          title="连接配置"
          description="服务地址使用供应商 API 根路径。已有模型引用时，目标或身份范围的修改可能被拒绝。"
        >
          <Field
            label="服务地址"
            required
            error={errors.fields.base_url}
            hint={
              draft.provider_type === "ollama"
                ? "localhost 指向后端运行环境，不是浏览器所在电脑。"
                : undefined
            }
          >
            <Input
              name="base_url"
              value={draft.base_url}
              placeholder="https://api.example.com"
              onChange={(e) => update("base_url", e.target.value)}
            />
          </Field>
          {selectedType?.default_base_url && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => update("base_url", selectedType.default_base_url)}
            >
              使用默认地址
            </Button>
          )}
        </Section>
        {!initial && (
          <Section
            title="认证"
            description="API Key 加密保存，提交后不会回显。"
          >
            <Field label="认证方式">
              <Select
                name="auth_method"
                value={draft.auth_method}
                onValueChange={(value) =>
                  update("auth_method", value as "api_key" | "none")
                }
              >
                {(selectedType?.auth_methods ?? []).map((method) => (
                  <option key={method} value={method}>
                    {method === "api_key" ? "API Key" : "无需认证"}
                  </option>
                ))}
              </Select>
            </Field>
            {draft.auth_method === "api_key" && (
              <Field label="API Key" required error={errors.fields.secret}>
                <Input
                  name="secret"
                  type="password"
                  autoComplete="new-password"
                  value={draft.secret}
                  onChange={(e) => update("secret", e.target.value)}
                />
              </Field>
            )}
          </Section>
        )}
        <details
          className="model-advanced"
          open={Boolean(errors.fields.code || errors.fields.description)}
        >
          <summary>
            <span>补充信息</span>
            <span className="model-advanced-summary">编码、说明与启用状态</span>
            <ChevronDown aria-hidden />
          </summary>
          <div className="model-advanced-body">
            {" "}
            {!initial && (
              <Field
                label="编码"
                error={errors.fields.code}
                hint="可留空，由系统生成；创建后不可更改"
              >
                <Input
                  name="code"
                  value={draft.code}
                  maxLength={64}
                  onChange={(e) => update("code", e.target.value)}
                />
              </Field>
            )}
            <Field label="说明" error={errors.fields.description}>
              <Textarea
                name="description"
                value={draft.description}
                maxLength={2000}
                rows={3}
                onChange={(e) => update("description", e.target.value)}
              />
            </Field>
            <label className="flex items-center justify-between rounded-lg border p-4 text-sm">
              <span>
                <span className="block font-medium">启用提供商</span>
                <span className="mt-1 block text-xs text-muted">
                  停用后不再允许发起新的模型调用
                </span>
              </span>
              <Switch
                checked={draft.enabled}
                onCheckedChange={(value) => update("enabled", value)}
                aria-label="启用提供商"
              />
            </label>
          </div>
        </details>
        <details
          className="model-advanced"
          open={advancedOpen}
          onToggle={(event) => setAdvancedOpen(event.currentTarget.open)}
        >
          <summary>
            <span>
              <SlidersHorizontal aria-hidden />
              高级连接配置
            </span>
            <span className="model-advanced-summary">
              超时、区域、自定义 CA
            </span>
            <ChevronDown aria-hidden />
          </summary>
          <div className="model-advanced-body">
            <div className="grid grid-cols-2 gap-4">
              {(
                [
                  ["connect_timeout_seconds", "连接超时（秒）", 1, 30],
                  ["request_timeout_seconds", "请求超时（秒）", 10, 600],
                ] as const
              ).map(([name, label, min, max]) => (
                <Field
                  key={name}
                  label={label}
                  error={errors.fields[name]}
                  required
                >
                  <NumberInput
                    name={name}
                    label={label}
                    value={draft[name]}
                    min={min}
                    max={max}
                    onValueChange={(value) => update(name, value)}
                  />
                </Field>
              ))}
            </div>
            <Field label="区域" hint="仅在供应商连接需要时填写">
              <Input
                name="region"
                value={draft.region}
                maxLength={64}
                onChange={(e) => update("region", e.target.value)}
              />
            </Field>
            <Field
              label="自定义 CA 证书"
              error={errors.fields.custom_ca_pem}
              hint="可选，PEM 格式。不会关闭 TLS 证书校验。"
            >
              <Textarea
                name="custom_ca_pem"
                value={draft.custom_ca_pem}
                rows={4}
                className="font-mono text-xs"
                onChange={(e) => update("custom_ca_pem", e.target.value)}
              />
            </Field>
          </div>
        </details>
      </fieldset>
    </form>
  );
  return (
    <Drawer
      open
      wide
      title={initial ? "编辑提供商" : "新建提供商"}
      restoreFocusTo={returnFocus}
      onClose={onClose}
      dirty={dirty || command.uncertain}
      pending={pending}
      footer={footer}
    >
      {form}
    </Drawer>
  );
}

export function ModelAuthenticationEditor({
  provider,
  etag,
  catalog,
  onClose,
  onSaved,
}: {
  provider: ModelProvider;
  etag: string;
  catalog: ProviderType[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [returnFocus] = useState(() =>
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null,
  );
  function close() {
    onClose();
    restoreModelFocus(returnFocus);
  }
  const [method, setMethod] = useState(provider.authentication.auth_method);
  const [operation, setOperation] = useState<"keep" | "replace" | "clear">(
    "keep",
  );
  const [secret, setSecret] = useState("");
  const errors = useFormErrors();
  const command = useModelWrite<ModelProvider>((error) =>
    errors.show(error, ["secret"], {
      "secret.value": "secret",
      secret: "secret",
    }),
  );
  const [current, setCurrent] = useState({ data: provider, etag });
  const [latest, setLatest] = useState<ApiResponse<ModelProvider>>();
  const [loading, setLoading] = useState(false);
  const [readError, setReadError] = useState<unknown>();
  const conflict = isVersionConflict(command.error);
  const dirty =
    method !== provider.authentication.auth_method ||
    operation !== "keep" ||
    secret !== "";
  const markSaved = useUnsaved(dirty || command.uncertain, command.pending);
  return (
    <Drawer
      open
      title="管理认证"
      description="只显示认证状态，不读取已保存的秘密。"
      onClose={close}
      dirty={dirty || command.uncertain}
      pending={command.pending || loading}
      footer={
        <>
          <OverlayCancelButton />
          <Button
            form="model-auth-form"
            type="submit"
            pending={command.pending}
            disabled={
              !dirty ||
              command.uncertain ||
              !current.etag ||
              conflict ||
              loading
            }
          >
            保存认证
          </Button>
        </>
      }
    >
      <form
        id="model-auth-form"
        ref={errors.formRef}
        noValidate
        className="space-y-5"
        onSubmit={(e) => {
          e.preventDefault();
          if (command.pending || command.uncertain || conflict || loading)
            return;
          if (
            !errors.validate(
              operation === "replace" && !secret
                ? { secret: "请输入新的 API Key" }
                : {},
            )
          )
            return;
          command.run(
            `/providers/${provider.id}/authentication`,
            {
              method: "PUT",
              etag: current.etag,
              body: {
                auth_method: method,
                secret:
                  operation === "replace"
                    ? { operation, value: secret }
                    : { operation },
              },
            },

            () => {
              markSaved();
              onSaved();
              restoreModelFocus(returnFocus);
            },
          );
        }}
      >
        {command.recovery}
        <ErrorNotice error={errors.error} />
        <ErrorNotice error={readError} />
        {conflict && (
          <Notice tone="warning" title="认证配置已更新">
            新输入的秘密仍保留。读取最新认证状态并确认后，才能继续保存。
            <div className="mt-3">
              <Button
                variant="outline"
                pending={loading}
                onClick={() => {
                  setLoading(true);
                  setReadError(undefined);
                  void modelRequest<ModelProvider>(`/providers/${provider.id}`)
                    .then(setLatest)
                    .catch(setReadError)
                    .finally(() => setLoading(false));
                }}
              >
                读取最新认证状态
              </Button>
            </div>
            {latest && (
              <div className="mt-3 space-y-3">
                <p>
                  最新认证方式：{latest.data.authentication.auth_method}，
                  {latest.data.authentication.has_secret
                    ? "已保存秘密"
                    : "未保存秘密"}
                  。
                </p>
                <Button
                  variant="outline"
                  disabled={!latest.etag}
                  onClick={() => {
                    setCurrent(latest);
                    if (
                      operation === "keep" &&
                      method !== latest.data.authentication.auth_method
                    )
                      setOperation("replace");
                    command.clearError();
                    errors.clear();
                    setLatest(undefined);
                  }}
                >
                  以最新认证状态继续编辑
                </Button>
              </div>
            )}
          </Notice>
        )}
        <Notice>
          当前{current.data.authentication.has_secret ? "已保存" : "未保存"}
          认证秘密。清空必须显式选择；需要 Key 的配置可以保存，但未配置 Key
          时无法调用。
        </Notice>
        <fieldset
          disabled={command.pending || command.uncertain || loading}
          className="space-y-5"
        >
          <Field label="认证方式">
            <Select
              value={method}
              onValueChange={(value) => {
                setMethod(value as typeof method);
                setOperation(value === "none" ? "clear" : "replace");
              }}
            >
              {catalog
                .find((type) => type.provider_type === provider.provider_type)
                ?.auth_methods.map((item) => (
                  <option key={item} value={item}>
                    {item === "api_key" ? "API Key" : "无需认证"}
                  </option>
                ))}
            </Select>
          </Field>
          <Field label="API Key 操作">
            <Select
              value={operation}
              disabled={method === "none"}
              onValueChange={(value) => setOperation(value as typeof operation)}
            >
              <option
                value="keep"
                disabled={method !== current.data.authentication.auth_method}
              >
                保留当前 API Key
              </option>
              <option value="replace">更换 API Key</option>
              <option value="clear">清除 API Key</option>
            </Select>
          </Field>
          {operation === "replace" && (
            <Field label="新的 API Key" required error={errors.fields.secret}>
              <Input
                name="secret"
                type="password"
                value={secret}
                autoComplete="new-password"
                onChange={(e) => setSecret(e.target.value)}
              />
            </Field>
          )}
          {operation === "clear" && (
            <Notice tone="warning">
              保存后将清除当前 API Key，依赖该密钥的模型将无法调用。
            </Notice>
          )}
        </fieldset>
      </form>
    </Drawer>
  );
}
