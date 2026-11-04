import { useRef, useState } from "react";
import {
  iconKeys,
  iconLabels,
  type Kind,
  type Resource,
  type Option,
} from "@/shared/collaboration";
import { useIdentity } from "@/app/identity";
import { request, ApiError } from "@/lib/api";
import { writeRequiresReview, writeReviewMessage } from "@/lib/write-error";
import { FormDrawer } from "@/components/platform/form-drawer";
import { Field } from "@/components/platform/field";
import { useFormErrors } from "@/components/platform/use-form-errors";
import { ErrorBox } from "@/components/platform/feedback";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { AvatarEditor, type AvatarHandle } from "@/features/media/AvatarEditor";
import { ResourceIcon } from "./ResourceIcon";
import { OptionPicker } from "./OptionPicker";
import { Markdown } from "./Markdown";
export function ResourceEditor({
  kind,
  resource: current,
  descriptionOnly = false,
  onClose,
  onSaved,
}: {
  kind: Kind;
  resource?: Resource;
  descriptionOnly?: boolean;
  onClose: () => void;
  onSaved: (value: Resource) => void;
}) {
  const { session } = useIdentity();
  const [resource] = useState(current);
  const initial = {
    code: resource?.code || "",
    name: resource?.name || "",
    summary: resource?.summary || "",
    description: resource?.description || "",
    icon: resource?.icon_file_id ? "upload" : resource?.icon_key || "",
    file: resource?.icon_file_id || "",
    admins: resource
      ? []
      : ([
          {
            id: session.user.id,
            display_name: session.user.display_name,
            username: session.user.username,
          },
        ] as Option[]),
  };
  const [form, setForm] = useState(initial),
    [preview, setPreview] = useState(false),
    [busy, setBusy] = useState(false),
    [blocked, setBlocked] = useState(false),
    [processing, setProcessing] = useState(false),
    [avatarKey, setAvatarKey] = useState(0);
  const icon = useRef<AvatarHandle>(null),
    locked = useRef(false),
    errors = useFormErrors();
  const label = kind === "projects" ? "项目" : "团队",
    allowed = current
      ? current.can_manage && current.status === "active"
      : session.user.role === "admin";
  const includeDescription = descriptionOnly || !resource || kind === "teams";
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  function update<K extends keyof typeof form>(
    key: K,
    value: (typeof form)[K],
  ) {
    setForm((f) => ({ ...f, [key]: value }));
    errors.setFields((f) => ({
      ...f,
      [key === "admins" ? "admin_user_ids" : key]: "",
    }));
  }
  async function save() {
    if (locked.current || processing || !allowed || blocked) return;
    errors.clear();
    const fields: Record<string, string> = {};
    if (
      !resource &&
      !/^[A-Za-z0-9][A-Za-z0-9_-]{0,62}[A-Za-z0-9]$/.test(form.code)
    )
      fields.code =
        "编码须为 2–64 位字母、数字、下划线或连字符，首尾为字母或数字。";
    if (
      !descriptionOnly &&
      (!form.name.trim() || Array.from(form.name.trim()).length > 100)
    )
      fields.name = "名称须为 1–100 个字符。";
    if (!descriptionOnly && Array.from(form.summary).length > 300)
      fields.summary = "摘要最多 300 个字符。";
    if (
      includeDescription &&
      new TextEncoder().encode(form.description).length > 102400
    )
      fields.description = "Markdown 内容不能超过 100 KiB。";
    if (!resource && !form.admins.length)
      fields.admin_user_ids = "请至少选择一位初始管理员。";
    if (!errors.validate(fields)) {
      if (fields.description) setPreview(false);
      return;
    }
    if (resource && !resource.etag) {
      errors.setError("版本信息缺失，请重新打开。");
      return;
    }
    locked.current = true;
    setBusy(true);
    try {
      const result = await request<Resource>(
        `/${kind}${resource ? `/${resource.id}` : ""}`,
        {
          method: resource ? "PATCH" : "POST",
          etag: resource?.etag,
          body: descriptionOnly
            ? { description: form.description }
            : {
                name: form.name,
                summary: form.summary,
                ...(includeDescription
                  ? { description: form.description }
                  : {}),
                icon:
                  form.icon === "upload"
                    ? { type: "upload", file_id: form.file }
                    : form.icon
                      ? { type: "builtin", key: form.icon }
                      : { type: "default" },
                ...(!resource
                  ? {
                      code: form.code,
                      admin_user_ids: form.admins.map((a) => a.id),
                    }
                  : {}),
              },
        },
      );
      icon.current?.saved();
      onSaved(result.data);
    } catch (e) {
      if (descriptionOnly) setPreview(false);
      errors.show(e, [
        "name",
        "code",
        "summary",
        "description",
        "admin_user_ids",
        "icon",
      ]);
      if (
        e instanceof ApiError &&
        ["CODE_CONFLICT", "NAME_CONFLICT"].includes(e.code)
      ) {
        errors.validate({
          [e.code === "CODE_CONFLICT" ? "code" : "name"]: e.message,
        });
      }
      setBlocked(writeRequiresReview(e));
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  return (
    <FormDrawer
      title={
        descriptionOnly
          ? "编辑项目描述"
          : `${resource ? "编辑" : "创建"}${label}`
      }
      description={
        descriptionOnly
          ? `${resource?.name} · Markdown`
          : includeDescription
            ? "设置名称、摘要、图标与简介。"
            : "设置项目名称、摘要与图标。"
      }
      dirty={dirty}
      pending={busy || processing}
      onClose={onClose}
      footer={(close) => (
        <>
          <Button
            variant="outline"
            disabled={busy || processing}
            onClick={() => close()}
          >
            取消
          </Button>
          <Button
            type="submit"
            form="resource-editor"
            disabled={busy || processing || blocked || !allowed}
          >
            {busy ? "正在保存…" : "保存"}
          </Button>
        </>
      )}
    >
      <form
        id="resource-editor"
        ref={errors.formRef}
        className="space-y-6"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <ErrorBox>{errors.error}</ErrorBox>
        {blocked && (
          <p role="alert" className="text-sm">
            {writeReviewMessage}
            {!resource && "创建结果未知时，请按编码查询核实，勿重复创建。"}
          </p>
        )}
        <fieldset className="space-y-6" disabled={busy || !allowed}>
          {!descriptionOnly && (
            <>
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
                <Field label="编码" required error={errors.fields.code}>
                  {(props) => (
                    <Input
                      {...props}
                      disabled={!!resource || busy}
                      value={form.code}
                      onChange={(e) => update("code", e.target.value)}
                    />
                  )}
                </Field>
              </div>
              <Field label="摘要" error={errors.fields.summary}>
                {(props) => (
                  <Textarea
                    {...props}
                    rows={2}
                    value={form.summary}
                    onChange={(e) => update("summary", e.target.value)}
                  />
                )}
              </Field>
              <section className="space-y-4" aria-label={`${label}图标`}>
                <h3 className="text-sm font-medium">图标</h3>
                <div className="flex flex-wrap gap-2">
                  {["", ...iconKeys].map((key) => (
                    <Button
                      key={key}
                      type="button"
                      variant={form.icon === key ? "secondary" : "outline"}
                      size="sm"
                      aria-pressed={form.icon === key}
                      onClick={() => {
                        setForm((f) => ({ ...f, icon: key, file: "" }));
                        setAvatarKey((k) => k + 1);
                      }}
                    >
                      <ResourceIcon iconKey={key} team={kind === "teams"} />
                      {key ? iconLabels[key] : "默认"}
                    </Button>
                  ))}
                </div>
                <AvatarEditor
                  key={avatarKey}
                  label="图标"
                  placeholder={
                    <ResourceIcon
                      large
                      iconKey={form.icon}
                      team={kind === "teams"}
                    />
                  }
                  uploadPath="/icon-uploads"
                  value={
                    form.file === initial.file ? undefined : form.file || null
                  }
                  ref={icon}
                  avatar={
                    form.icon === "upload" && form.file
                      ? { url: `/api/v1/icons/${form.file}` }
                      : null
                  }
                  disabled={busy || !allowed}
                  onProcessing={setProcessing}
                  onChange={(id) =>
                    setForm((f) => ({
                      ...f,
                      icon: id ? "upload" : "",
                      file: id || "",
                    }))
                  }
                />
                <ErrorBox>{errors.fields.icon}</ErrorBox>
              </section>
              {!resource && (
                <Field
                  label="初始管理员"
                  required
                  error={errors.fields.admin_user_ids}
                >
                  {(props) => (
                    <OptionPicker
                      controlProps={props}
                      path="/admin/collaboration/user-options"
                      selected={form.admins}
                      onChange={(v) => update("admins", v)}
                      multiple
                      disabled={busy}
                    />
                  )}
                </Field>
              )}
            </>
          )}
          {descriptionOnly && (
            <div className="flex gap-1" role="group" aria-label="描述编辑模式">
              <Button
                size="sm"
                type="button"
                variant={preview ? "ghost" : "secondary"}
                aria-pressed={!preview}
                onClick={() => setPreview(false)}
              >
                编辑
              </Button>
              <Button
                size="sm"
                type="button"
                variant={preview ? "secondary" : "ghost"}
                aria-pressed={preview}
                onClick={() => setPreview(true)}
              >
                预览
              </Button>
            </div>
          )}
          {includeDescription && (!descriptionOnly || !preview) && (
            <Field
              label={descriptionOnly ? "项目描述" : "简介"}
              error={errors.fields.description}
              hint="支持 Markdown，不支持 HTML 或嵌入图片。"
            >
              {(props) => (
                <Textarea
                  {...props}
                  rows={descriptionOnly ? 16 : 8}
                  value={form.description}
                  onChange={(e) => update("description", e.target.value)}
                />
              )}
            </Field>
          )}
          {includeDescription && !descriptionOnly && (
            <Button
              type="button"
              variant="outline"
              aria-expanded={preview}
              onClick={() => setPreview((v) => !v)}
            >
              {preview ? "收起预览" : "预览简介"}
            </Button>
          )}
          {preview && (
            <div className="rounded-lg border p-5">
              <Markdown
                text={
                  form.description || (descriptionOnly ? "" : "尚未填写简介。")
                }
              />
            </div>
          )}
        </fieldset>
      </form>
    </FormDrawer>
  );
}
