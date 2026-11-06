import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { X } from "lucide-react";
import { request } from "@/api/client";
import { useSession } from "@/app/auth";
import { Button } from "@/components/button";
import { ErrorNotice, Notice } from "@/components/feedback";
import { Field, Input, StandaloneInput, Textarea } from "@/components/fields";
import { ImageEditor, type ImageValue } from "@/components/image-editor";
import { Drawer } from "@/components/overlays";
import { SheetClose } from "@/components/ui/sheet";
import { iconLabels, ResourceIcon } from "@/components/resource-icon";
import { WizardSteps } from "@/components/wizard";
import { useApiQuery } from "@/hooks/use-api";
import { useFormErrors, useSubmission } from "@/hooks/use-form";
import { useUnsaved } from "@/hooks/use-unsaved";
import type {
  Resource,
  ResourceIconValue,
  ResourceKind,
  UserOption,
} from "@/types/collaboration";

const resourceSchema = z.object({
  name: z.string().trim().min(1, "请输入名称").max(100, "名称最多 100 个字符"),
  code: z
    .string()
    .regex(
      /^[A-Za-z0-9][A-Za-z0-9_-]{0,62}[A-Za-z0-9]$/,
      "2–64 位 ASCII 字母、数字、_ 或 -，首尾为字母或数字",
    ),
  summary: z.string().max(300, "摘要最多 300 个字符"),
  description: z
    .string()
    .refine(
      (value) => new TextEncoder().encode(value).length <= 100 * 1024,
      "简介不能超过 100 KiB",
    ),
});

