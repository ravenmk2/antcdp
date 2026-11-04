import { StatusText } from "@/components/platform/status-text";
import { useEffect, useRef, useState } from "react";
import type { Variant, Environment, BranchModel } from "@/shared/delivery";
import { emptyScope, reason } from "@/shared/delivery";
import { deliveryFieldErrors } from "@/shared/delivery-validation";
import { request, ApiError, errorMessage } from "@/lib/api";
import { RepositoryBranches } from "./RepositoryBranches";
import { FormDrawer } from "@/components/platform/form-drawer";
import { Field } from "@/components/platform/field";
import { useFormErrors } from "@/components/platform/use-form-errors";
import { ErrorBox } from "@/components/platform/feedback";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { ScopeEditor } from "./ScopeEditor";

export type ConfigurationTarget = {
  kind: "variant" | "environment";
  value?: Variant | Environment;
  collectionTag: string;
  edit?: boolean;
};
export function ConfigurationDrawer({
  projectId,
  variant,
  model,
  target,
  canManage,
  onClose,
  onSaved,
}: {
  projectId: string;
  variant?: Variant;
  model: BranchModel;
  target: ConfigurationTarget;
  canManage: boolean;
  onClose: () => void;
  onSaved: (value: Variant | Environment) => void;
}) {
  const environment = target.kind === "environment";
  const [value, setValue] = useState(target.value);
  const [editing, setEditing] = useState(target.edit || !target.value);
  function fields(current?: Variant | Environment) {
    const v = current as Variant | undefined,
      e = current as Environment | undefined;
    return {
      code: current?.code || "",
      name: current?.name || "",
      summary: current?.summary || "",
      branch: environment ? e?.branch_name || "" : v?.main_branch || "custom/",
      branch_type: environment
        ? e?.branch_type || "mainline"
        : v?.kind === "standard"
          ? "mainline"
          : "custom",
      repository_scope: structuredClone(
        current?.repository_scope || emptyScope(environment),
      ),
    };
  }
  const [form, setForm] = useState(() => fields(target.value));
  const [baseline, setBaseline] = useState(() =>
    JSON.stringify(fields(target.value)),
  );
  const [busy, setBusy] = useState(false),
    locked = useRef(false);
  const [blocked, setBlocked] = useState(false);
  const errors = useFormErrors();
  const heading = useRef<HTMLHeadingElement>(null);
  const path = environment
    ? `/projects/${projectId}/variants/${variant!.id}/environments`
    : `/projects/${projectId}/variants`;
  const writable =
    canManage &&
    (!value || value.can_manage) &&
    (!environment || !variant?.archived_at) &&
    (!value || !(value as Variant).archived_at);
  const dirty = editing && JSON.stringify(form) !== baseline;
  const rule = model.rules.find((r) => r.branch_type === form.branch_type);
  useEffect(() => {
    if (!editing) heading.current?.focus();
  }, [editing]);
  function begin() {
    const next = fields(value);
    setForm(next);
    setBaseline(JSON.stringify(next));
    errors.clear();
    setBlocked(false);
    setEditing(true);
  }
  function update<K extends keyof typeof form>(key: K, next: (typeof form)[K]) {
    setForm((old) => ({ ...old, [key]: next }));
    errors.setFields((old) => ({ ...old, [key]: "" }));
  }
  async function save() {
    if (locked.current || !writable || blocked) return;
    errors.clear();
    const invalid: Record<string, string> = {};
    if (
      !value &&
      !/^[a-zA-Z0-9](?:[a-zA-Z0-9_-]{0,62}[a-zA-Z0-9])$/.test(form.code)
    )
      invalid.code =
        "编码须为 2–64 位字母、数字、下划线或连字符，首尾为字母或数字。";
    if (!form.name.trim() || Array.from(form.name.trim()).length > 100)
      invalid.name = "名称须为 1–100 个字符。";
    if (Array.from(form.summary).length > 300)
      invalid.summary = "说明不能超过 300 个字符。";
    if (!form.branch.trim()) invalid.branch = "请填写固定 Git 分支名。";
    if (!errors.validate(invalid)) return;
    const etag = value?.etag || target.collectionTag;
    if (!etag) {
      errors.setError("版本信息缺失，请关闭后重新打开。");
      return;
    }
    locked.current = true;
    setBusy(true);
    try {
      const r = await request<Variant | Environment>(
        path + (value ? `/${value.id}` : ""),
        {
          method: value ? "PATCH" : "POST",
          etag,
          body: {
            ...(!value ? { code: form.code } : {}),
            name: form.name,
            summary: form.summary,
            repository_scope: form.repository_scope,
            ...(environment
              ? { branch_name: form.branch, branch_type: form.branch_type }
              : { main_branch: form.branch }),
          },
        },
      );
      setValue(r.data);
      setEditing(false);
      setBaseline(JSON.stringify(form));
      onSaved(r.data);
    } catch (e) {
      const fieldErrors = deliveryFieldErrors(e);
      errors.validate(fieldErrors);
      errors.setError(errorMessage(e));
      if (
        e instanceof ApiError &&
        [
          "VERSION_CONFLICT",
          "COLLECTION_VERSION_CONFLICT",
          "NETWORK_ERROR",
          "HTTP_ERROR",
          "INVALID_RESPONSE",
        ].includes(e.code)
      )
        setBlocked(true);
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  const title = editing
    ? `${value ? "编辑" : "新建"}${environment ? "环境" : "产品分支"}`
    : value?.name || "配置详情";
  return (
    <FormDrawer
      title={title}
      description={
        environment
          ? "环境绑定固定 Git 分支，仓库范围受所属产品分支约束。"
          : "产品分支定义固定主干与动态仓库范围。"
      }
      dirty={dirty}
      pending={busy}
      onClose={onClose}
      footer={(close) =>
        editing ? (
          <>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() =>
                close(
                  value
                    ? () => {
                        setEditing(false);
                        errors.clear();
                      }
                    : onClose,
                )
              }
            >
              取消编辑
            </Button>
            <Button
              form="delivery-configuration"
              type="submit"
              disabled={busy || !writable || blocked}
            >
              {busy ? "正在保存…" : "保存"}
            </Button>
          </>
        ) : (
          <>
            <Button variant="outline" onClick={() => close()}>
              关闭
            </Button>
            {writable && (
              <Button onClick={begin}>
                {environment ? "编辑环境" : "编辑产品分支"}
              </Button>
            )}
          </>
        )
      }
    >
      <ErrorBox>{errors.error}</ErrorBox>
      {blocked && (
        <p role="alert" className="text-sm">
          版本已变化或提交结果未确认。草稿已保留，请关闭后刷新核实，再基于最新记录操作。
        </p>
      )}
      {editing ? (
        <form
          id="delivery-configuration"
          ref={errors.formRef}
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
          className="space-y-6"
        >
          <fieldset disabled={busy || !writable} className="space-y-6">
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="名称" required error={errors.fields.name}>
                {(props) => (
                  <Input
                    {...props}
                    autoFocus
                    value={form.name}
                    onChange={(e) => update("name", e.target.value)}
                  />
                )}
              </Field>
              <Field
                label="编码（创建后不可变）"
                required
                error={errors.fields.code}
              >
                {(props) => (
                  <Input
                    {...props}
                    value={form.code}
                    disabled={!!value || busy}
                    onChange={(e) => update("code", e.target.value)}
                  />
                )}
              </Field>
              {environment && (
                <Field label="Git 分支类型" error={errors.fields.branch_type}>
                  {(props) => (
                    <select
                      {...props}
                      className="h-[var(--control-height)] w-full rounded-md border bg-background px-3"
                      value={form.branch_type}
                      onChange={(e) => update("branch_type", e.target.value)}
                    >
                      {model.types
                        .filter(
                          (t) =>
                            t.allow_environment &&
                            (model.rules.some(
                              (r) =>
                                r.branch_type === t.branch_type && r.enabled,
                            ) ||
                              t.branch_type === form.branch_type),
                        )
                        .map((t) => (
                          <option key={t.branch_type} value={t.branch_type}>
                            {t.label}
                          </option>
                        ))}
                    </select>
                  )}
                </Field>
              )}
              <Field
                label={environment ? "固定绑定 Git 分支" : "固定主干 Git 分支"}
                required
                error={errors.fields.branch}
              >
                {(props) => (
                  <Input
                    {...props}
                    value={form.branch}
                    onChange={(e) => update("branch", e.target.value)}
                  />
                )}
              </Field>
            </div>
            <p className="text-sm text-muted-foreground">
              {rule?.enabled && rule.rule
                ? `当前项目规则：${model.types.find((t) => t.branch_type === form.branch_type)?.label || form.branch_type} · ${rule.rule.mode} · ${rule.rule.pattern}`
                : "项目尚未启用当前 Git 分支类型，请先调整 Git 分支模型。"}
            </p>
            <Field label="说明" error={errors.fields.summary}>
              {(props) => (
                <Textarea
                  {...props}
                  rows={3}
                  value={form.summary}
                  onChange={(e) => update("summary", e.target.value)}
                />
              )}
            </Field>
            <p className="text-sm text-muted-foreground">
              保存配置不会创建远端 Git
              分支；修改产品分支主干也不会修改已有环境。
            </p>
            <Field label="仓库范围" error={errors.fields.repository_scope}>
              {(props) => (
                <ScopeEditor
                  controlProps={props}
                  projectId={projectId}
                  variantId={environment ? variant?.id : value?.id}
                  environment={environment}
                  connections={model.repository_connections || []}
                  value={form.repository_scope}
                  onChange={(scope) => update("repository_scope", scope)}
                  disabled={busy || !writable}
                />
              )}
            </Field>
          </fieldset>
        </form>
      ) : (
        value && (
          <>
            <h3
              ref={heading}
              tabIndex={-1}
              className="text-lg font-medium outline-none"
            >
              {value.name}
            </h3>
            <dl className="grid gap-x-6 gap-y-4 rounded-lg bg-muted/55 p-4 text-sm sm:grid-cols-2">
              {[
                ["编码", value.code],
                [
                  "固定 Git 分支",
                  environment
                    ? (value as Environment).branch_name
                    : (value as Variant).main_branch,
                ],
                [
                  "仓库范围",
                  value.repository_scope.mode === "custom"
                    ? "自定义范围"
                    : environment
                      ? "继承产品分支"
                      : "全部项目仓库",
                ],
                [
                  "配置状态",
                  value.binding_validity === "valid"
                    ? "有效"
                    : reason(value.binding_reason),
                ],
              ].map(([label, text]) => (
                <div key={label}>
                  <dt className="mb-1 text-muted-foreground">{label}</dt>
                  <dd className="break-all">
                    {label === "配置状态" ? (
                      <StatusText
                        tone={
                          value.binding_validity === "valid"
                            ? "success"
                            : "warning"
                        }
                      >
                        {text}
                      </StatusText>
                    ) : (
                      text
                    )}
                  </dd>
                </div>
              ))}
            </dl>
            {value.summary && (
              <p className="whitespace-pre-wrap text-sm">{value.summary}</p>
            )}
            {!writable && (
              <p className="text-sm text-muted-foreground">当前配置只读。</p>
            )}
            <RepositoryBranches
              projectId={projectId}
              variant={environment ? variant! : (value as Variant)}
              environment={environment ? (value as Environment) : undefined}
              allowed={canManage}
            />
          </>
        )
      )}
    </FormDrawer>
  );
}
