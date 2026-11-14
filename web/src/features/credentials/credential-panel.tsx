import { ApiError, isVersionConflict, request } from "@/api/client";
import { useAuth } from "@/app/auth";
import { Button } from "@/components/button";
import { DateTimePicker } from "@/components/date-time-picker";
import {
  AsyncBoundary,
  ErrorNotice,
  Notice,
  StatusBadge,
} from "@/components/feedback";
import {
  Field,
  Input,
  Select,
  StandaloneInput,
  StandaloneSelect,
  Textarea,
} from "@/components/fields";
import { DescriptionList } from "@/components/layout";
import { OverlayPresence } from "@/components/overlay-presence";
import { ConfirmDialog, Drawer } from "@/components/overlays";
import {
  RowAction,
  RowActions,
  RowActionSeparator,
} from "@/components/row-actions";
import { SimpleTable } from "@/components/table";
import { TableToolbar } from "@/components/table-toolbar";
import { SheetClose } from "@/components/ui/sheet";
import { WizardSteps } from "@/components/wizard";
import {
  authenticationBody,
  type ProviderDefinition,
} from "@/domain/service-providers";
import { useApiQuery } from "@/hooks/use-api";
import { useFormErrors, useSubmission } from "@/hooks/use-form";
import { useUnsaved } from "@/hooks/use-unsaved";
import { formatDate } from "@/lib/utils";
import type {
  Credential,
  CredentialSet,
  Diagnostic,
  Selection,
} from "@/types/integrations";
import { useQueryClient } from "@tanstack/react-query";
import {
  FileClock,
  KeyRound,
  Pencil,
  Plus,
  ShieldCheck,
  Star,
  Trash2,
} from "lucide-react";
import { useMemo, useRef, useState } from "react";

