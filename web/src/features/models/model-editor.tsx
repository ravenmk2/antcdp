import { useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Settings2,
  SlidersHorizontal,
  Brain,
  Type,
  Image,
  Wrench,
  Braces,
  Radio,
} from "lucide-react";
import { Button } from "@/components/button";
import {
  Field,
  FieldRoot,
  FieldLabel,
  FieldDescription,
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
import { ApiError } from "@/api/client";
import { ModelIconField } from "./model-icon";
import { Tabs } from "@/components/layout";
import type { ApiResponse } from "@/api/client";
import type {
  JsonObject,
  ModelCapabilities,
  ModelDefinition,
  ModelProtocol,
  ModelProvider,
  ProviderType,
} from "@/types/models";
import { modelKeys, modelRequest } from "./model-api";
import { useModelWrite } from "./model-write";
import {
  capabilityNames,
  protocolNames,
  Section,
  useVersionedModelSave,
  restoreModelFocus,
} from "./model-shared";
import { parseParameterObject, validateParameters } from "./model-parameters";

interface Seed {
  protocol?: ModelProtocol;
  model_id: string;
  display_name: string | null;
}
function modelDraft(
  model: ModelDefinition | undefined,
  type: ProviderType,
  seed?: Seed,
) {
  return {
    name: model?.name ?? seed?.display_name ?? seed?.model_id ?? "",
    description: model?.description ?? "",
    icon_key: model?.icon_key ?? null,
    model_id: model?.model_id ?? seed?.model_id ?? "",
    protocol:
      model?.protocol ??
      seed?.protocol ??
      type.protocols.find((item) => item.available)?.protocol ??
      ("chat_completions" as ModelProtocol),
    enabled: model?.enabled ?? true,
    context_window: model ? String(model.context_window) : "",
    max_output_tokens: model ? String(model.max_output_tokens) : "",
    capabilities:
      model?.declared_capabilities ??
      ({
        text_input: "unsupported",
        image_input: "unsupported",
        tool_calling: "unsupported",
        structured_output: "unsupported",
        streaming: "unsupported",
        thinking: "unsupported",
      } as ModelCapabilities),
    thinking_levels: model?.thinking_levels ?? [],
    thinking_mapping: Object.fromEntries(
      Object.entries(model?.thinking_mapping ?? {}).map(([key, value]) => [
        key,
        JSON.stringify(value),
      ]),
    ),
  };
}

function draftSignature(draft: ReturnType<typeof modelDraft>) {
  return JSON.stringify({
    ...draft,
    thinking_mapping: draft.thinking_levels.map(
      (key) => draft.thinking_mapping[key]?.trim() ?? "",
    ),
  });
}

export function ModelEditor({
  provider,
  type,
  id,
  seed,
  onClose,
  onSaved,
  onOutcome,
  restoreFocusTo,
}: {
  provider: ModelProvider;
  type: ProviderType;
  id?: string;
  seed?: Seed;
  onClose: () => void;
  onSaved: () => void;
  onOutcome?: (state: "failed" | "unknown") => void;
  restoreFocusTo?: HTMLElement | null;
}) {
  const [returnFocus] = useState(
    () =>
      restoreFocusTo ??
      (document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null),
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
    queryKey: [...modelKeys, "model-editor", id],
    queryFn: ({ signal }) =>
      modelRequest<ModelDefinition>(`/definitions/${id}`, { signal }),
    enabled: Boolean(id),
    staleTime: Infinity,
    gcTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: false,
  });
  if (id && !query.data)
    return (
      <Drawer
        open
        wide
        title="编辑模型"
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
    <ModelForm
      provider={provider}
      type={type}
      initial={id ? query.data : undefined}
      seed={seed}
      onClose={close}
      onSaved={saved}
      onOutcome={onOutcome}
      returnFocus={returnFocus}
    />
  );
}

