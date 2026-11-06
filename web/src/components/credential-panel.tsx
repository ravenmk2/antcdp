import { DateTimePicker } from "@/components/date-time-picker";
import { useAuth } from "@/app/auth";
import { TableToolbar } from "@/components/table-toolbar";
import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { KeyRound, Pencil, Plus, Star, Trash2 } from "lucide-react";
import { request } from "@/api/client";
import { Button } from "./button";
import { AsyncBoundary, ErrorNotice, Notice, StatusBadge } from "./feedback";
import {
  Field,
  Input,
  Select,
  StandaloneInput,
  StandaloneSelect,
  Textarea,
} from "./fields";
import { ConfirmDialog, Drawer } from "./overlays";
import { SimpleTable } from "./table";
import { WizardSteps } from "./wizard";
import { useApiQuery } from "@/hooks/use-api";
import { useFormErrors, useSubmission } from "@/hooks/use-form";
import { useUnsaved } from "@/hooks/use-unsaved";
import {
  authenticationBody,
  type ProviderDefinition,
} from "@/domain/service-providers";
import { formatDate } from "@/lib/utils";
import type {
  Credential,
  CredentialSet,
  Diagnostic,
  Selection,
} from "@/types/integrations";

export function CredentialPanel({
  base,
  provider,
  fallbackPath,
  readonly = false,
}: {
  base: string;
  provider: ProviderDefinition;
  system?: boolean;
  fallbackPath?: string;
  readonly?: boolean;
}) {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [editor, setEditor] = useState<{
    mode: "create" | "edit" | "auth";
    credential?: Credential;
  } | null>(null);
  const [remove, setRemove] = useState<Credential | null>(null);
  const [diagnostic, setDiagnostic] = useState<Credential | null>(null);
  const { settings } = useAuth();
  const queryClient = useQueryClient();
  const list = useApiQuery<CredentialSet>(["credentials", base], base);
  const fallback = useApiQuery<Selection>(
    ["fallback", fallbackPath],
    fallbackPath ?? "",
    { enabled: Boolean(fallbackPath) },
  );
  const submission = useSubmission();
  const items = useMemo(
    () =>
      (list.data?.data.items ?? []).filter((credential) => {
        if (
          q &&
          !`${credential.name} ${credential.code} ${credential.description}`
            .toLowerCase()
            .includes(q.toLowerCase())
        )
          return false;
        const expired =
          credential.expires_at !== null &&
          Date.parse(credential.expires_at) <= Date.now();
        const expiring =
          credential.expires_at !== null &&
          !expired &&
          Date.parse(credential.expires_at) <= Date.now() + 7 * 86400000;
        if (status === "available")
          return credential.enabled && credential.has_secret && !expired;
        if (status === "expiring") return expiring;
        if (status === "expired") return expired;
        if (status === "disabled") return !credential.enabled;
        if (status === "missing") return !credential.has_secret;
        return true;
      }),
    [list.data, q, status],
  );
  async function refresh() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["credentials", base] }),
      queryClient.invalidateQueries({ queryKey: ["preferred", base] }),
      queryClient.invalidateQueries({ queryKey: ["fallback", fallbackPath] }),
    ]);
  }
  async function selectPreferred(credential: Credential, clear: boolean) {
    await submission.run(async () => {
      const current = await request<Selection>(`${base}/preferred`);
      await request(`${base}/preferred`, {
        method: clear ? "DELETE" : "PUT",
        etag: current.etag,
        body: clear ? undefined : { credential_id: credential.id },
      });
      await refresh();
    });
  }
  async function selectFallback(credential: Credential, clear: boolean) {
    if (!fallbackPath) return;
    await submission.run(async () => {
      const current = await request<Selection>(fallbackPath);
      await request(fallbackPath, {
        method: clear ? "DELETE" : "PUT",
        etag: current.etag,
        body: clear ? undefined : { credential_id: credential.id },
      });
      await refresh();
    });
  }
  return (
    <section className="panel">
      <TableToolbar
        onReset={() => {
          setQ("");
          setStatus("");
        }}
        onRefresh={() => void refresh()}
        refreshing={list.isFetching}
        actions={
          <Button
            className="flex items-center gap-2"
            disabled={readonly}
            onClick={() => setEditor({ mode: "create" })}
          >
            <Plus />
            添加凭证
          </Button>
        }
      >
        <StandaloneInput
          aria-label="搜索凭证"
          placeholder="搜索名称、编码或说明"
          value={q}
          onChange={(event) => setQ(event.target.value)}
        />
        <StandaloneSelect
          aria-label="凭证状态"
          value={status}
          onValueChange={(value) => setStatus(value)}
        >
          <option value="">全部状态</option>
          <option value="available">可用</option>
          <option value="expiring">即将到期（7 天内）</option>
          <option value="expired">已过期</option>
          <option value="disabled">已停用</option>
          <option value="missing">未配置秘密</option>
        </StandaloneSelect>
      </TableToolbar>
      <ErrorNotice error={submission.error} />
      <AsyncBoundary
        loading={list.isPending}
        error={list.error}
        onRetry={() => void list.refetch()}
        empty={!items.length}
        emptyTitle={q || status ? "没有匹配的凭证" : "尚未配置凭证"}
        emptyDescription="凭证验证成功不代表具备所有业务权限；秘密保存后不可读取。"
      >
        <SimpleTable
          label={`${provider.name} 凭证`}
          headers={["凭证", "认证方式", "状态", "有效期", "标记", "操作"]}
        >
          {items.map((credential) => {
            const expired =
              credential.expires_at !== null &&
              Date.parse(credential.expires_at) <= Date.now();
            const fallbackSelected =
              fallback.data?.data.credential_id === credential.id;
            return (
              <tr key={credential.id}>
                <td>
                  <strong className="text-foreground">{credential.name}</strong>
                  <small className="mono mt-1 block text-muted">
                    {credential.code}
                  </small>
                  {credential.description && (
                    <small className="mt-1 block text-muted">
                      {credential.description}
                    </small>
                  )}
                </td>
                <td className="text-xs">
                  {provider.methods.find(
                    (method) => method.value === credential.auth_method,
                  )?.label ?? credential.auth_method}
                  <small className="block text-muted">
                    {credential.identity_config.username || "—"}
                  </small>
                </td>
                <td>
                  <StatusBadge
                    tone={
                      !credential.enabled || expired
                        ? "neutral"
                        : credential.has_secret
                          ? "success"
                          : "warning"
                    }
                  >
                    {!credential.enabled
                      ? "已停用"
                      : expired
                        ? "已过期"
                        : credential.has_secret
                          ? "已配置"
                          : "缺少秘密"}
                  </StatusBadge>
                </td>
                <td className="text-xs text-muted">
                  {credential.expires_at
                    ? formatDate(credential.expires_at, settings.timezone)
                    : "无固定期限"}
                </td>
                <td>
                  <div className="flex flex-wrap gap-1">
                    {credential.is_preferred && (
                      <StatusBadge tone="info">首选</StatusBadge>
                    )}
                    {fallbackSelected && (
                      <StatusBadge tone="info">兜底</StatusBadge>
                    )}
                  </div>
                </td>
                <td>
                  <div className="flex flex-wrap justify-end gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={readonly}
                      onClick={() => setEditor({ mode: "edit", credential })}
                    >
                      <Pencil />
                      编辑
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setDiagnostic(credential)}
                    >
                      记录
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={readonly}
                      onClick={() => setEditor({ mode: "auth", credential })}
                    >
                      <KeyRound />
                      替换认证
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={readonly}
                      onClick={() =>
                        void selectPreferred(
                          credential,
                          credential.is_preferred,
                        )
                      }
                    >
                      <Star />
                      {credential.is_preferred ? "取消首选" : "设为首选"}
                    </Button>
                    {fallbackPath && (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={readonly}
                        onClick={() =>
                          void selectFallback(credential, fallbackSelected)
                        }
                      >
                        {fallbackSelected ? "清除兜底" : "设为兜底"}
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-danger"
                      disabled={readonly}
                      onClick={() => setRemove(credential)}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                </td>
              </tr>
            );
          })}
        </SimpleTable>
      </AsyncBoundary>
      {editor && (
        <CredentialEditor
          key={`${editor.mode}-${editor.credential?.id ?? "new"}`}
          base={base}
          provider={provider}
          mode={editor.mode}
          credential={editor.credential}
          collectionEtag={list.data?.collectionEtag ?? ""}
          onClose={() => setEditor(null)}
          onSaved={refresh}
        />
      )}
      {diagnostic && (
        <CredentialDiagnostic
          base={base}
          credential={diagnostic}
          onClose={() => setDiagnostic(null)}
        />
      )}
      {remove && (
        <ConfirmDialog
          open
          danger
          title="删除凭证"
          description={`${remove.name} · ${remove.code}`}
          confirmLabel="删除凭证"
          pending={submission.pending}
          onClose={() => setRemove(null)}
          onConfirm={() =>
            void submission.run(async () => {
              await request(`${base}/${remove.id}`, {
                method: "DELETE",
                etag: `"${remove.version}"`,
                collectionEtag: list.data?.collectionEtag,
              });
              await refresh();
              setRemove(null);
            })
          }
        >
          <ErrorNotice error={submission.error} />
          <p className="text-sm text-muted">
            删除后秘密不可恢复；首选或兜底引用会按服务端规则清理。
          </p>
        </ConfirmDialog>
      )}
    </section>
  );
}

