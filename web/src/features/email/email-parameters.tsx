import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/button";
import { Field, Input, Select, Textarea } from "@/components/fields";
import { Notice } from "@/components/feedback";
import type { TemplateParameter } from "@/types/messages";

const types = {
  string: "文本",
  number: "数字",
  boolean: "布尔值",
  object: "对象",
  array: "数组",
};
type Kind = keyof typeof types;
type Definition = {
  id: string;
  name: string;
  type: Kind;
  required: boolean;
  description: string;
  hasDefault: boolean;
  defaultValue: string;
  properties: Definition[];
  items?: Definition;
};
let nextDefinitionId = 0;
function blank(name = ""): Definition {
  return {
    id: String(++nextDefinitionId),
    name,
    type: "string",
    required: false,
    description: "",
    hasDefault: false,
    defaultValue: "",
    properties: [],
  };
}
function object(raw: string): Record<string, unknown> {
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("请输入有效的 JSON 对象");
  return value as Record<string, unknown>;
}
function decode(raw: Record<string, unknown>, depth = 1): Definition[] {
  if (depth > 4) throw new Error("参数最多支持四层嵌套");
  return Object.entries(raw).map(([name, value]) => {
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error("参数定义必须是对象");
    const p = value as TemplateParameter;
    if (
      !Object.hasOwn(types, p.type) ||
      Object.keys(p).some(
        (key) =>
          ![
            "type",
            "required",
            "description",
            "default",
            "properties",
            "items",
          ].includes(key),
      ) ||
      (p.required !== undefined && typeof p.required !== "boolean") ||
      (p.description !== undefined && typeof p.description !== "string")
    )
      throw new Error("包含无法用表单编辑的参数定义，请在高级 JSON 中检查");
    if (
      (p.properties && p.type !== "object") ||
      (p.items && p.type !== "array")
    )
      throw new Error("参数结构与类型不一致，请检查高级 JSON。");
    if (p.default !== undefined)
      typed(
        p.type === "string" && typeof p.default === "string"
          ? p.default
          : JSON.stringify(p.default),
        p.type as Kind,
      );
    if (
      p.type === "string" &&
      p.default !== undefined &&
      typeof p.default !== "string"
    )
      throw new Error("文本默认值必须是字符串");
    return {
      ...blank(name),
      type: p.type as Kind,
      required: p.required ?? false,
      description: p.description ?? "",
      hasDefault: Object.hasOwn(p, "default"),
      defaultValue:
        p.type === "string" && typeof p.default === "string"
          ? p.default
          : p.default === undefined
            ? ""
            : JSON.stringify(p.default),
      properties: p.properties ? decode(p.properties, depth + 1) : [],
      items: p.items ? decode({ item: p.items }, depth + 1)[0] : undefined,
    };
  });
}
function typed(raw: string, type: Kind): unknown {
  if (type === "string") return raw;
  const value: unknown = JSON.parse(raw);
  if (
    type === "array"
      ? !Array.isArray(value)
      : type === "object"
        ? !value || typeof value !== "object" || Array.isArray(value)
        : typeof value !== type
  )
    throw new Error(`请输入${types[type]}类型的值`);
  return value;
}
function encode(
  rows: Definition[],
  depth = 1,
): Record<string, TemplateParameter> {
  if (depth > 4) throw new Error("参数最多支持四层嵌套");
  const names = rows.map((row) => row.name);
  if (
    names.some((name) => !/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(name)) ||
    new Set(names).size !== names.length
  )
    throw new Error(
      "参数名称须以字母或下划线开头，不超过 64 个字符，同级名称不能重复。",
    );
  return Object.fromEntries(
    rows.map((row) => [
      row.name,
      {
        type: row.type,
        required: row.required,
        ...(row.description ? { description: row.description } : {}),
        ...(row.hasDefault
          ? { default: typed(row.defaultValue, row.type) }
          : {}),
        ...(row.type === "object"
          ? { properties: encode(row.properties, depth + 1) }
          : {}),
        ...(row.type === "array"
          ? {
              items: encode(
                [{ ...(row.items ?? blank("item")), name: "item" }],
                depth + 1,
              ).item,
            }
          : {}),
      },
    ]),
  );
}
function ValueInput({
  label,
  type,
  value,
  onChange,
  required = false,
  hint,
}: {
  label: string;
  type: Kind;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  hint?: string;
}) {
  return (
    <Field label={label} required={required} hint={hint}>
      {type === "boolean" ? (
        <Select value={value} onValueChange={onChange}>
          <option value="">未提供</option>
          <option value="true">是（true）</option>
          <option value="false">否（false）</option>
        </Select>
      ) : type === "object" || type === "array" ? (
        <Textarea
          className="min-h-24 font-mono"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={type === "object" ? "{}" : "[]"}
        />
      ) : (
        <Input
          inputMode={type === "number" ? "decimal" : undefined}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </Field>
  );
}
function DefinitionRows({
  rows,
  onChange,
  depth = 1,
  item = false,
}: {
  rows: Definition[];
  onChange: (rows: Definition[]) => void;
  depth?: number;
  item?: boolean;
}) {
  function update(id: string, patch: Partial<Definition>) {
    onChange(rows.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  }
  return (
    <div className="grid min-w-0 gap-3">
      {rows.map((row) => (
        <section
          key={row.id}
          className="grid min-w-0 gap-3 rounded-lg border bg-surface-subtle p-3"
        >
          <div className="flex items-start gap-2">
            <div className="grid min-w-0 flex-1 grid-cols-2 gap-3">
              {!item && (
                <Field label="参数名称">
                  <Input
                    value={row.name}
                    maxLength={64}
                    onChange={(e) => update(row.id, { name: e.target.value })}
                  />
                </Field>
              )}
              <Field label={item ? "数组元素类型" : "参数类型"}>
                <Select
                  value={row.type}
                  onValueChange={(type) =>
                    update(row.id, {
                      type: type as Kind,
                      hasDefault: false,
                      defaultValue: "",
                    })
                  }
                >
                  {Object.entries(types).map(([value, label]) => (
                    <option
                      key={value}
                      value={value}
                      disabled={
                        depth >= 4 && (value === "array" || value === "object")
                      }
                    >
                      {label}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            {!item && (
              <Button
                className="mt-6"
                variant="ghost"
                size="icon"
                aria-label={`删除参数 ${row.name || "未命名"}`}
                onClick={() =>
                  onChange(rows.filter((value) => value.id !== row.id))
                }
              >
                <Trash2 />
              </Button>
            )}
          </div>
          <Field label="参数说明">
            <Input
              value={row.description}
              onChange={(e) => update(row.id, { description: e.target.value })}
            />
          </Field>
          {!item && (
            <div className="flex flex-wrap gap-4 text-xs">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={row.required}
                  onChange={(e) =>
                    update(row.id, { required: e.target.checked })
                  }
                />
                必填
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={row.hasDefault}
                  onChange={(e) =>
                    update(row.id, { hasDefault: e.target.checked })
                  }
                />
                设置默认值
              </label>
            </div>
          )}
          {row.hasDefault && (
            <ValueInput
              label={`${row.name || "参数"}默认值`}
              type={row.type}
              value={row.defaultValue}
              onChange={(value) => update(row.id, { defaultValue: value })}
              hint="默认值用于可选参数未提供时；必填参数仍需填写。对象、数组使用 JSON。"
            />
          )}
          {row.type === "object" && (
            <div className="grid gap-2 border-l-2 pl-3">
              <h4 className="text-xs font-medium">对象字段</h4>
              <DefinitionRows
                rows={row.properties}
                depth={depth + 1}
                onChange={(properties) => update(row.id, { properties })}
              />
            </div>
          )}
          {row.type === "array" && (
            <div className="grid gap-2 border-l-2 pl-3">
              <h4 className="text-xs font-medium">数组元素</h4>
              <DefinitionRows
                item
                rows={[row.items ?? { ...blank("item"), id: row.id + "-item" }]}
                depth={depth + 1}
                onChange={(values) => update(row.id, { items: values[0] })}
              />
            </div>
          )}
        </section>
      ))}
      {!item && (
        <Button
          variant="outline"
          size="sm"
          className="justify-self-start"
          onClick={() => onChange([...rows, blank()])}
        >
          <Plus />
          添加参数
        </Button>
      )}
    </div>
  );
}
export function EmailParameterSchema({
  value,
  onChange,
  error,
}: {
  value: string;
  onChange: (value: string) => void;
  error?: string;
}) {
  const [initial] = useState(() => {
    try {
      return { rows: decode(object(value)), advanced: false };
    } catch {
      return { rows: [], advanced: true };
    }
  });
  const [rows, setRows] = useState(initial.rows);
  const [advanced, setAdvanced] = useState(initial.advanced);
  const [localError, setLocalError] = useState("");
  function change(next: Definition[]) {
    setRows(next);
    try {
      const result = encode(next);
      setLocalError("");
      onChange(JSON.stringify(result, null, 2));
    } catch (e) {
      setLocalError((e as Error).message);
      onChange(JSON.stringify(next));
    }
  }
  return (
    <section
      className="form-full grid min-w-0 gap-3 rounded-lg border p-4"
      tabIndex={-1}
      data-field-name="parameter_schema"
      aria-label="参数定义"
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium">参数定义</h3>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            if (advanced) {
              try {
                const next = decode(object(value));
                encode(next);
                setRows(next);
                setLocalError("");
                setAdvanced(false);
              } catch (e) {
                setLocalError((e as Error).message);
              }
            } else if (!localError) setAdvanced(true);
          }}
        >
          {advanced ? "表单编辑" : "高级 JSON"}
        </Button>
      </div>
      <p className="text-xs text-muted">
        定义模板变量的名称、类型和默认值。支持文本、数字、布尔值、对象与数组。
      </p>
      {advanced ? (
        <Field label="参数 Schema（JSON）">
          <Textarea
            name="parameter_schema"
            className="min-h-40 font-mono"
            value={value}
            onChange={(e) => {
              setLocalError("");
              onChange(e.target.value);
            }}
          />
        </Field>
      ) : (
        <>
          <DefinitionRows rows={rows} onChange={change} />
          {!rows.length && (
            <p className="text-xs text-muted">暂无参数，无参模板可保持为空。</p>
          )}
        </>
      )}
      {(localError || error) && (
        <p role="alert" className="text-xs text-danger">
          {localError || error}
        </p>
      )}
    </section>
  );
}
export function EmailParameterValues({
  schema,
  value,
  onChange,
  error,
  label = "预览样例",
  fieldName = "sample_data",
}: {
  schema: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  label?: string;
  fieldName?: string;
}) {
  const [advanced, setAdvanced] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  let definitions: Record<string, TemplateParameter> = {};
  let values: Record<string, unknown> = {};
  let parseError = "";
  try {
    const parsed = object(schema);
    decode(parsed);
    definitions = parsed as Record<string, TemplateParameter>;
    values = object(value);
  } catch {
    parseError = "请先完成参数定义并检查样例 JSON。";
  }
  function publish(
    base: Record<string, unknown>,
    nextDrafts: Record<string, string>,
  ) {
    setDrafts(nextDrafts);
    try {
      const next = { ...base };
      for (const [key, text] of Object.entries(nextDrafts))
        next[key] = typed(text, (definitions[key]?.type ?? "string") as Kind);
      onChange(JSON.stringify(next, null, 2));
    } catch {
      onChange(JSON.stringify(Object.entries(nextDrafts)));
    }
  }
  function change(name: string, _type: Kind, raw: string) {
    publish(values, { ...drafts, [name]: raw });
  }
  const unknown = Object.keys(values).filter((name) => !definitions[name]);
  // Drafts are only needed while a scalar/JSON value is incomplete. The last valid object is retained below.
  const [lastValid, setLastValid] = useState(values);
  if (!parseError && JSON.stringify(lastValid) !== JSON.stringify(values))
    setLastValid(values);
  if (parseError && Object.keys(drafts).length) values = lastValid;
  return (
    <section
      className="form-full grid min-w-0 gap-3 rounded-lg border p-4"
      tabIndex={-1}
      data-field-name={fieldName}
      aria-label={label}
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium">{label}</h3>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            if (advanced) {
              try {
                object(value);
                setDrafts({});
                setAdvanced(false);
              } catch {
                return;
              }
            } else if (!parseError) setAdvanced(true);
          }}
        >
          {advanced ? "表单输入" : "高级 JSON"}
        </Button>
      </div>
      {advanced || (parseError && !Object.keys(drafts).length) ? (
        <Field
          label={
            fieldName === "sample_data"
              ? "样例数据（JSON）"
              : "模板参数（JSON）"
          }
        >
          <Textarea
            name={fieldName}
            className="min-h-40 font-mono"
            value={value}
            onChange={(e) => onChange(e.target.value)}
          />
        </Field>
      ) : (
        <>
          {!Object.keys(definitions).length && (
            <p className="text-xs text-muted">此模板无需参数。</p>
          )}
          {Object.entries(definitions).map(([name, p]) => (
            <div key={name} className="grid gap-2">
              <ValueInput
                label={name}
                type={p.type as Kind}
                required={p.required}
                hint={
                  p.description ||
                  (p.type === "object" || p.type === "array"
                    ? "按此参数结构填写 JSON。"
                    : "")
                }
                value={
                  drafts[name] ??
                  (typeof values[name] === "string"
                    ? (values[name] as string)
                    : values[name] === undefined
                      ? ""
                      : JSON.stringify(values[name]))
                }
                onChange={(raw) => change(name, p.type as Kind, raw)}
              />
              <Button
                variant="ghost"
                size="sm"
                className="justify-self-end"
                onClick={() => {
                  const next = { ...values };
                  delete next[name];
                  const nextDrafts = { ...drafts };
                  delete nextDrafts[name];
                  publish(next, nextDrafts);
                }}
              >
                不提供此参数
              </Button>
            </div>
          ))}
          {!!unknown.length && (
            <Notice tone="warning">
              包含未定义参数：{unknown.join("、")}。
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  publish(
                    Object.fromEntries(
                      Object.entries(values).filter(
                        ([name]) => definitions[name],
                      ),
                    ),
                    Object.fromEntries(
                      Object.entries(drafts).filter(
                        ([name]) => definitions[name],
                      ),
                    ),
                  );
                }}
              >
                移除未定义参数
              </Button>
            </Notice>
          )}
        </>
      )}
      {(error || parseError) && (
        <p role="alert" className="text-xs text-danger">
          {error || parseError}
        </p>
      )}
      {fieldName === "sample_data" && (
        <p className="text-xs text-muted">
          样例只用于草稿预览，不是发送默认值；请使用虚构内容。
        </p>
      )}
    </section>
  );
}