function ModelForm({
  provider,
  type,
  initial,
  seed,
  onClose,
  onSaved,
  onOutcome,
  returnFocus,
}: {
  provider: ModelProvider;
  type: ProviderType;
  initial?: ApiResponse<ModelDefinition>;
  seed?: Seed;
  onClose: () => void;
  onSaved: () => void;
  onOutcome?: (state: "failed" | "unknown") => void;
  returnFocus: HTMLElement | null;
}) {
  const [baseline, setBaseline] = useState(() =>
    modelDraft(initial?.data, type, seed),
  );
  const [draft, setDraft] = useState(baseline);
  const [section, setSection] = useState("basic");
  function revealField(field: string) {
    setSection(
      field.startsWith("thinking")
        ? "thinking"
        : [
              "declared_capabilities",
              "context_window",
              "max_output_tokens",
            ].includes(field)
          ? "capabilities"
          : "basic",
    );
  }
  const errors = useFormErrors();
  const command = useModelWrite<ModelDefinition>(reportError);
  const dirty = draftSignature(draft) !== draftSignature(baseline);
  const save = useVersionedModelSave<ModelDefinition>(
    `/definitions/${initial?.data.id}`,
    initial?.etag ?? "",
    (data) => {
      const next = modelDraft(data, type);
      setDraft(next);
      setBaseline(next);
    },
    finish,
    reportError,
  );
  const pending = command.pending || save.pending;
  const markSaved = useUnsaved(dirty || command.uncertain, pending);
  const protocol = type.protocols.find(
    (item) => item.protocol === draft.protocol,
  );
  const schema = protocol?.parameter_schema ?? {};
  const thinkingOptions = protocol?.thinking_options ?? [];
  function finish() {
    markSaved();
    onSaved();
  }
  function reportError(error: unknown) {
    onOutcome?.(
      error instanceof ApiError && error.uncertain ? "unknown" : "failed",
    );
    if (error instanceof ApiError)
      revealField(error.details.find((detail) => detail.field)?.field ?? "");
    errors.show(error, [
      ...Object.keys(draft),
      "declared_capabilities",
      ...draft.thinking_levels.map((key) => "thinking_mapping." + key),
    ]);
  }
  function update<K extends keyof typeof draft>(
    key: K,
    value: (typeof draft)[K],
  ) {
    setDraft((current) => ({ ...current, [key]: value }));
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    if (pending || command.uncertain) return;
    const issues: Record<string, string> = {};
    if (!draft.name.trim()) issues.name = "请输入模型名称";
    if ([...draft.name.trim()].length > 100)
      issues.name = "名称不能超过 100 个字符";
    if ([...draft.description].length > 1000)
      issues.description = "说明不能超过 1000 个字符";
    if (
      !draft.model_id ||
      new TextEncoder().encode(draft.model_id).length > 255
    )
      issues.model_id = "模型 ID 必填，且不超过 255 字节";
    if (!protocol?.available)
      issues.protocol = protocol?.reason || "当前协议不可用";
    for (const key of ["context_window", "max_output_tokens"] as const)
      if (
        !Number.isInteger(Number(draft[key])) ||
        Number(draft[key]) < 1 ||
        Number(draft[key]) > 2000000
      )
        issues[key] = "请输入 1–2,000,000 之间的整数";
    if (Number(draft.max_output_tokens) > Number(draft.context_window))
      issues.max_output_tokens = "最大输出不能超过上下文窗口";
    const mapping: Record<string, JsonObject> = {};
    if (
      draft.capabilities.thinking !== "supported" &&
      draft.thinking_levels.some((key) => key !== "none")
    ) {
      issues.declared_capabilities = "已启用思考档位，请开启思考能力";
    }
    for (const key of draft.thinking_levels) {
      const raw = draft.thinking_mapping[key]?.trim();
      if (!raw) continue;
      const field = "thinking_mapping." + key;
      try {
        const value = parseParameterObject(raw);
        if (
          !Object.keys(value).length ||
          Object.keys(value).some(
            (k) =>
              !["thinking", "reasoning_effort", "output_config"].includes(k),
          )
        ) {
          issues[field] = "请填写当前协议的思考参数";
        } else {
          const invalid = validateParameters(value, schema);
          if (invalid) issues[field] = invalid;
          mapping[key] = value;
        }
      } catch {
        issues[field] = "请输入有效的 JSON 对象";
      }
    }
    if (Object.keys(issues).length) revealField(Object.keys(issues)[0]);
    if (!errors.validate(issues)) return;
    const body = {
      name: draft.name.trim(),
      icon_key: draft.icon_key,
      description: draft.description,
      enabled: draft.enabled,
      declared_capabilities: draft.capabilities,
      context_window: Number(draft.context_window),
      max_output_tokens: Number(draft.max_output_tokens),
      thinking_levels: draft.thinking_levels,
      thinking_mapping: mapping,
    };
    if (initial) void save.save(body);
    else
      command.run(
        "/definitions",
        {
          method: "POST",
          body: {
            ...body,
            provider_id: provider.id,
            model_id: draft.model_id,
            protocol: draft.protocol,
          },
        },

        finish,
      );
  }
  return (
    <Drawer
      open
      wide
      title={initial ? "编辑模型" : "添加模型"}
      restoreFocusTo={returnFocus}
      description={provider.name}
      onClose={() => {
        if (!command.uncertain) onClose();
      }}
      dirty={dirty || command.uncertain}
      pending={pending}
      footer={
        <>
          <OverlayCancelButton disabled={command.uncertain} />
          <Button
            type="submit"
            form="model-definition-form"
            pending={pending}
            disabled={
              command.uncertain ||
              (Boolean(initial) && (save.blocked || !dirty))
            }
          >
            {initial ? "保存修改" : "添加模型"}
          </Button>
        </>
      }
    >
      <form
        id="model-definition-form"
        ref={errors.formRef}
        onSubmit={submit}
        noValidate
        className="model-definition-editor space-y-7"
      >
        <ErrorNotice error={errors.error} />
        {command.recovery}
        {initial && save.recovery}
        <Tabs
          label="模型配置分区"
          value={section}
          onChange={setSection}
          items={[
            {
              value: "basic",
              label: (
                <>
                  <Settings2 className="mr-2 size-4" />
                  基本配置
                </>
              ),
            },
            {
              value: "capabilities",
              label: (
                <>
                  <SlidersHorizontal className="mr-2 size-4" />
                  能力与限制
                </>
              ),
            },
            {
              value: "thinking",
              label: (
                <>
                  <Brain className="mr-2 size-4" />
                  思考档位
                </>
              ),
            },
          ]}
        />
        <fieldset disabled={pending || command.uncertain} className="space-y-7">
          <div
            role="tabpanel"
            aria-label="基本配置"
            hidden={section !== "basic"}
            className="space-y-6"
          >
            <Section title="模型标识">
              <div className="model-identity-grid">
                <Field
                  className="form-full"
                  label="模型名称"
                  required
                  error={errors.fields.name}
                >
                  <Input
                    name="name"
                    value={draft.name}
                    maxLength={200}
                    autoFocus
                    onChange={(e) => update("name", e.target.value)}
                  />
                </Field>
                <Field
                  label="模型 ID"
                  required
                  error={errors.fields.model_id}
                  hint="使用供应商返回的模型或部署标识；创建后固定"
                >
                  <Input
                    name="model_id"
                    value={draft.model_id}
                    readOnly={Boolean(initial)}
                    onChange={(e) => update("model_id", e.target.value)}
                  />
                </Field>
                <Field
                  label="调用协议"
                  required
                  error={errors.fields.protocol}
                  hint="创建后固定；协议可用性由已实现的适配器提供"
                >
                  <Select
                    name="protocol"
                    value={draft.protocol}
                    disabled={Boolean(initial)}
                    onValueChange={(value) =>
                      setDraft((current) => ({
                        ...current,
                        protocol: value as ModelProtocol,
                        thinking_levels: [],
                        thinking_mapping: {},
                      }))
                    }
                  >
                    {type.protocols.map((item) => (
                      <option
                        key={item.protocol}
                        value={item.protocol}
                        disabled={!item.available}
                      >
                        {protocolNames[item.protocol]}
                        {!item.available
                          ? `（${item.reason || "不可用"}）`
                          : ""}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field
                  className="form-full"
                  label="说明"
                  error={errors.fields.description}
                >
                  <Textarea
                    name="description"
                    rows={2}
                    value={draft.description}
                    maxLength={2000}
                    onChange={(e) => update("description", e.target.value)}
                  />
                </Field>
                <label className="form-full flex items-center justify-between rounded-lg border p-3 text-sm">
                  启用模型
                  <Switch
                    aria-label="启用模型"
                    checked={draft.enabled}
                    onCheckedChange={(value) => update("enabled", value)}
                  />
                </label>
              </div>
            </Section>
            <ModelIconField
              value={draft.icon_key}
              onChange={(value) => update("icon_key", value)}
              fallback={provider.icon_key || type.default_icon_key || "model"}
            />
          </div>
          <div
            role="tabpanel"
            aria-label="能力与限制"
            hidden={section !== "capabilities"}
            className="space-y-6"
          >
            {errors.fields.declared_capabilities && (
              <Notice tone="warning">
                {errors.fields.declared_capabilities}
              </Notice>
            )}
            <Section
              title="模型能力"
              description="开启表示允许使用该能力；关闭表示未配置使用，不代表经过实测。"
            >
              <div className="model-capability-list">
                {Object.entries(capabilityNames).map(([key, label]) => {
                  const Icon = {
                    text_input: Type,
                    image_input: Image,
                    tool_calling: Wrench,
                    structured_output: Braces,
                    streaming: Radio,
                    thinking: Brain,
                  }[key as keyof ModelCapabilities];
                  const hint = {
                    text_input: "接收文本并生成回复",
                    image_input: "接收和理解图片",
                    tool_calling: "请求调用工具或函数",
                    structured_output: "按 JSON 对象或 JSON Schema 返回回复",
                    streaming: "逐步返回生成内容",
                    thinking: "使用模型的思考参数",
                  }[key as keyof ModelCapabilities];
                  return (
                    <label key={key} className="model-capability-row">
                      <Icon aria-hidden className="size-5 text-muted" />
                      <span className="flex-1">
                        <span className="block text-sm font-medium">
                          {label}
                        </span>
                        <span className="text-xs text-muted">{hint}</span>
                      </span>
                      <Switch
                        aria-label={label}
                        checked={
                          draft.capabilities[key as keyof ModelCapabilities] ===
                          "supported"
                        }
                        onCheckedChange={(checked) =>
                          update("capabilities", {
                            ...draft.capabilities,
                            [key]: checked ? "supported" : "unsupported",
                          })
                        }
                      />
                    </label>
                  );
                })}
              </div>
            </Section>
            <Section title="上下文与输出限制">
              <div className="grid grid-cols-2 gap-4">
                {(
                  [
                    ["context_window", "上下文窗口（Token）"],
                    ["max_output_tokens", "模型输出上限（Token）"],
                  ] as const
                ).map(([name, label]) => (
                  <Field
                    key={name}
                    label={label}
                    required
                    error={errors.fields[name]}
                  >
                    <NumberInput
                      name={name}
                      label={label}
                      min={1}
                      max={2000000}
                      value={draft[name]}
                      onValueChange={(value) => update(name, value)}
                    />
                  </Field>
                ))}
              </div>
            </Section>
          </div>
          <div
            role="tabpanel"
            aria-label="思考档位"
            hidden={section !== "thinking"}
            className="space-y-6"
          >
            <Section
              title="支持的思考档位"
              description="启用模型支持的档位。提供商映射留空时使用输入框所示的默认值。"
            >
              {(errors.fields.thinking_levels ||
                errors.fields.thinking_mapping) && (
                <Notice tone="warning">
                  {errors.fields.thinking_levels ||
                    errors.fields.thinking_mapping}
                </Notice>
              )}
              <div className="model-thinking-levels">
                {thinkingOptions.map((option) => {
                  const key = option.key;
                  const checked = draft.thinking_levels.includes(key);
                  const field = "thinking_mapping." + key;
                  return (
                    <div
                      className="model-thinking-level"
                      data-checked={checked}
                      key={key}
                    >
                      <label className="flex w-20 shrink-0 items-center gap-3 text-sm font-medium">
                        <input
                          type="checkbox"
                          className="size-4 accent-[var(--accent)]"
                          checked={checked}
                          onChange={(event) => {
                            const enabled = event.target.checked;
                            setDraft((current) => ({
                              ...current,
                              thinking_levels: thinkingOptions
                                .filter((item) =>
                                  item.key === key
                                    ? enabled
                                    : current.thinking_levels.includes(
                                        item.key,
                                      ),
                                )
                                .map((item) => item.key),
                              capabilities:
                                enabled && key !== "none"
                                  ? {
                                      ...current.capabilities,
                                      thinking: "supported",
                                    }
                                  : current.capabilities,
                            }));
                          }}
                        />
                        {option.label}
                      </label>
                      <FieldRoot
                        className="min-w-0 flex-1"
                        label={option.label + "的提供商映射"}
                        error={errors.fields[field]}
                      >
                        <FieldLabel className="sr-only" />
                        <Input
                          name={field}
                          className="font-mono text-xs"
                          disabled={!checked}
                          value={draft.thinking_mapping[key] ?? ""}
                          placeholder={JSON.stringify(option.parameters)}
                          onChange={(e) =>
                            update("thinking_mapping", {
                              ...draft.thinking_mapping,
                              [key]: e.target.value,
                            })
                          }
                        />
                        <FieldDescription />
                      </FieldRoot>
                    </div>
                  );
                })}
              </div>
            </Section>
          </div>
          {!provider.enabled && (
            <Notice tone="warning">
              提供商目前已停用。可以保存模型配置，但无法发起调用。
            </Notice>
          )}
        </fieldset>
      </form>
    </Drawer>
  );
}
