import { useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Plus, Trash2, Send, FlaskConical } from "lucide-react";
import { isUncertain, isVersionConflict, request } from "@/api/client";
import { Button } from "@/components/button";
import { AsyncBoundary, ErrorNotice, Notice } from "@/components/feedback";
import {
  Field,
  Input,
  Select,
  Textarea,
  StandaloneInput,
} from "@/components/fields";
import { PageHeader, Panel } from "@/components/layout";
import { ConfirmDialog, Drawer, Modal } from "@/components/overlays";
import { useApiQuery } from "@/hooks/use-api";
import { useFormErrors, useSubmission } from "@/hooks/use-form";
import { useUnsaved } from "@/hooks/use-unsaved";
import {
  messageStatusLabels,
  messageReasons,
  type SmsProfile,
  type SmsTemplate,
  type MessageLog,
  type TemplateParameter,
} from "@/types/messages";
const base = "/admin/sms";
export function useSmsOptions<T extends { id: string }>(
  section: "profiles" | "templates",
) {
  return useQuery({
    queryKey: ["sms-options", section],
    queryFn: async ({ signal }) => {
      const items = new Map<string, T>();
      for (let page = 1; ; page++) {
        const response = await request<{ items: T[]; total: number }>(
          `${base}/${section}?page=${page}&page_size=100`,
          { signal },
        );
        response.data.items.forEach((item) => items.set(item.id, item));
        if (page * 100 >= response.data.total || !response.data.items.length)
          break;
      }
      return [...items.values()];
    },
  });
}
function object(value: string): Record<string, unknown> {
  const result: unknown = JSON.parse(value);
  if (!result || typeof result !== "object" || Array.isArray(result))
    throw new Error("请输入 JSON 对象");
  return result as Record<string, unknown>;
}
function strings(value: string) {
  const result = object(value);
  if (Object.values(result).some((value) => typeof value !== "string"))
    throw new Error("参数值必须为字符串，数字也请放在引号内以保留前导零。");
  return result as Record<string, string>;
}
type Row = {
  name: string;
  value: string;
  required: boolean;
  description: string;
  hasDefault: boolean;
  defaultValue: string;
};
function decode(value: string, schema: boolean): Row[] {
  return Object.entries(object(value)).map(([name, item]) => {
    if (schema) {
      if (!item || typeof item !== "object" || Array.isArray(item))
        throw new Error("参数定义必须为对象");
      const p = item as TemplateParameter;
      if (
        p.type !== "string" ||
        typeof p.required !== "boolean" ||
        (p.default !== undefined && typeof p.default !== "string") ||
        (p.description !== undefined && typeof p.description !== "string")
      )
        throw new Error("短信参数只支持字符串类型；required 必须为布尔值。");
      if (
        Object.keys(p).some(
          (key) =>
            !["type", "required", "description", "default"].includes(key),
        )
      )
        throw new Error("参数定义包含不支持的属性，请在高级 JSON 中检查。");
      return {
        name,
        value: "",
        required: p.required,
        description: p.description ?? "",
        hasDefault: p.default !== undefined,
        defaultValue: String(p.default ?? ""),
      };
    }
    if (typeof item !== "string")
      throw new Error("映射来源必须是参数名称字符串");
    return {
      name,
      value: item,
      required: false,
      description: "",
      hasDefault: false,
      defaultValue: "",
    };
  });
}
export function ObjectEditor({
  label,
  value,
  onChange,
  schema = false,
  sources = [],
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  schema?: boolean;
  sources?: string[];
}) {
  const [advanced, setAdvanced] = useState(false);
  const [rows, setRows] = useState(() => decode(value, schema));
  const [error, setError] = useState("");
  function change(next: Row[]) {
    setRows(next);
    const names = next.map((row) => row.name);
    const invalid =
      names.some((name) => !/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(name)) ||
      new Set(names).size !== names.length;
    setError(invalid ? "名称须以字母或下划线开头，且不能重复。" : "");
    // Preserve unfinished rows without allowing them to pass object validation.
    onChange(
      JSON.stringify(
        invalid
          ? next
          : Object.fromEntries(
              next.map((row) => [
                row.name,
                schema
                  ? {
                      type: "string",
                      required: row.required,
                      ...(row.description
                        ? { description: row.description }
                        : {}),
                      ...(row.hasDefault ? { default: row.defaultValue } : {}),
                    }
                  : row.value,
              ]),
            ),
        null,
        2,
      ),
    );
  }
  function update(index: number, patch: Partial<Row>) {
    change(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }
  return (
    <section className="grid min-w-0 gap-3 rounded-lg border p-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-medium">{label}</h3>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            if (advanced) {
              try {
                setRows(decode(value, schema));
                setError("");
                setAdvanced(false);
              } catch (e) {
                setError((e as Error).message);
              }
            } else if (!error) setAdvanced(true);
          }}
        >
          {advanced ? "表单编辑" : "高级 JSON"}
        </Button>
      </div>
      {advanced ? (
        <Field label={`${label} JSON`}>
          <Textarea
            className="min-h-40 font-mono"
            value={value}
            onChange={(e) => onChange(e.target.value)}
          />
        </Field>
      ) : (
        <>
          {!rows.length && (
            <p className="text-xs text-muted">
              暂无{schema ? "参数，无参模板可保持为空" : "映射"}。
            </p>
          )}
          {rows.map((row, index) => (
            <div
              key={index}
              className="grid gap-3 rounded-lg bg-surface-subtle p-3"
            >
              <div className="flex items-start gap-2">
                <div className="grid min-w-0 flex-1 grid-cols-2 gap-3">
                  <Field label={schema ? "参数名称" : "供应商参数名"}>
                    <Input
                      value={row.name}
                      onChange={(e) => update(index, { name: e.target.value })}
                    />
                  </Field>
                  {schema ? (
                    <Field label="说明">
                      <Input
                        value={row.description}
                        onChange={(e) =>
                          update(index, { description: e.target.value })
                        }
                      />
                    </Field>
                  ) : (
                    <Field label="来自抽象参数">
                      <Select
                        value={row.value}
                        onValueChange={(value) => update(index, { value })}
                      >
                        <option value="">选择参数</option>
                        {row.value && !sources.includes(row.value) && (
                          <option value={row.value}>
                            {row.value}（已失效）
                          </option>
                        )}
                        {sources.map((name) => (
                          <option key={name} value={name}>
                            {name}
                          </option>
                        ))}
                      </Select>
                    </Field>
                  )}
                </div>
                <Button
                  className="mt-6"
                  variant="ghost"
                  size="icon"
                  aria-label={`删除${row.name || "参数"}`}
                  onClick={() => change(rows.filter((_, i) => i !== index))}
                >
                  <Trash2 />
                </Button>
              </div>
              {schema && (
                <div className="flex flex-wrap items-center gap-4 text-xs">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={row.required}
                      onChange={(e) =>
                        update(index, { required: e.target.checked })
                      }
                    />
                    必填
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={row.hasDefault}
                      onChange={(e) =>
                        update(index, { hasDefault: e.target.checked })
                      }
                    />
                    设置默认值
                  </label>
                  {row.hasDefault && (
                    <StandaloneInput
                      aria-label={`${row.name || "参数"}默认值`}
                      className="max-w-64"
                      value={row.defaultValue}
                      onChange={(e) =>
                        update(index, { defaultValue: e.target.value })
                      }
                    />
                  )}
                </div>
              )}
            </div>
          ))}
          <Button
            variant="outline"
            size="sm"
            className="justify-self-start"
            onClick={() =>
              change([
                ...rows,
                {
                  name: "",
                  value: "",
                  required: true,
                  description: "",
                  hasDefault: false,
                  defaultValue: "",
                },
              ])
            }
          >
            <Plus />
            添加{schema ? "参数" : "映射"}
          </Button>
        </>
      )}
      {error && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
    </section>
  );
}
export function ParameterInputs({
  schema,
  value,
  onChange,
  label = "当次参数",
}: {
  schema: Record<string, TemplateParameter>;
  value: string;
  onChange: (value: string) => void;
  label?: string;
}) {
  const [advanced, setAdvanced] = useState(false);
  let values: Record<string, string> = {};
  let invalid = "";
  try {
    values = strings(value);
  } catch (e) {
    invalid = (e as Error).message;
  }
  const unknown = Object.keys(values).filter((name) => !schema[name]);
  return (
    <section className="grid gap-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">{label}</h3>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setAdvanced(!advanced)}
        >
          {advanced ? "表单输入" : "高级 JSON"}
        </Button>
      </div>
      {advanced || invalid ? (
        <Field label={`${label} JSON`} error={invalid}>
          <Textarea
            className="min-h-32 font-mono"
            value={value}
            onChange={(e) => onChange(e.target.value)}
          />
        </Field>
      ) : (
        <>
          {!Object.keys(schema).length && (
            <p className="text-xs text-muted">此模板无需参数。</p>
          )}
          {Object.entries(schema).map(([name, p]) => (
            <Field
              key={name}
              label={name}
              required={p.required}
              hint={
                p.description ||
                (p.default !== undefined
                  ? `未提供时使用默认值：${String(p.default)}`
                  : undefined)
              }
            >
              <div className="flex items-center gap-2">
                <Input
                  value={values[name] ?? ""}
                  placeholder={p.required ? "请输入字符串" : "未提供"}
                  onChange={(e) =>
                    onChange(
                      JSON.stringify(
                        { ...values, [name]: e.target.value },
                        null,
                        2,
                      ),
                    )
                  }
                />
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={!Object.hasOwn(values, name)}
                  onClick={() => {
                    const next = { ...values };
                    delete next[name];
                    onChange(JSON.stringify(next, null, 2));
                  }}
                >
                  不提供
                </Button>
              </div>
            </Field>
          ))}
          {!!unknown.length && (
            <Notice tone="warning">
              存在未定义参数：{unknown.join("、")}。
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  onChange(
                    JSON.stringify(
                      Object.fromEntries(
                        Object.entries(values).filter(([name]) => schema[name]),
                      ),
                      null,
                      2,
                    ),
                  )
                }
              >
                移除未定义参数
              </Button>
            </Notice>
          )}
        </>
      )}
    </section>
  );
}
function validateParameters(
  schema: Record<string, TemplateParameter>,
  raw: string,
) {
  const values = strings(raw);
  for (const name of Object.keys(values))
    if (!schema[name]) throw new Error(`未定义参数：${name}`);
  for (const [name, p] of Object.entries(schema))
    if (p.required && !Object.hasOwn(values, name))
      throw new Error(`请填写参数：${name}`);
  return values;
}
const emptyTemplate: SmsTemplate = {
  id: "0",
  code: "",
  name: "",
  description: "",
  enabled: true,
  version: "",
  mode: "remote",
  profile_id: "",
  sign_name: "",
  remote_template_id: "",
  provider_parameters: {},
  engine_id: "",
  engine_version: 0,
  body_template: "",
  parameter_schema: {},
  sample_data: {},
  created_at: "",
  updated_at: "",
};
function normalizeTemplate(value: SmsTemplate): SmsTemplate {
  return {
    ...value,
    parameter_schema: value.parameter_schema ?? {},
    sample_data: value.sample_data ?? {},
    provider_parameters: value.provider_parameters ?? {},
  };
}
export function SmsTemplateEditor({ id }: { id: string }) {
  const query = useApiQuery<SmsTemplate>(
    ["sms-template", id],
    `${base}/templates/${id}`,
    { enabled: id !== "new" },
  );
  const profiles = useSmsOptions<SmsProfile>("profiles");
  if (id !== "new" && (query.isPending || query.error))
    return (
      <AsyncBoundary
        loading={query.isPending}
        error={query.error}
        onRetry={() => void query.refetch()}
      />
    );
  return (
    <TemplateForm
      initial={normalizeTemplate(query.data?.data ?? emptyTemplate)}
      initialEtag={query.data?.etag ?? ""}
      profiles={profiles.data ?? []}
      optionsLoading={profiles.isPending}
      optionsError={profiles.error}
      retryOptions={() => void profiles.refetch()}
    />
  );
}
function TemplateForm({
  initial,
  initialEtag,
  profiles,
  optionsLoading,
  optionsError,
  retryOptions,
}: {
  initial: SmsTemplate;
  initialEtag: string;
  profiles: SmsProfile[];
  optionsLoading: boolean;
  optionsError: unknown;
  retryOptions: () => void;
}) {
  const create = initial.id === "0";
  const errors = useFormErrors();
  const navigate = useNavigate();
  const client = useQueryClient();
  const [form, setForm] = useState(initial);
  const [baseline, setBaseline] = useState(initial);
  const [etag, setEtag] = useState(initialEtag);
  const [schema, setSchema] = useState(
    JSON.stringify(initial.parameter_schema, null, 2),
  );
  const [sample, setSample] = useState(
    JSON.stringify(initial.sample_data, null, 2),
  );
  const [mapping, setMapping] = useState(
    JSON.stringify(initial.provider_parameters, null, 2),
  );
  const [preview, setPreview] = useState<{
    body?: string;
    sign_name?: string;
    remote_template_id?: string;
    provider_parameters?: Record<string, string>;
  } | null>(null);
  const [editorRevision, setEditorRevision] = useState(0);
  const [previewStamp, setPreviewStamp] = useState("");
  const [remove, setRemove] = useState(false);
  const [simulate, setSimulate] = useState(false);
  const [latest, setLatest] = useState<SmsTemplate | null>(null);
  const [notice, setNotice] = useState("");
  const [writeUnknown, setWriteUnknown] = useState(false);
  const submission = useSubmission();
  const recovery = useSubmission();
  const busy = useRef(false);
  const raw = JSON.stringify([form, schema, sample, mapping]);
  const dirty =
    JSON.stringify(form) !== JSON.stringify(baseline) ||
    schema !== JSON.stringify(baseline.parameter_schema, null, 2) ||
    sample !== JSON.stringify(baseline.sample_data, null, 2) ||
    mapping !== JSON.stringify(baseline.provider_parameters, null, 2);
  const markSaved = useUnsaved(dirty, submission.pending);
  let definitions: Record<string, TemplateParameter> = {};
  try {
    definitions = Object.fromEntries(
      decode(schema, true).map((row) => [
        row.name,
        {
          type: "string",
          required: row.required,
          description: row.description,
          ...(row.hasDefault ? { default: row.defaultValue } : {}),
        },
      ]),
    );
  } catch {
    /* raw draft remains editable */
  }
  function update<K extends keyof SmsTemplate>(key: K, value: SmsTemplate[K]) {
    setForm({ ...form, [key]: value });
    setNotice("");
  }
  function draft(): SmsTemplate {
    errors.clear();
    const required = {
      name: !form.name.trim() ? "请输入模板名称" : "",
      code: !form.code.trim() ? "请输入模板编码" : "",
      profile_id:
        form.mode === "remote" && !form.profile_id ? "请选择短信配置" : "",
      sign_name:
        form.mode === "remote" && !form.sign_name.trim() ? "请输入签名" : "",
      remote_template_id:
        form.mode === "remote" && !form.remote_template_id.trim()
          ? "请输入远端模板 ID"
          : "",
      body_template:
        form.mode === "local" && !form.body_template.trim()
          ? "请输入本地正文"
          : "",
    };
    if (!errors.validate(required)) throw new Error("请检查标出的必填字段。");
    const rows = decode(schema, true);
    if (rows.some((row) => !/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(row.name)))
      throw new Error("参数名称格式不正确");
    const parameter_schema = object(schema) as Record<
      string,
      TemplateParameter
    >;
    const provider_parameters = form.mode === "remote" ? strings(mapping) : {};
    if (
      form.mode === "remote" &&
      (!form.profile_id ||
        !form.sign_name.trim() ||
        !form.remote_template_id.trim())
    )
      throw new Error("请选择短信配置并填写签名、远端模板 ID");
    for (const [name, source] of Object.entries(provider_parameters))
      if (
        !parameter_schema[source] ||
        !/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(name)
      )
        throw new Error(`请检查映射：${name}`);
    return {
      ...form,
      parameter_schema,
      sample_data: validateParameters(parameter_schema, sample),
      provider_parameters,
      profile_id: form.mode === "local" ? "0" : form.profile_id,
      engine_id: form.mode === "local" ? "go_template" : "",
      engine_version: form.mode === "local" ? 1 : 0,
      body_template: form.mode === "local" ? form.body_template : "",
      sign_name: form.mode === "remote" ? form.sign_name : "",
      remote_template_id: form.mode === "remote" ? form.remote_template_id : "",
    };
  }
  async function save() {
    if (busy.current || writeUnknown || latest) return;
    busy.current = true;
    try {
      await submission.run(async () => {
        const response = await request<SmsTemplate>(
          create ? `${base}/templates` : `${base}/templates/${form.id}`,
          {
            method: create ? "POST" : "PATCH",
            etag: create ? undefined : etag,
            body: draft(),
          },
        ).catch((error) => {
          if (isUncertain(error)) setWriteUnknown(true);
          throw error;
        });
        response.data = normalizeTemplate(response.data);
        setForm(response.data);
        setBaseline(response.data);
        setEditorRevision((value) => value + 1);
        setEtag(response.etag ?? "");
        setSchema(JSON.stringify(response.data.parameter_schema, null, 2));
        setSample(JSON.stringify(response.data.sample_data, null, 2));
        setMapping(JSON.stringify(response.data.provider_parameters, null, 2));
        setLatest(null);
        setNotice("模板已保存。");
        await client.invalidateQueries({ queryKey: ["sms-templates"] });
        await client.invalidateQueries({ queryKey: ["sms-options"] });
        if (create) {
          markSaved();
          navigate(`${base}/templates/${response.data.id}`);
        }
      });
    } finally {
      busy.current = false;
    }
  }
  const previewExpired = preview && previewStamp !== raw;
  return (
    <form
      ref={errors.formRef}
      className="sms-template-editor grid gap-5"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <PageHeader
        title={create ? "创建短信模板" : form.name}
        description={
          form.mode === "remote"
            ? "远端模板 · 真实正文由阿里云审核模板决定"
            : "本地正文 · 仅模拟，不会发送短信"
        }
        actions={
          <>
            <Button
              variant="outline"
              onClick={() => navigate(`${base}/templates`)}
            >
              <ArrowLeft />
              返回
            </Button>
            {!create &&
              form.enabled &&
              (form.mode === "local" ? (
                <Button
                  variant="outline"
                  disabled={dirty || submission.pending}
                  onClick={() => setSimulate(true)}
                >
                  <FlaskConical />
                  模拟渲染
                </Button>
              ) : (
                <Button
                  variant="outline"
                  disabled={dirty || submission.pending}
                  onClick={() =>
                    navigate(`${base}/templates/${form.id}?test=1`)
                  }
                >
                  <Send />
                  发送测试
                </Button>
              ))}
            <Button
              variant="outline"
              pending={submission.pending}
              onClick={() =>
                void submission.run(async () => {
                  const response = await request<NonNullable<typeof preview>>(
                    `${base}/templates/preview`,
                    { method: "POST", body: { draft: draft() } },
                  );
                  setPreview(response.data);
                  setPreviewStamp(raw);
                })
              }
            >
              {form.mode === "remote" ? "预览映射" : "预览正文"}
            </Button>
            <Button
              pending={submission.pending}
              disabled={
                (!create && !dirty) ||
                !!latest ||
                submission.uncertain ||
                writeUnknown
              }
              onClick={() => void save()}
            >
              {create ? "创建模板" : "保存模板"}
            </Button>
            {!create && (
              <Button
                variant="ghost"
                aria-label="删除模板"
                disabled={submission.pending}
                onClick={() => setRemove(true)}
              >
                <Trash2 />
              </Button>
            )}
          </>
        }
      />
      <ErrorNotice error={submission.error} />
      {notice && <Notice tone="success">{notice}</Notice>}
      {dirty && !create && (
        <p className="text-xs text-muted">
          有未保存修改；真实发送和模拟渲染使用已保存版本，请先保存。
        </p>
      )}
      {(isVersionConflict(submission.error) ||
        submission.uncertain ||
        writeUnknown) && (
        <Notice tone="warning">
          {submission.uncertain || writeUnknown
            ? "保存结果尚未确认。请读取最新资料并核对，不要直接重复提交。"
            : "资料已被修改，请读取最新版本后核对草稿。"}
          {create ? (
            <Button
              render={<Link to={`${base}/templates`}>核对模板列表</Link>}
              nativeButton={false}
              role="link"
              variant="outline"
              size="sm"
            />
          ) : (
            <Button
              variant="outline"
              size="sm"
              pending={recovery.pending}
              onClick={() =>
                void recovery.run(async () => {
                  const response = await request<SmsTemplate>(
                    `${base}/templates/${form.id}`,
                  );
                  setLatest(response.data);
                  setEtag(response.etag ?? "");
                })
              }
            >
              读取最新版本
            </Button>
          )}
        </Notice>
      )}
      <ErrorNotice error={recovery.error} />
      {latest && (
        <Panel title="最新资料（当前草稿保留）">
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all text-xs">
            {JSON.stringify(latest, null, 2)}
          </pre>
          <Button
            variant="outline"
            onClick={() => {
              setLatest(null);
              setWriteUnknown(false);
              submission.setError(null);
              setNotice("已采用最新编辑版本；请核对草稿后再次保存。");
            }}
          >
            已核对，保留草稿继续编辑
          </Button>
        </Panel>
      )}
      <div className="grid min-w-0 items-start gap-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
        <fieldset disabled={submission.pending} className="grid min-w-0 gap-5">
          <Panel title="基本资料">
            <div className="form-grid">
              <Field label="模板名称" required error={errors.fields.name}>
                <Input
                  maxLength={100}
                  name="name"
                  value={form.name}
                  onChange={(e) => update("name", e.target.value)}
                />
              </Field>
              <Field label="编码" required error={errors.fields.code}>
                <Input
                  readOnly={!create}
                  name="code"
                  value={form.code}
                  onChange={(e) => update("code", e.target.value)}
                />
              </Field>
              <Field label="模板模式">
                <Select
                  disabled={!create}
                  value={form.mode}
                  onValueChange={(v) =>
                    update("mode", v as SmsTemplate["mode"])
                  }
                >
                  <option value="remote">远端模板</option>
                  <option value="local">本地正文模拟</option>
                </Select>
              </Field>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.enabled}
                  onChange={(e) => update("enabled", e.target.checked)}
                />
                启用模板
              </label>
              <Field label="说明" className="form-full">
                <Textarea
                  maxLength={1000}
                  value={form.description}
                  onChange={(e) => update("description", e.target.value)}
                />
              </Field>
            </div>
          </Panel>
          <Panel title={form.mode === "remote" ? "远端配置" : "本地正文"}>
            {form.mode === "remote" ? (
              <div className="form-grid">
                {optionsError ? (
                  <div className="form-full">
                    <ErrorNotice error={optionsError} />
                    <Button variant="outline" onClick={retryOptions}>
                      重新加载配置
                    </Button>
                  </div>
                ) : null}
                <Field
                  label="短信配置"
                  error={errors.fields.profile_id}
                  required
                  className="form-full"
                  hint="创建后不能更换所属配置。"
                >
                  <Select
                    disabled={!create || optionsLoading}
                    name="profile_id"
                    value={form.profile_id}
                    onValueChange={(v) => update("profile_id", v)}
                  >
                    <option value="">
                      {optionsLoading ? "正在加载配置…" : "请选择短信配置"}
                    </option>
                    {form.profile_id &&
                      !profiles.some((p) => p.id === form.profile_id) && (
                        <option value={form.profile_id}>
                          当前配置 · {form.profile_id}
                        </option>
                      )}
                    {profiles.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                        {p.enabled ? "" : "（已停用）"}
                      </option>
                    ))}
                  </Select>
                </Field>
                {!optionsLoading && !optionsError && !profiles.length && (
                  <p className="form-full text-xs text-muted">
                    暂无配置，请先在短信配置页创建。
                  </p>
                )}
                <Field label="签名" required error={errors.fields.sign_name}>
                  <Input
                    name="sign_name"
                    value={form.sign_name}
                    onChange={(e) => update("sign_name", e.target.value)}
                  />
                </Field>
                <Field
                  label="远端模板 ID"
                  required
                  error={errors.fields.remote_template_id}
                >
                  <Input
                    name="remote_template_id"
                    value={form.remote_template_id}
                    onChange={(e) =>
                      update("remote_template_id", e.target.value)
                    }
                  />
                </Field>
              </div>
            ) : (
              <Field
                label="正文（Go 模板）"
                error={errors.fields.body_template}
                required
                hint="使用 {{.参数名}} 插入字符串参数。"
              >
                <Textarea
                  className="min-h-48 font-mono"
                  name="body_template"
                  value={form.body_template}
                  onChange={(e) => update("body_template", e.target.value)}
                />
              </Field>
            )}
          </Panel>
          <Panel title="参数与样例">
            <div className="grid gap-5">
              <ObjectEditor
                key={`schema-${editorRevision}`}
                label="参数定义"
                schema
                value={schema}
                onChange={setSchema}
              />
              {form.mode === "remote" && (
                <ObjectEditor
                  key={`mapping-${editorRevision}`}
                  label="供应商参数映射"
                  value={mapping}
                  onChange={setMapping}
                  sources={Object.keys(definitions)}
                />
              )}
              <ParameterInputs
                label="预览样例"
                schema={definitions}
                value={sample}
                onChange={setSample}
              />
              <p className="text-xs text-muted">
                样例仅用于预览，不是发送默认值。请使用虚构内容。
              </p>
            </div>
          </Panel>
        </fieldset>
        <div className="grid min-w-0 gap-4 xl:sticky xl:top-40">
          <Panel title="预览结果">
            {previewExpired && (
              <Notice tone="warning">内容已修改，请重新预览。</Notice>
            )}
            {!preview ? (
              <div className="grid min-h-48 content-center gap-3 text-sm text-muted">
                <p>填写模板和样例后，点击顶部预览。</p>
                <p>预览不会发送短信，也不产生发送日志。</p>
              </div>
            ) : form.mode === "local" ? (
              <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap break-words font-sans text-sm leading-7">
                {preview.body ?? ""}
              </pre>
            ) : (
              <div className="grid gap-4 text-sm">
                <p>签名：{preview.sign_name}</p>
                <p className="break-all">
                  模板 ID：{preview.remote_template_id}
                </p>
                <div className="grid gap-2">
                  {Object.entries(preview.provider_parameters ?? {}).map(
                    ([name, value]) => (
                      <div
                        key={name}
                        className="grid grid-cols-2 gap-3 border-b border-b-border-subtle py-2"
                      >
                        <code className="break-all">{name}</code>
                        <span className="whitespace-pre-wrap break-all">
                          {value}
                        </span>
                      </div>
                    ),
                  )}
                </div>
                <p className="text-xs text-muted">
                  这里只展示提交参数，最终正文以供应商审核模板为准。
                </p>
              </div>
            )}
          </Panel>
        </div>
      </div>
      <ConfirmDialog
        open={remove}
        title="删除短信模板"
        description={form.name}
        danger
        confirmLabel="删除模板"
        pending={submission.pending}
        onClose={() => setRemove(false)}
        onConfirm={() =>
          void submission.run(async () => {
            await request(`${base}/templates/${form.id}`, {
              method: "DELETE",
              etag,
            });
            markSaved();
            await client.invalidateQueries({ queryKey: ["sms-templates"] });
            await client.invalidateQueries({ queryKey: ["sms-options"] });
            navigate(`${base}/templates`);
          })
        }
      >
        <p className="text-sm text-muted">
          删除后无法恢复，既有发送日志仍保留至到期。
        </p>
        <ErrorNotice error={submission.error} />
      </ConfirmDialog>
      {simulate && (
        <Simulation
          template={baseline}
          etag={etag}
          onClose={() => setSimulate(false)}
        />
      )}
    </form>
  );
}
function Simulation({
  template,
  etag,
  onClose,
}: {
  template: SmsTemplate;
  etag: string;
  onClose: () => void;
}) {
  const [parameters, setParameters] = useState(
    JSON.stringify(template.sample_data, null, 2),
  );
  const [body, setBody] = useState<string | null>(null);
  const submission = useSubmission();
  return (
    <Modal
      open
      title="本地模板模拟"
      description="仅模拟、未发送，不会访问供应商或产生费用。"
      pending={submission.pending}
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            关闭
          </Button>
          <Button
            pending={submission.pending}
            onClick={() =>
              void submission.run(async () => {
                const result = await request<{ body: string }>(
                  `${base}/templates/${template.id}/simulate`,
                  {
                    method: "POST",
                    etag,
                    body: {
                      parameters: validateParameters(
                        template.parameter_schema,
                        parameters,
                      ),
                    },
                  },
                );
                setBody(result.data.body);
              })
            }
          >
            执行模拟
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <ErrorNotice error={submission.error} />
        <ParameterInputs
          schema={template.parameter_schema ?? {}}
          value={parameters}
          onChange={(value) => {
            setParameters(value);
            setBody(null);
          }}
        />
        {body !== null && (
          <Notice tone="success" title="仅模拟、未发送">
            <pre className="whitespace-pre-wrap break-all font-sans">
              {body}
            </pre>
          </Notice>
        )}
      </div>
    </Modal>
  );
}
export function SmsTest({
  onClose,
  initialProfileId,
  initialTemplateId,
}: {
  onClose: () => void;
  initialProfileId?: string;
  initialTemplateId?: string;
}) {
  const profiles = useSmsOptions<SmsProfile>("profiles");
  const templates = useSmsOptions<SmsTemplate>("templates");
  const client = useQueryClient();
  const [profileChoice, setProfileChoice] = useState<string | null>(null);
  const [templateChoice, setTemplateChoice] = useState<string | null>(null);
  const templateId = templateChoice ?? initialTemplateId ?? "";
  const template = templates.data?.find(
    (t) => t.id === templateId && t.mode === "remote",
  );
  const profileId =
    profileChoice ?? initialProfileId ?? template?.profile_id ?? "";
  const profile = profiles.data?.find((p) => p.id === profileId);
  const [recipient, setRecipient] = useState("");
  const [parameters, setParameters] = useState<string | null>(null);
  const [result, setResult] = useState<MessageLog | null>(null);
  const [attempted, setAttempted] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const submission = useSubmission();
  const recovery = useSubmission();
  const busy = useRef(false);
  const raw =
    parameters ?? JSON.stringify(template?.sample_data ?? {}, null, 2);
  const uncertain =
    submission.uncertain ||
    result?.status === "unknown" ||
    result?.status === "in_progress";
  const locked = attempted || uncertain;
  const availableProfiles =
    profiles.data?.filter((p) => p.enabled && p.has_secret) ?? [];
  const availableTemplates =
    templates.data?.filter(
      (t) => t.mode === "remote" && t.enabled && t.profile_id === profileId,
    ) ?? [];
  async function send() {
    if (busy.current || locked) return;
    busy.current = true;
    try {
      await submission.run(async () => {
        if (
          !profile?.enabled ||
          !profile.has_secret ||
          !template?.enabled ||
          template.profile_id !== profile.id
        )
          throw new Error("请选择启用的短信配置及其远端模板");
        if (!/^1\d{10}$/.test(recipient))
          throw new Error("请输入中国大陆 11 位手机号");
        const values = validateParameters(template.parameter_schema ?? {}, raw);
        setAttempted(true);
        const response = await request<MessageLog>(
          `${base}/profiles/${profile.id}/test`,
          {
            method: "POST",
            etag: `"${profile.version}"`,
            body: {
              recipient,
              template: {
                id: template.id,
                version: template.version,
                parameters: values,
              },
            },
          },
        );
        setResult(response.data);
        await client.invalidateQueries({ queryKey: ["sms-profiles"] });
        await client.invalidateQueries({ queryKey: ["message-logs", "sms"] });
      });
    } finally {
      busy.current = false;
    }
  }
  return (
    <>
      <Drawer
        open
        title="发送真实短信测试"
        description="将请求阿里云并可能计费；受理不代表送达。"
        onClose={onClose}
        pending={submission.pending}
        footer={
          <>
            <Button variant="outline" onClick={onClose}>
              关闭
            </Button>
            <Button
              disabled={
                locked ||
                profiles.isPending ||
                templates.isPending ||
                !!profiles.error ||
                !!templates.error ||
                !profile?.enabled ||
                !template?.enabled
              }
              pending={submission.pending}
              onClick={() => void send()}
            >
              <Send />
              确认真实发送
            </Button>
          </>
        }
      >
        <div className="grid gap-5">
          <ErrorNotice error={submission.error} />
          <ErrorNotice error={recovery.error} />
          {(profiles.isPending || templates.isPending) && (
            <p className="text-sm text-muted">正在加载配置和模板…</p>
          )}
          {(profiles.error || templates.error) && (
            <>
              <ErrorNotice error={profiles.error ?? templates.error} />
              <Button
                variant="outline"
                onClick={() => {
                  void profiles.refetch();
                  void templates.refetch();
                }}
              >
                重新加载选项
              </Button>
            </>
          )}
          {!profiles.isPending &&
            !profiles.error &&
            !availableProfiles.length && (
              <Notice tone="warning">
                没有可用配置。请先启用短信配置并设置认证。
              </Notice>
            )}
          {result && (
            <Notice tone={result.status === "accepted" ? "success" : "warning"}>
              {messageStatusLabels[result.status]} ·{" "}
              {messageReasons[result.reason_code] ?? result.reason_code}
              <Link className="link ml-2" to={`${base}/send-logs/${result.id}`}>
                查看本次记录
              </Link>
            </Notice>
          )}
          {locked && (
            <Notice
              tone="warning"
              title={uncertain ? "请先核实本次发送" : "本次测试已处理"}
            >
              <p>
                {uncertain
                  ? "可能已经提交给供应商，无法确认时不要再次发送。日志为空或最近一次记录不能证明本次未发送。"
                  : "再次发送将产生新的短信请求，请先核对本次反馈。"}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {result && (
                  <Button
                    variant="outline"
                    size="sm"
                    pending={recovery.pending}
                    onClick={() =>
                      void recovery.run(async () => {
                        const response = await request<MessageLog>(
                          `${base}/send-logs/${result.id}`,
                        );
                        setResult(response.data);
                      })
                    }
                  >
                    读取本次结果
                  </Button>
                )}
                <Button
                  render={
                    <Link to={`${base}/send-logs?profile_id=${profileId}`}>
                      查看发送日志
                    </Link>
                  }
                  nativeButton={false}
                  role="link"
                  variant="outline"
                  size="sm"
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setConfirmReset(true)}
                >
                  准备下一次发送
                </Button>
              </div>
            </Notice>
          )}
          {isVersionConflict(submission.error) && (
            <Button
              variant="outline"
              onClick={() => {
                void profiles.refetch();
                void templates.refetch();
              }}
            >
              重新加载配置与模板版本
            </Button>
          )}
          <fieldset
            disabled={locked || submission.pending}
            className="grid gap-4"
          >
            <Field label="短信配置" required>
              <Select
                value={profileId}
                onValueChange={(value) => {
                  setProfileChoice(value);
                  setTemplateChoice("");
                  setParameters(null);
                }}
              >
                <option value="">请选择</option>
                {availableProfiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="远端模板" required>
              <Select
                value={templateId}
                onValueChange={(value) => {
                  setTemplateChoice(value);
                  setParameters(null);
                }}
              >
                <option value="">请选择</option>
                {availableTemplates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} · {t.remote_template_id}
                  </option>
                ))}
              </Select>
            </Field>
            {profileId &&
              !templates.isPending &&
              !templates.error &&
              !availableTemplates.length && (
                <p className="text-xs text-muted">此配置没有启用的远端模板。</p>
              )}
            <Field label="接收手机号" required>
              <Input
                inputMode="tel"
                autoComplete="off"
                maxLength={11}
                value={recipient}
                onChange={(e) => setRecipient(e.target.value)}
              />
            </Field>
            {template && (
              <ParameterInputs
                key={template.id}
                schema={template.parameter_schema ?? {}}
                value={raw}
                onChange={setParameters}
              />
            )}
          </fieldset>
        </div>
      </Drawer>
      <ConfirmDialog
        open={confirmReset}
        title={uncertain ? "已核实可能提交的短信？" : "准备新的短信测试"}
        description="再次发送可能计费，并可能让接收人收到重复短信。"
        confirmLabel="已核实，准备下一次"
        onClose={() => setConfirmReset(false)}
        onConfirm={() => {
          setAttempted(false);
          setResult(null);
          submission.setError(null);
          recovery.setError(null);
          setConfirmReset(false);
          void profiles.refetch();
          void templates.refetch();
        }}
      />
    </>
  );
}
