import { authenticationUI, serviceUI } from "@/shared/ssh-providers";
import { Field } from "@/components/platform/field";

import {
  ProviderFields,
  CredentialMetadataFields,
} from "@/components/platform/credential-fields";
export { ProviderFields };
import { NativeSelect } from "@/components/platform/native-select";

import type { HostCredential } from "@/shared/remote-hosts";
export const validCode = (code: string) =>
  !code || /^[a-z0-9][a-z0-9_-]{0,63}$/.test(code);
export type Values = Record<string, string>;
export function configErrors(values: Values) {
  const errors: Values = {};
  if (!values.host?.trim() || /[\s/@?#,]/.test(values.host))
    errors.host = "请输入不含协议或端口的主机名或 IP。";
  const port = Number(values.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    errors.port = "SSH 端口范围为 1–65535。";
  return errors;
}
export function credentialDraft(kind: string, row?: HostCredential) {
  const expires = row?.expires_at ? new Date(row.expires_at) : null;
  return {
    name: row?.name || "",
    description: row?.description || "",
    code: row?.code || "",
    enabled: row?.enabled ?? true,
    expires: expires
      ? new Date(expires.getTime() - expires.getTimezoneOffset() * 60000)
          .toISOString()
          .slice(0, 16)
      : "",
    method: row?.auth_method || serviceUI[kind]!.authMethod,
    values: { ...row?.identity_config } as Values,
  };
}
export type CredentialDraft = ReturnType<typeof credentialDraft>;
export type CredentialMode = "create" | "edit" | "secret";
export function credentialErrors(
  kind: string,
  d: CredentialDraft,
  mode: CredentialMode,
) {
  const errors: Values = {};
  if (mode !== "secret") {
    if (!d.name.trim()) errors.name = "请输入凭证名称。";
    if (!validCode(d.code.trim()))
      errors.code = "使用小写字母、数字、下划线或连字符，最多 64 位。";
    if (d.expires && !Number.isFinite(Date.parse(d.expires)))
      errors.expires_at = "请选择有效的到期时间。";
  }
  if (mode !== "edit") {
    const adapter = authenticationUI(kind, d.method),
      issue = adapter.validateSecret(d.values);
    if (issue) {
      const key =
        [...adapter.identityFields, ...adapter.secretFields].find(
          (f) => !d.values[f.key]?.trim(),
        )?.key ||
        adapter.secretFields[0]?.key ||
        "authentication";
      errors[key] = issue;
    }
  }
  return errors;
}
export function clearSecrets(kind: string, d: CredentialDraft) {
  const values: Values = {};
  for (const field of authenticationUI(kind, d.method).identityFields) {
    if (d.values[field.key] !== undefined)
      values[field.key] = d.values[field.key]!;
  }
  return { ...d, values };
}
export function authentication(kind: string, d: CredentialDraft) {
  const a = authenticationUI(kind, d.method);
  return {
    auth_method: a.authMethod,
    identity_config: a.identityBody(d.values),
    secret: a.secretBody(d.values),
  };
}
export function credentialBody(kind: string, d: CredentialDraft) {
  return {
    code: d.code.trim(),
    name: d.name,
    description: d.description,
    expires_at: d.expires ? new Date(d.expires).toISOString() : null,
    authentication: authentication(kind, d),
  };
}
export function CredentialFields({
  kind,
  draft: d,
  update,
  mode,
  errors,
}: {
  kind: string;
  draft: CredentialDraft;
  update: (d: CredentialDraft) => void;
  mode: CredentialMode;
  errors: Values;
}) {
  const a = authenticationUI(kind, d.method);
  return (
    <div className="space-y-5">
      <CredentialMetadataFields
        draft={d}
        update={update}
        mode={mode}
        errors={errors}
      />
      {mode !== "edit" && (
        <section className="space-y-4">
          <h3 className="border-b pb-2 font-medium">认证材料</h3>
          <Field label="SSH 认证方式">
            {(p) => (
              <NativeSelect
                {...p}
                value={d.method}
                onChange={(e) =>
                  update({
                    ...d,
                    method: e.target.value,
                    values: { username: d.values.username || "" },
                  })
                }
              >
                <option value="ssh_password">密码</option>
                <option value="ssh_private_key">SSH 私钥</option>
                <option value="ssh_encrypted_key">带口令的 SSH 私钥</option>
              </NativeSelect>
            )}
          </Field>
          <ProviderFields
            fields={[...a.identityFields, ...a.secretFields]}
            values={d.values}
            onChange={(values) => update({ ...d, values })}
            errors={errors}
          />
        </section>
      )}
    </div>
  );
}