function CredentialEditor({
  base,
  provider,
  mode,
  credential,
  collectionEtag,
  onClose,
  onSaved,
}: {
  base: string;
  provider: ProviderDefinition;
  mode: "create" | "edit" | "auth";
  credential?: Credential;
  collectionEtag: string;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { settings } = useAuth();
  const [step, setStep] = useState(0);
  const [form, setForm] = useState({
    name: credential?.name ?? "",
    code: credential?.code ?? "",
    description: credential?.description ?? "",
    enabled: credential?.enabled ?? true,
    expires: credential?.expires_at ?? "",
  });
  const [method, setMethod] = useState(
    credential?.auth_method ?? provider.methods[0]?.value ?? "",
  );
  const [values, setValues] = useState<Record<string, string>>({
    ...credential?.identity_config,
  });
  const errors = useFormErrors();
  const submission = useSubmission();
  const currentMethod =
    provider.methods.find((item) => item.value === method) ??
    provider.methods[0];
  useUnsaved(true, submission.pending);
  function changeMethod(value: string) {
    setMethod(value);
    setValues({});
    errors.clear();
  }
  function validate(targetStep: number) {
    const fields: Record<string, string> = {};
    if (mode !== "auth" && targetStep >= 0) {
      if (!form.name.trim()) fields.name = "请输入凭证名称";
      if (
        mode === "create" &&
        form.code &&
        !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(form.code)
      )
        fields.code = "编码格式不正确";
    }
    if (mode !== "edit" && targetStep >= 1 && currentMethod) {
      for (const field of [...currentMethod.identity, ...currentMethod.secret])
        if (!(values[field.key] ?? ""))
          fields[field.key] = `请输入${field.label}`;
    }
    return errors.validate(fields);
  }
  async function save() {
    if (!validate(mode === "create" ? 1 : 1)) return;
    await submission.run(
      async () => {
        if (mode === "create") {
          await request(base, {
            method: "POST",
            etag: collectionEtag,
            body: {
              code: form.code.trim(),
              name: form.name.trim(),
              description: form.description,
              expires_at: form.expires
                ? new Date(form.expires).toISOString()
                : null,
              authentication: currentMethod
                ? authenticationBody(currentMethod, values)
                : undefined,
            },
          });
        } else if (mode === "edit" && credential) {
          await request(`${base}/${credential.id}`, {
            method: "PATCH",
            etag: `"${credential.version}"`,
            body: {
              name: form.name.trim(),
              description: form.description,
              enabled: form.enabled,
              expires_at: form.expires
                ? new Date(form.expires).toISOString()
                : null,
            },
          });
        } else if (credential && currentMethod) {
          await request(`${base}/${credential.id}/authentication`, {
            method: "PUT",
            etag: `"${credential.version}"`,
            body: authenticationBody(currentMethod, values),
          });
        }
        await onSaved();
        onClose();
      },
      (error) =>
        errors.show(error, [
          "name",
          "code",
          "description",
          "enabled",
          "expires_at",
          "username",
          "token",
          "private_key",
          "passphrase",
        ]),
    );
  }
  const title =
    mode === "create"
      ? "添加凭证"
      : mode === "edit"
        ? "编辑凭证"
        : "替换认证信息";
  return (
    <Drawer
      open
      wide
      title={title}
      description={
        credential
          ? `${credential.name} · ${credential.code}`
          : `${provider.name} · 秘密只在本次写入中可见`
      }
      dirty
      pending={submission.pending}
      onClose={onClose}
      footer={
        <>
          {mode === "create" && step > 0 && (
            <Button variant="outline" onClick={() => setStep(step - 1)}>
              上一步
            </Button>
          )}
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          {mode === "create" && step < 2 ? (
            <Button
              onClick={() => {
                if (validate(step)) setStep(step + 1);
              }}
            >
              下一步
            </Button>
          ) : (
            <Button
              pending={submission.pending}
              disabled={submission.uncertain}
              onClick={() => void save()}
            >
              {mode === "auth" ? "替换完整认证" : "保存"}
            </Button>
          )}
        </>
      }
    >
      {mode === "create" && (
        <WizardSteps steps={["基本资料", "认证信息", "确认"]} current={step} />
      )}
      <form
        ref={errors.formRef}
        className="mt-5 grid gap-4"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (mode === "create" && step < 2) {
            if (validate(step)) setStep(step + 1);
          } else void save();
        }}
      >
        <ErrorNotice error={errors.error} />
        <ErrorNotice error={submission.error} />
        {mode === "create" && step === 2 && (
          <Notice>
            凭证：{form.name} · {currentMethod?.label}
            。创建后不会自动设为首选或兜底，秘密不可再次读取。
          </Notice>
        )}
        {(mode !== "create" || step === 0 || step === 2) && mode !== "auth" && (
          <div className="form-grid">
            <Field label="名称" required error={errors.fields.name}>
              <Input
                name="name"
                value={form.name}
                onChange={(event) =>
                  setForm({ ...form, name: event.target.value })
                }
              />
            </Field>
            <Field
              label="编码（可选）"
              hint={credential ? "创建后不可修改" : "留空自动生成"}
              error={errors.fields.code}
            >
              <Input
                name="code"
                className="mono"
                readOnly={Boolean(credential)}
                value={form.code}
                onChange={(event) =>
                  setForm({ ...form, code: event.target.value })
                }
              />
            </Field>
            <Field label="说明" className="form-full">
              <Textarea
                name="description"
                value={form.description}
                onChange={(event) =>
                  setForm({ ...form, description: event.target.value })
                }
              />
            </Field>
            <Field label="到期时间（可选）" error={errors.fields.expires_at}>
              <DateTimePicker
                name="expires_at"
                value={form.expires}
                timezone={settings.timezone}
                onChange={(expires) => setForm({ ...form, expires })}
              />
            </Field>
            {mode === "edit" && (
              <label className="flex items-center gap-2 self-end pb-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.enabled}
                  onChange={(event) =>
                    setForm({ ...form, enabled: event.target.checked })
                  }
                />
                启用凭证
              </label>
            )}
          </div>
        )}
        {mode !== "edit" &&
          (mode !== "create" || step === 1) &&
          currentMethod && (
            <>
              <Field label="认证方式">
                <Select
                  value={method}
                  onValueChange={(value) => changeMethod(value)}
                >
                  {provider.methods.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </Select>
              </Field>
              {[...currentMethod.identity, ...currentMethod.secret].map(
                (field) => (
                  <Field
                    key={field.key}
                    label={field.label}
                    required
                    error={errors.fields[field.key]}
                  >
                    {field.type === "textarea" ? (
                      <Textarea
                        name={field.key}
                        className="font-mono"
                        autoComplete="off"
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
                ),
              )}
            </>
          )}
      </form>
    </Drawer>
  );
}

function CredentialDiagnostic({
  base,
  credential,
  onClose,
}: {
  base: string;
  credential: Credential;
  onClose: () => void;
}) {
  const query = useApiQuery<{ latest: Diagnostic | null }>(
    ["credential-diagnostic", base, credential.id],
    `${base}/${credential.id}/diagnostics`,
  );
  const [current, setCurrent] = useState<Diagnostic | null>(null);
  const submission = useSubmission();
  const value = current ?? query.data?.data.latest ?? null;
  return (
    <Drawer
      open
      title="凭证验证记录"
      description={`${credential.name} · 验证使用已保存材料`}
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            关闭
          </Button>
          <Button
            pending={submission.pending}
            disabled={!credential.enabled || !credential.has_secret}
            onClick={() =>
              void submission.run(async () => {
                const response = await request<Diagnostic>(
                  `${base}/${credential.id}/verify`,
                  { method: "POST", etag: `"${credential.version}"`, body: {} },
                );
                setCurrent(response.data);
              })
            }
          >
            验证已保存凭证
          </Button>
        </>
      }
    >
      <ErrorNotice error={submission.error} />
      <AsyncBoundary
        loading={query.isPending}
        error={query.error}
        onRetry={() => void query.refetch()}
      >
        {value ? (
          <Notice
            tone={
              value.status === "succeeded"
                ? "success"
                : value.status === "failed"
                  ? "danger"
                  : "warning"
            }
          >
            <strong>
              {value.outdated ? "历史结果 · " : ""}
              {value.status}
            </strong>
            <p className="mt-2">
              {value.summary.reason ??
                value.summary.authentication ??
                value.summary.permissions ??
                "诊断已记录"}
            </p>
            <small>{formatDate(value.finished_at)}</small>
          </Notice>
        ) : (
          <p className="text-sm text-muted">尚无验证记录。</p>
        )}
      </AsyncBoundary>
    </Drawer>
  );
}
