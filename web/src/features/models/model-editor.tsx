import { useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Settings2,
  SlidersHorizontal,
  Brain,
  Type,
  Image,
  Wrench,
  Radio,
} from "lucide-react";
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
import {
  commonParameters,
  parseParameterObject,
  validateParameters,
} from "./model-parameters";

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
  const parameters = model?.default_parameters ?? {};
  const structuredStop =
    Array.isArray(parameters.stop) &&
    parameters.stop.every(
      (item) => typeof item === "string" && !/[\r\n]/.test(item),
    );
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
        streaming: "unsupported",
        thinking: "unsupported",
      } as ModelCapabilities),
    temperature:
      parameters.temperature === undefined
        ? ""
        : String(parameters.temperature),
    top_p: parameters.top_p === undefined ? "" : String(parameters.top_p),
    parameterMax:
      parameters.max_output_tokens === undefined
        ? ""
        : String(parameters.max_output_tokens),
    stop: structuredStop ? (parameters.stop as string[]).join("\n") : "",
    advanced: JSON.stringify(
      Object.fromEntries(
        Object.entries(parameters).filter(
          ([key]) =>
            !commonParameters.includes(
              key as (typeof commonParameters)[number],
            ) ||
            (key === "stop" && !structuredStop),
        ),
      ),
      null,
      2,
    ),
    thinking_levels:
      model?.thinking_levels ??
      model?.thinking_options
        .filter((option) => option.key !== "standard")
        .map((option) => option.key) ??
      [],
    thinking_mapping: JSON.stringify(
      type.provider_type === "custom" ? (model?.thinking_mapping ?? {}) : {},
      null,
      2,
    ),
  };
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
              "advanced",
              "temperature",
              "top_p",
              "parameterMax",
              "stop",
              "default_parameters",
            ].includes(field)
          ? "parameters"
          : "basic",
    );
  }
  const errors = useFormErrors();
  const command = useModelWrite<ModelDefinition>(reportError);
  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline);
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
  const generationSchema = {
    ...schema,
    properties: Object.fromEntries(
      Object.entries((schema.properties ?? {}) as JsonObject).filter(
        ([key]) =>
          !["thinking", "reasoning_effort", "output_config"].includes(key),
      ),
    ),
  };
  const properties = generationSchema.properties as Record<string, JsonObject>;
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
    errors.show(
      error,
      [
        ...Object.keys(draft),
        "default_parameters",
        "thinking_levels",
        "thinking_mapping",
      ],
      { default_parameters: "advanced" },
    );
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
    let parameters: JsonObject = {};
    try {
      parameters = parseParameterObject(draft.advanced);
    } catch {
      issues.advanced = "高级参数必须是有效的 JSON 对象";
    }
    for (const [key, value] of [
      ["temperature", draft.temperature],
      ["top_p", draft.top_p],
      ["max_output_tokens", draft.parameterMax],
    ] as const)
      if (value !== "") {
        if (key in parameters)
          issues.advanced = `参数 ${key} 与上方结构化字段重复，请仅保留一处`;
        parameters[key] = Number(value);
      }
    if (draft.stop) {
      if ("stop" in parameters) issues.advanced = "停止词与高级参数 stop 重复";
      parameters.stop = draft.stop.split("\n");
    }
    const parameterError = validateParameters(parameters, generationSchema);
    if (parameterError) issues.advanced = parameterError;
    if (
      typeof parameters.max_output_tokens === "number" &&
      parameters.max_output_tokens > Number(draft.max_output_tokens)
    )
      issues.advanced = "默认最大输出不能超过模型最大输出限制";
    let mapping: JsonObject = {};
    if (
      draft.thinking_levels.some(
        (key) => !thinkingOptions.some((option) => option.key === key),
      )
    ) {
      issues.thinking_levels = "所选档位不适用于当前协议，请重新选择";
    }
    if (type.provider_type === "custom") {
      try {
        const configured = parseParameterObject(draft.thinking_mapping);
        mapping = Object.fromEntries(
          draft.thinking_levels.map((key) => [key, configured[key]]),
        );
        for (const key of draft.thinking_levels) {
          const value = mapping[key];
          if (
            !value ||
            typeof value !== "object" ||
            Array.isArray(value) ||
            !Object.keys(value).length
          ) {
            issues.thinking_mapping = "请为每个已选档位填写请求参数映射";
            break;
          }
          const invalid = validateParameters(value as JsonObject, schema);
          if (invalid) {
            issues.thinking_mapping = invalid;
            break;
          }
          if (
            Object.keys(value).some(
              (key) =>
                !["thinking", "reasoning_effort", "output_config"].includes(
                  key,
                ),
            )
          ) {
            issues.thinking_mapping = "映射中只能包含思考参数";
            break;
          }
        }
      } catch {
        issues.thinking_mapping = "请输入有效的 JSON 对象";
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
      default_parameters: parameters,
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
              value: "parameters",
              label: (
                <>
                  <SlidersHorizontal className="mr-2 size-4" />
                  生成参数
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
                        thinking_mapping: "{}",
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
                    streaming: Radio,
                    thinking: Brain,
                  }[key as keyof ModelCapabilities];
                  const hint = {
                    text_input: "接收文本并生成回复",
                    image_input: "接收和理解图片",
                    tool_calling: "请求调用工具或函数",
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
            aria-label="生成参数"
            hidden={section !== "parameters"}
            className="space-y-6"
          >
            <Section
              title="默认生成参数"
              description="留空使用供应商默认值。默认请求输出量不能超过模型输出上限；可用字段由当前协议决定。"
            >
              <div className="grid grid-cols-2 gap-4">
                {(
                  [
                    ["temperature", "Temperature"],
                    ["top_p", "Top P"],
                    ["parameterMax", "默认请求输出量"],
                  ] as const
                )
                  .filter(
                    ([key]) =>
                      properties[
                        key === "parameterMax" ? "max_output_tokens" : key
                      ] || draft[key] !== "",
                  )
                  .map(([key, label]) => (
                    <Field key={key} label={label}>
                      <Input
                        name={key}
                        inputMode="decimal"
                        value={draft[key]}
                        onChange={(e) => update(key, e.target.value)}
                      />
                    </Field>
                  ))}
              </div>
              {(properties.stop || draft.stop) && (
                <Field
                  label="停止词"
                  hint="每行一个，最多 4 个。含换行的停止词请在高级 JSON 中设置。"
                >
                  <Textarea
                    name="stop"
                    rows={3}
                    value={draft.stop}
                    onChange={(e) => update("stop", e.target.value)}
                  />
                </Field>
              )}
              <Field
                label="高级参数（JSON）"
                error={errors.fields.advanced}
                hint="保留当前适配器注册的扩展参数，不允许消息、工具、请求头或连接配置"
              >
                <Textarea
                  name="advanced"
                  rows={5}
                  className="font-mono text-xs"
                  value={draft.advanced}
                  onChange={(e) => update("advanced", e.target.value)}
                />
              </Field>
              <details className="text-xs text-muted">
                <summary className="cursor-pointer">
                  查看当前协议的参数规范
                </summary>
                <pre className="mt-2 max-h-60 overflow-auto whitespace-pre-wrap break-all rounded border p-3">
                  {JSON.stringify(generationSchema, null, 2)}
                </pre>
              </details>
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
              description="勾选这个模型实际支持的档位，供智能体和会话选择。档位越高通常思考越充分，也可能更慢。"
            >
              <Field label="可用档位" error={errors.fields.thinking_levels}>
                <div className="model-thinking-levels" id="thinking-levels">
                  {thinkingOptions.map((option) => {
                    const checked = draft.thinking_levels.includes(option.key);
                    return (
                      <label
                        key={option.key}
                        className="model-thinking-level"
                        data-checked={checked}
                      >
                        <input
                          type="checkbox"
                          className="size-4 accent-[var(--accent)]"
                          name="thinking_levels"
                          checked={checked}
                          onChange={(event) => {
                            const value = event.target.checked;
                            setDraft((current) => ({
                              ...current,
                              thinking_levels: value
                                ? [...current.thinking_levels, option.key]
                                : current.thinking_levels.filter(
                                    (key) => key !== option.key,
                                  ),
                              capabilities:
                                value && option.key !== "none"
                                  ? {
                                      ...current.capabilities,
                                      thinking: "supported",
                                    }
                                  : current.capabilities,
                            }));
                          }}
                        />
                        <span>
                          <span className="font-medium">{option.label}</span>
                          <span className="mt-1 block text-xs text-muted">
                            {option.key === "none"
                              ? "明确关闭思考"
                              : "允许选择此思考强度"}
                          </span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              </Field>
              <p className="text-sm text-muted">
                {draft.thinking_levels.length
                  ? `已选 ${draft.thinking_levels.length} 个档位。${type.provider_type === "custom" ? "请在下方配置对应参数。" : "系统自动适配请求参数，无需填写 JSON。"}`
                  : "未选择档位时，不发送思考参数，使用模型的默认行为；这不等于关闭思考。"}
              </p>
              <p className="text-xs text-muted">
                可选档位表示协议能够传递的参数，不代表每个模型都支持。无法关闭思考的模型请勿勾选“关闭”。
              </p>
              {type.provider_type === "custom" && (
                <details
                  className="model-thinking-mapping"
                  open={errors.fields.thinking_mapping ? true : undefined}
                >
                  <summary>高级设置 · 自定义参数映射</summary>
                  <div className="space-y-3 p-4">
                    <p className="text-sm text-muted">
                      按档位键填写请求参数。“关闭”必须显式禁用思考，不能使用空对象。参数会经过当前协议校验。
                    </p>
                    <Field
                      label="档位映射（JSON）"
                      error={errors.fields.thinking_mapping}
                    >
                      <Textarea
                        name="thinking_mapping"
                        rows={10}
                        className="font-mono text-xs"
                        value={draft.thinking_mapping}
                        onChange={(e) =>
                          update("thinking_mapping", e.target.value)
                        }
                        placeholder={
                          '{\n  "none": { "reasoning_effort": "none" },\n  "high": { "reasoning_effort": "high" }\n}'
                        }
                      />
                    </Field>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        let existing: JsonObject;
                        try {
                          existing = parseParameterObject(
                            draft.thinking_mapping,
                          );
                        } catch {
                          return;
                        }
                        const entries = draft.thinking_levels.map((key) => [
                          key,
                          existing[key] ??
                            (draft.protocol === "chat_completions"
                              ? { reasoning_effort: key }
                              : key === "none"
                                ? { thinking: { type: "disabled" } }
                                : key === "minimal"
                                  ? {
                                      thinking: {
                                        type: "enabled",
                                        budget_tokens: 1024,
                                      },
                                    }
                                  : {
                                      thinking: { type: "adaptive" },
                                      output_config: { effort: key },
                                    }),
                        ]);
                        update(
                          "thinking_mapping",
                          JSON.stringify(Object.fromEntries(entries), null, 2),
                        );
                      }}
                    >
                      填入所选档位的协议示例
                    </Button>
                    <p className="text-xs text-muted">
                      示例仅供起步，请按服务商和模型实际支持的参数调整。
                    </p>
                  </div>
                </details>
              )}
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
