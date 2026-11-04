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
  const createProject = kind === "projects" && !resource;
  const [iconExpanded, setIconExpanded] = useState(false);
  const [descriptionExpanded, setDescriptionExpanded] = useState(false);
  const showIcon = !createProject || iconExpanded || !!errors.fields.icon;
  const showDescription =
    !createProject || descriptionExpanded || !!errors.fields.description;
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
      if (descriptionOnly || createProject) setPreview(false);
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
      size={createProject ? "form" : "wide"}
      title={
        descriptionOnly
          ? "编辑项目描述"
          : `${resource ? "编辑" : "创建"}${label}`
      }
      description={
        descriptionOnly
          ? `${resource?.name} · Markdown`
          : createProject
            ? "填写项目信息并指定管理员。"
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
            {busy
              ? createProject
                ? "正在创建…"
                : "正在保存…"
              : createProject
                ? "创建项目"
                : "保存"}
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
              <div
                className={
                  createProject ? "grid gap-5" : "grid gap-5 sm:grid-cols-2"
                }
              >
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
                  label="编码"
                  required
                  error={errors.fields.code}
                  hint={
                    createProject
                      ? "创建后不可修改。2–64 位字母、数字、_ 或 -，首尾为字母或数字，例如 antcdp-web。"
                      : undefined
                  }
                >
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
              {!resource && (
                <Field
                  label="初始管理员"
                  required
                  error={errors.fields.admin_user_ids}
                  hint={
                    createProject
                      ? "至少选择 1 位管理员，最多 100 位；默认已选择你。"
                      : undefined
                  }
                >
                  {(props) => (
                    <OptionPicker
                      controlProps={props}
                      path="/admin/collaboration/user-options"
                      selected={form.admins}
                      onChange={(v) => update("admins", v)}
                      disclosureLabel={createProject ? "添加管理员" : undefined}
                      searchPlaceholder={
                        createProject ? "搜索姓名或用户名" : undefined
                      }
                      multiple
                      disabled={busy}
                    />
                  )}
                </Field>
              )}
              <Field
                label={createProject ? "项目摘要（选填）" : "摘要"}
                error={errors.fields.summary}
                hint={
                  createProject
                    ? `一句话介绍项目 · ${Array.from(form.summary).length}/300`
                    : undefined
                }
              >
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
                {createProject ? (
                  <div className="flex items-center justify-between gap-4 border-t pt-5">
                    <div className="flex items-center gap-3">
                      <ResourceIcon
                        iconKey={form.icon}
                        fileId={form.file || undefined}
                      />
                      <h3 className="text-sm font-medium">
                        项目图标
                        <span className="ml-1 font-normal text-muted-foreground">
                          （选填）
                        </span>
                      </h3>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={processing}
                      aria-expanded={showIcon}
                      aria-invalid={!!errors.fields.icon}
                      aria-describedby={
                        errors.fields.icon ? "project-icon-error" : undefined
                      }
                      aria-controls="project-icon-options"
                      onClick={() => setIconExpanded(!showIcon)}
                    >
                      {showIcon ? "收起选择" : "更换图标"}
                    </Button>
                  </div>
                ) : (
                  <h3 className="text-sm font-medium">图标</h3>
                )}
                <div
                  id={createProject ? "project-icon-options" : undefined}
                  hidden={!showIcon}
                  className="space-y-4"
                >
                  <div
                    className="grid grid-cols-2 gap-2 sm:grid-cols-4"
                    role="group"
                    aria-label="内置图标"
                  >
                    {["", ...iconKeys].map((key) => (
                      <Button
                        key={key}
                        type="button"
                        variant={form.icon === key ? "secondary" : "outline"}
                        className="h-11 justify-start gap-2 px-3"
                        disabled={processing}
                        aria-pressed={form.icon === key}
                        onClick={() => {
                          setForm((f) => ({ ...f, icon: key, file: "" }));
                          setAvatarKey((k) => k + 1);
                        }}
                      >
                        <ResourceIcon
                          navigation
                          iconKey={key}
                          team={kind === "teams"}
                        />
                        {key ? iconLabels[key] : "默认"}
                      </Button>
                    ))}
                  </div>
                  <div className="border-t pt-4">
                    <AvatarEditor
                      compact={createProject}
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
                        form.file === initial.file
                          ? undefined
                          : form.file || null
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
                  </div>
                  <div id={createProject ? "project-icon-error" : undefined}>
                    <ErrorBox>{errors.fields.icon}</ErrorBox>
                  </div>
                </div>
              </section>
            </>
          )}
          {createProject && (
            <Button
              type="button"
              variant="ghost"
              className="h-auto w-full justify-between border-t rounded-none px-0 py-4"
              aria-expanded={showDescription}
              aria-controls="project-description-options"
              onClick={() => setDescriptionExpanded(!showDescription)}
            >
              <span>
                项目描述
                <span className="ml-1 font-normal text-muted-foreground">
                  （选填）
                </span>
              </span>
              <span className="text-[13px] font-normal text-muted-foreground">
                {showDescription
                  ? "收起描述"
                  : form.description
                    ? "已填写 · 展开"
                    : "可创建后补充 · 展开"}
              </span>
            </Button>
          )}
          <div
            id={createProject ? "project-description-options" : undefined}
            hidden={!showDescription}
            className="space-y-4"
          >
            {(descriptionOnly || createProject) && (
              <div
                className="flex gap-1"
                role="group"
                aria-label="描述编辑模式"
              >
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
            {includeDescription &&
              (!(descriptionOnly || createProject) || !preview) && (
                <Field
                  label={descriptionOnly || createProject ? "项目描述" : "简介"}
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
            {includeDescription && !descriptionOnly && !createProject && (
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
                    form.description ||
                    (descriptionOnly
                      ? ""
                      : createProject
                        ? "尚未填写项目描述。"
                        : "尚未填写简介。")
                  }
                />
              </div>
            )}
          </div>
        </fieldset>
      </form>
    </FormDrawer>
  );
}
