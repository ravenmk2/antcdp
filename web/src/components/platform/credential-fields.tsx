export interface ProviderField {
  key: string;
  label: string;
  type?: "text" | "textarea" | "password";
  limit?: number;
  placeholder?: string;
  help?: string;
  options?: { value: string; label: string }[];
}

import { Field } from "./field";
import { NativeSelect } from "./native-select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
export type Values = Record<string, string>;
export function ProviderFields({
  fields,
  values,
  onChange,
  errors,
}: {
  fields: ProviderField[];
  values: Values;
  onChange: (values: Values) => void;
  errors: Values;
}) {
  return (
    <>
      {fields.map((f) => (
        <Field key={f.key} label={f.label} hint={f.help} error={errors[f.key]}>
          {(props) =>
            f.options ? (
              <NativeSelect
                {...props}
                value={values[f.key] || ""}
                onChange={(e) =>
                  onChange({ ...values, [f.key]: e.target.value })
                }
              >
                {f.options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </NativeSelect>
            ) : f.type === "textarea" ? (
              <Textarea
                {...props}
                rows={3}
                spellCheck={false}
                autoComplete="off"
                maxLength={f.limit}
                value={values[f.key] || ""}
                placeholder={f.placeholder}
                onChange={(e) =>
                  onChange({ ...values, [f.key]: e.target.value })
                }
              />
            ) : (
              <Input
                {...props}
                type={f.type || "text"}
                autoComplete={f.type === "password" ? "new-password" : "off"}
                maxLength={f.limit}
                value={values[f.key] || ""}
                placeholder={f.placeholder}
                onChange={(e) =>
                  onChange({ ...values, [f.key]: e.target.value })
                }
              />
            )
          }
        </Field>
      ))}
    </>
  );
}
export interface CredentialMetadata {
  name: string;
  code: string;
  description: string;
  enabled: boolean;
  expires: string;
}
export function CredentialMetadataFields<T extends CredentialMetadata>({
  draft: d,
  update,
  mode,
  errors,
}: {
  draft: T;
  update: (d: T) => void;
  mode: "edit" | "create" | "secret";
  errors: Values;
}) {
  return (
    <>
      {" "}
      {mode !== "secret" && (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="凭证名称" required error={errors.name}>
              {(p) => (
                <Input
                  {...p}
                  value={d.name}
                  maxLength={100}
                  onChange={(e) => update({ ...d, name: e.target.value })}
                />
              )}
            </Field>
            <Field label="凭证编码" error={errors.code} hint="留空由系统生成">
              {(p) => (
                <Input
                  {...p}
                  disabled={mode === "edit"}
                  value={d.code}
                  onChange={(e) => update({ ...d, code: e.target.value })}
                />
              )}
            </Field>
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
          <Field label="到期时间（本地）" error={errors.expires_at}>
            {(p) => (
              <Input
                {...p}
                type="datetime-local"
                value={d.expires}
                onChange={(e) => update({ ...d, expires: e.target.value })}
              />
            )}
          </Field>
          {mode === "edit" && (
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={d.enabled}
                onChange={(e) => update({ ...d, enabled: e.target.checked })}
              />
              启用凭证
            </label>
          )}
        </>
      )}
    </>
  );
}