export function CredentialPanel({
  base,
  provider,
  fallbackPath,
  readonly = false,
}: {
  base: string;
  provider: ProviderDefinition;
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
            disabled={
              readonly ||
              list.isPending ||
              list.isFetching ||
              Boolean(list.error) ||
              !list.data?.etag
            }
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
          actions
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
                  <RowActions label={credential.name}>
                    <RowAction
                      icon={<Pencil />}
                      disabled={readonly}
                      onSelect={() => setEditor({ mode: "edit", credential })}
                    >
                      编辑
                    </RowAction>
                    <RowAction
                      icon={<FileClock />}
                      onSelect={() => setDiagnostic(credential)}
                    >
                      验证记录
                    </RowAction>
                    <RowAction
                      icon={<KeyRound />}
                      disabled={readonly}
                      onSelect={() => setEditor({ mode: "auth", credential })}
                    >
                      替换认证
                    </RowAction>
                    <RowAction
                      icon={<Star />}
                      disabled={readonly}
                      onSelect={() =>
                        void selectPreferred(
                          credential,
                          credential.is_preferred,
                        )
                      }
                    >
                      {credential.is_preferred ? "取消首选" : "设为首选"}
                    </RowAction>
                    {fallbackPath && (
                      <RowAction
                        icon={<ShieldCheck />}
                        disabled={readonly}
                        onSelect={() =>
                          void selectFallback(credential, fallbackSelected)
                        }
                      >
                        {fallbackSelected ? "清除兜底" : "设为兜底"}
                      </RowAction>
                    )}
                    <RowActionSeparator />
                    <RowAction
                      icon={<Trash2 />}
                      variant="destructive"
                      disabled={readonly}
                      onSelect={() => setRemove(credential)}
                    >
                      删除凭证
                    </RowAction>
                  </RowActions>
                </td>
              </tr>
            );
          })}
        </SimpleTable>
      </AsyncBoundary>
      <OverlayPresence>
        {editor && (
          <CredentialEditor
            key={`${editor.mode}-${editor.credential?.id ?? "new"}`}
            base={base}
            provider={provider}
            mode={editor.mode}
            credential={editor.credential}
            collectionEtag={list.data?.etag ?? ""}
            onClose={() => setEditor(null)}
            onSaved={refresh}
          />
        )}
      </OverlayPresence>
      <OverlayPresence>
        {diagnostic && (
          <CredentialDiagnostic
            base={base}
            credential={diagnostic}
            onClose={() => setDiagnostic(null)}
          />
        )}
      </OverlayPresence>
      {remove && (
        <ConfirmDialog
          open
          danger
          title="删除凭证"
          description={`${remove.name} · ${remove.code}`}
          confirmLabel="删除凭证"
          pending={submission.pending}
          confirmDisabled={submission.uncertain || !list.data?.etag}
          onClose={() => setRemove(null)}
          onConfirm={() =>
            void submission.run(async () => {
              await request(`${base}/${remove.id}`, {
                method: "DELETE",
                etag: `"${remove.version}"`,
                collectionEtag: list.data?.etag,
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
  const queryClient = useQueryClient();
  const saving = useRef(false);
  const [writeEtag, setWriteEtag] = useState(collectionEtag);
  const [needsReload, setNeedsReload] = useState(
    mode === "create" && !collectionEtag,
  );
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
  const dirty =
    form.name !== (credential?.name ?? "") ||
    form.code !== (credential?.code ?? "") ||
    form.description !== (credential?.description ?? "") ||
    form.enabled !== (credential?.enabled ?? true) ||
    form.expires !== (credential?.expires_at ?? "") ||
    method !== (credential?.auth_method ?? provider.methods[0]?.value ?? "") ||
    JSON.stringify(values) !==
      JSON.stringify(credential?.identity_config ?? {});
  const markSaved = useUnsaved(dirty, submission.pending);
  function close() {
    markSaved();
    onClose();
  }
  async function reloadCollection() {
    if (submission.pending || submission.uncertain) return;
    await submission.run(async () => {
      const response = await request<CredentialSet>(base);
      if (!response.etag)
        throw new ApiError(
          "PRECONDITION_REQUIRED",
          "未能加载凭证列表信息，请重试。",
          428,
        );
      queryClient.setQueryData(["credentials", base], response);
      setWriteEtag(response.etag);
      setNeedsReload(false);
      errors.clear();
    });
  }
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
    if (
      saving.current ||
      submission.pending ||
      submission.uncertain ||
      needsReload
    )
      return;
    if (!validate(1)) return;
    saving.current = true;
    try {
      await submission.run(
        async () => {
          if (mode === "create") {
            await request(base, {
              method: "POST",
              etag: writeEtag,
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
          close();
        },
        (error) => {
          if (mode === "create" && isVersionConflict(error))
            setNeedsReload(true);
          const aliases = Object.fromEntries([
            ...(currentMethod?.identity ?? []).map((field) => [
              `authentication.identity_config.${field.key}`,
              field.key,
            ]),
            ...(currentMethod?.secret ?? []).map((field) => [
              `authentication.secret.${field.key}`,
              field.key,
            ]),
          ]);
          const failedField = error.details.find(
            (detail) => detail.field,
          )?.field;
          if (mode === "create") {
            if (
              failedField?.startsWith("authentication") ||
              failedField === "auth_method" ||
              [
                ...(currentMethod?.identity ?? []),
                ...(currentMethod?.secret ?? []),
              ].some((field) => field.key === failedField)
            )
              setStep(1);
            else if (
              failedField ||
              [
                "CODE_CONFLICT",
                "CREDENTIAL_CODE_CONFLICT",
                "NAME_CONFLICT",
              ].includes(error.code)
            )
              setStep(0);
          }
          errors.show(
            error,
            [
              "name",
              "code",
              "description",
              "enabled",
              "expires_at",
              "username",
              "token",
              "private_key",
              "passphrase",
              "auth_method",
            ],
            aliases,
          );
          const authFields = [
            ...(currentMethod?.identity ?? []),
            ...(currentMethod?.secret ?? []),
          ];
          errors.setFields((current) => {
            const next = { ...current };
            for (const detail of error.details) {
              const key = aliases[detail.field ?? ""] ?? detail.field;
              const field = authFields.find((field) => field.key === key);
              if (field)
                next[field.key] =
                  detail.code === "required"
                    ? `请输入${field.label}`
                    : detail.code === "invalid_key_or_passphrase"
                      ? "无法读取私钥，请检查私钥内容和口令是否匹配。"
                      : `请检查${field.label}的格式或内容。`;
            }
            return next;
          });
        },
      );
    } finally {
      saving.current = false;
    }
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
          : `${provider.name} 访问凭证`
      }
      dirty={dirty}
      pending={submission.pending}
      onClose={close}
      footer={
        <>
          {mode === "create" && step > 0 && (
            <Button
              variant="outline"
              disabled={submission.pending || submission.uncertain}
              onClick={() => setStep(step - 1)}
            >
              上一步
            </Button>
          )}
          <SheetClose
            render={
              <Button variant="outline" disabled={submission.pending}>
                取消
              </Button>
            }
          />
          {mode === "create" && step < 2 ? (
            <Button
              disabled={submission.pending || submission.uncertain}
              onClick={() => {
                if (validate(step)) setStep(step + 1);
              }}
            >
              下一步
            </Button>
          ) : (
            <Button
              pending={submission.pending}
              disabled={submission.uncertain || needsReload}
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
        onChange={() => errors.clear()}
        onSubmit={(event) => {
          event.preventDefault();
          if (mode === "create" && step < 2) {
            if (validate(step)) setStep(step + 1);
          } else void save();
        }}
      >
        <CredentialSaveError
          error={submission.error}
          creating={mode === "create"}
        />
        {needsReload && !submission.uncertain && (
          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="outline"
              pending={submission.pending}
              onClick={() => void reloadCollection()}
            >
              重新加载凭证列表
            </Button>
            <span className="text-xs text-muted">
              保留已填写内容，加载后请再次确认保存。
            </span>
          </div>
        )}
        <fieldset
          disabled={submission.pending || submission.uncertain}
          className="grid min-w-0 gap-4"
        >
          {mode === "create" && step === 2 && (
            <DescriptionList
              items={[
                {
                  label: "名称",
                  value: <span className="break-all">{form.name}</span>,
                },
                {
                  label: "编码",
                  value: (
                    <span className="mono break-all">
                      {form.code || "自动生成"}
                    </span>
                  ),
                },
                { label: "认证方式", value: currentMethod?.label ?? "—" },
                {
                  label: "到期时间",
                  value: form.expires
                    ? formatDate(form.expires, settings.timezone)
                    : "永不过期",
                },
                ...(currentMethod?.identity ?? []).map((field) => ({
                  label: field.label,
                  value: (
                    <span className="break-all">
                      {values[field.key] || "—"}
                    </span>
                  ),
                })),
                {
                  label: "说明",
                  full: true,
                  value: (
                    <span className="whitespace-pre-wrap break-all">
                      {form.description || "—"}
                    </span>
                  ),
                },
              ]}
            />
          )}
          {(mode !== "create" || step === 0) && mode !== "auth" && (
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
              <Field
                label="说明"
                className="form-full"
                error={errors.fields.description}
              >
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
                <p className="m-0 text-xs text-muted">
                  密码、私钥或 Token 保存后不可查看，请妥善保管。
                </p>
                <Field label="认证方式" error={errors.fields.auth_method}>
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
          {mode === "create" && step === 2 && (
            <p className="m-0 text-xs text-muted">
              保存后可在列表中设为首选凭证。
            </p>
          )}
        </fieldset>
      </form>
    </Drawer>
  );
}

function CredentialSaveError({
  error,
  creating,
}: {
  error: unknown;
  creating: boolean;
}) {
  if (!error) return null;
  const apiError = error instanceof ApiError ? error : null;
  const conflict = isVersionConflict(error);
  const message = apiError?.uncertain
    ? "保存结果尚未确认。请先查看凭证列表核实，避免重复提交。"
    : conflict
      ? creating
        ? "凭证列表信息已失效，请重新加载后再保存。"
        : "凭证已被更新，请保留需要的修改内容，关闭后重新打开核对。"
      : apiError?.status === 422 || apiError?.status === 409
        ? "凭证未保存，请检查标出的字段后重试。"
        : apiError?.message || "保存失败，请检查连接后重试。";
  return (
    <Notice tone="danger">
      <p className="m-0">
        {message}
        {apiError?.retryAfter && apiError.retryAfter > 0
          ? ` 请等待 ${apiError.retryAfter} 秒后重试。`
          : ""}
      </p>
      {apiError && (
        <details className="mt-2 text-xs">
          <summary className="cursor-pointer">技术详情</summary>
          <div className="mt-2 space-y-1 break-all">
            <p className="m-0">错误代码：{apiError.code}</p>
            {apiError.requestId && (
              <p className="m-0">请求编号：{apiError.requestId}</p>
            )}
          </div>
        </details>
      )}
    </Notice>
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