export function ResourceEditor({
  kind,
  resource,
  onClose,
  onSaved,
}: {
  kind: ResourceKind;
  resource?: Resource;
  onClose: () => void;
  onSaved: (resource: Resource) => void;
}) {
  const session = useSession();
  const create = !resource;
  const [step, setStep] = useState(0);
  const [form, setForm] = useState({
    name: resource?.name ?? "",
    code: resource?.code ?? "",
    summary: resource?.summary ?? "",
    description: resource?.description ?? "",
  });
  const [icon, setIcon] = useState<ResourceIconValue>(
    resource?.icon_file_id
      ? { type: "upload", file_id: resource.icon_file_id }
      : resource?.icon_key
        ? { type: "builtin", key: resource.icon_key }
        : { type: "default" },
  );
  const [image, setImage] = useState<ImageValue | null | undefined>(undefined);
  const [adminIds, setAdminIds] = useState<string[]>([session.user.id]);
  const [userSearch, setUserSearch] = useState("");
  const [userQuery, setUserQuery] = useState("");
  const errors = useFormErrors();
  const submission = useSubmission();
  const queryClient = useQueryClient();
  const icons = useApiQuery<string[]>(["icon-catalog"], "/icon-catalog");
  const users = useApiQuery<UserOption[]>(
    ["resource-admin-options", userQuery],
    `/admin/collaboration/user-options?q=${encodeURIComponent(userQuery)}`,
    {
      enabled: (create && kind === "projects") || (create && kind === "teams"),
    },
  );
  const initial = {
    name: resource?.name ?? "",
    code: resource?.code ?? "",
    summary: resource?.summary ?? "",
    description: resource?.description ?? "",
  };
  const initialIcon = resource?.icon_file_id
    ? { type: "upload", file_id: resource.icon_file_id }
    : resource?.icon_key
      ? { type: "builtin", key: resource.icon_key }
      : { type: "default" };
  const dirty =
    JSON.stringify(form) !== JSON.stringify(initial) ||
    JSON.stringify(icon) !== JSON.stringify(initialIcon) ||
    (create && JSON.stringify(adminIds) !== JSON.stringify([session.user.id]));
  const markSaved = useUnsaved(dirty, submission.pending);
  const selectedUsers = useMemo(() => {
    const options = users.data?.data ?? [];
    return adminIds
      .map(
        (id) =>
          options.find((user) => user.id === id) ??
          (id === session.user.id
            ? {
                id,
                username: session.user.username,
                display_name: session.user.display_name,
              }
            : undefined),
      )
      .filter((user) => user !== undefined);
  }, [adminIds, users.data, session.user]);
  const title = `${create ? "创建" : "编辑"}${kind === "projects" ? "项目" : "团队"}`;
  function update(key: keyof typeof form, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
    errors.change(key);
  }
  function validate() {
    const result = resourceSchema.safeParse(form);
    if (!result.success) {
      return errors.validate(
        Object.fromEntries(
          result.error.issues.map((issue) => [
            String(issue.path[0]),
            issue.message,
          ]),
        ),
      );
    }
    if (create && (adminIds.length < 1 || adminIds.length > 100))
      return errors.validate({ admin_user_ids: "请选择 1–100 位初始管理员" });
    return true;
  }
  async function save() {
    if (!validate()) return;
    const ok = await submission.run(
      async () => {
        const payload = create
          ? { ...form, name: form.name.trim(), icon, admin_user_ids: adminIds }
          : {
              name: form.name.trim(),
              summary: form.summary,
              description: form.description,
              icon,
            };
        const response = await request<Resource>(
          create ? `/${kind}` : `/${kind}/${resource.id}`,
          {
            method: create ? "POST" : "PATCH",
            ...(create ? {} : { etag: resource.etag }),
            body: payload,
          },
        );
        await queryClient.invalidateQueries({ queryKey: [kind] });
        await queryClient.invalidateQueries({ queryKey: ["shortcuts"] });
        markSaved();
        onSaved(response.data);
      },
      (error) =>
        errors.show(
          error,
          ["name", "code", "summary", "description", "admin_user_ids"],
          { "icon.key": "icon_key", "icon.file_id": "icon_file_id" },
        ),
    );
    if (!ok) return;
  }
  const resourcePreview = {
    name: form.name || "未命名",
    icon_key: icon.type === "builtin" ? icon.key : null,
    icon_file_id: icon.type === "upload" ? icon.file_id : null,
  };
  return (
    <Drawer
      open
      wide
      title={title}
      description={
        create
          ? "按步骤填写资料并选择初始管理员，返回不会清空内容。"
          : `${resource.code} · 编码创建后不可修改`
      }
      dirty={dirty}
      pending={submission.pending}
      onClose={() => {
        // Closing has already passed the panel's pending/dirty checks. Release
        // this form's guard before the parent removes its create URL parameter.
        markSaved();
        onClose();
      }}
      footer={
        <>
          {create && step > 0 && (
            <Button variant="outline" onClick={() => setStep(0)}>
              上一步
            </Button>
          )}
          <SheetClose asChild>
            <Button variant="outline" disabled={submission.pending}>
              取消
            </Button>
          </SheetClose>
          {create && step === 0 ? (
            <Button
              onClick={() => {
                if (validate()) setStep(1);
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
              {create ? title : "保存更改"}
            </Button>
          )}
        </>
      }
    >
      {create && (
        <WizardSteps steps={["基本资料", "管理员与简介"]} current={step} />
      )}
      <form
        ref={errors.formRef}
        className="mt-5"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (create && step === 0) {
            if (validate()) setStep(1);
          } else void save();
        }}
      >
        <ErrorNotice error={errors.error} />
        <ErrorNotice error={submission.error} />
        {(!create || step === 0) && (
          <div className="form-grid">
            <Field
              label={kind === "projects" ? "项目名称" : "团队名称"}
              required
              error={errors.fields.name}
            >
              <Input
                name="name"
                value={form.name}
                onChange={(event) => update("name", event.target.value)}
              />
            </Field>
            <Field
              label="编码"
              required
              hint={create ? "创建后不可修改" : "编码不可修改"}
              error={errors.fields.code}
            >
              <Input
                name="code"
                className="mono"
                value={form.code}
                readOnly={!create}
                onChange={(event) => update("code", event.target.value)}
              />
            </Field>
            <Field
              label="摘要"
              hint="最多 300 个字符"
              error={errors.fields.summary}
              className="form-full"
            >
              <Textarea
                name="summary"
                value={form.summary}
                onChange={(event) => update("summary", event.target.value)}
              />
            </Field>
            <div className="form-full">
              <span className="mb-2 block text-xs font-medium text-text-soft">
                图标
              </span>
              <div className="flex flex-wrap items-center gap-3">
                <ResourceIcon resource={resourcePreview} className="size-12" />
                <ImageEditor
                  kind="icon"
                  current={
                    resource?.icon_file_id
                      ? `/api/v1/icons/${resource.icon_file_id}`
                      : undefined
                  }
                  value={image}
                  disabled={submission.pending}
                  onChange={(value) => {
                    setImage(value);
                    setIcon(
                      value
                        ? { type: "upload", file_id: value.id }
                        : { type: "default" },
                    );
                  }}
                />
              </div>
              <div className="mt-3 grid grid-cols-4 gap-2">
                {(icons.data?.data ?? Object.keys(iconLabels)).map((key) => (
                  <button
                    type="button"
                    key={key}
                    aria-pressed={icon.type === "builtin" && icon.key === key}
                    className={`grid justify-items-center gap-1 rounded-lg border p-2 text-[11px] ${icon.type === "builtin" && icon.key === key ? "border-primary bg-accent-soft text-primary" : "hover:bg-surface-hover"}`}
                    onClick={() => {
                      setIcon({ type: "builtin", key });
                      setImage(undefined);
                    }}
                  >
                    <ResourceIcon
                      resource={{
                        name: iconLabels[key as keyof typeof iconLabels] ?? key,
                        icon_key: key,
                        icon_file_id: null,
                      }}
                      className="size-8"
                    />
                    {iconLabels[key as keyof typeof iconLabels] ?? key}
                  </button>
                ))}
              </div>
              <Button
                className="mt-2"
                size="sm"
                variant="ghost"
                onClick={() => {
                  setIcon({ type: "default" });
                  setImage(null);
                }}
              >
                使用默认图标
              </Button>
            </div>
          </div>
        )}
        {create && step === 1 && (
          <div className="grid gap-5">
            <section>
              <h3 className="mb-2 text-sm font-medium">
                初始管理员 · {adminIds.length}
              </h3>
              <p className="mb-3 text-xs text-muted">
                至少选择 1 位，最多 100 位；不会自动加入其他创建者。
              </p>
              <div className="mb-3 flex flex-wrap gap-2">
                {selectedUsers.map((user) => (
                  <span
                    key={user.id}
                    className="inline-flex items-center gap-2 rounded-md bg-accent-soft px-2 py-1 text-xs"
                  >
                    {user.display_name} @{user.username}
                    <button
                      type="button"
                      aria-label={`移除 ${user.display_name}`}
                      disabled={adminIds.length === 1}
                      onClick={() =>
                        setAdminIds(adminIds.filter((id) => id !== user.id))
                      }
                    >
                      <X className="size-3" />
                    </button>
                  </span>
                ))}
              </div>
              <div className="mb-2 flex gap-2">
                <StandaloneInput
                  aria-label="搜索初始管理员"
                  placeholder="搜索用户名或显示名称"
                  value={userSearch}
                  onChange={(event) => setUserSearch(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      setUserQuery(userSearch.trim());
                    }
                  }}
                />
                <Button
                  variant="outline"
                  onClick={() => setUserQuery(userSearch.trim())}
                >
                  搜索
                </Button>
              </div>
              <div className="max-h-56 overflow-y-auto rounded-lg border">
                {users.data?.data.map((user) => (
                  <label
                    key={user.id}
                    className="flex items-center gap-3 border-b px-3 py-2 last:border-0"
                  >
                    <input
                      type="checkbox"
                      checked={adminIds.includes(user.id)}
                      onChange={(event) =>
                        setAdminIds(
                          event.target.checked
                            ? [...adminIds, user.id]
                            : adminIds.filter((id) => id !== user.id),
                        )
                      }
                    />
                    <span>
                      {user.display_name}
                      <small className="ml-2 text-muted">
                        @{user.username}
                      </small>
                    </span>
                  </label>
                ))}
              </div>
              {errors.fields.admin_user_ids && (
                <p className="mt-1 text-xs text-danger">
                  {errors.fields.admin_user_ids}
                </p>
              )}
            </section>
            <Field
              label="简介"
              hint="支持 Markdown；不超过 100 KiB UTF-8"
              error={errors.fields.description}
            >
              <Textarea
                name="description"
                className="min-h-40 font-mono"
                value={form.description}
                onChange={(event) => update("description", event.target.value)}
              />
            </Field>
            <Notice>
              创建只写入本地资料与成员关系，不会自动关联仓库或创建远端 Git
              分支。
            </Notice>
          </div>
        )}
        {!create && (
          <Field
            label="项目简介"
            error={errors.fields.description}
            className="mt-5"
          >
            <Textarea
              name="description"
              className="min-h-40 font-mono"
              value={form.description}
              onChange={(event) => update("description", event.target.value)}
            />
          </Field>
        )}
      </form>
    </Drawer>
  );
}
