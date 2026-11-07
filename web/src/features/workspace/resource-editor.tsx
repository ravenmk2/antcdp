import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { Check } from "lucide-react";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import { WorkspaceUserPicker } from "./user-picker";
import { request } from "@/api/client";
import { useSession } from "@/app/auth";
import { Button } from "@/components/button";
import { ErrorNotice, Notice } from "@/components/feedback";
import { Field, Input, Textarea } from "@/components/fields";
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
  separateDescription = false,
  onClose,
  onSaved,
}: {
  kind: ResourceKind;
  resource?: Resource;
  separateDescription?: boolean;
  onClose: () => void;
  onSaved: (resource: Resource) => void;
}) {
  const session = useSession();
  const create = !resource;
  const wizard = create && kind === "projects";
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
  const [selectedUsers, setSelectedUsers] = useState<UserOption[]>([
    { ...session.user, avatar_url: session.user.avatar?.url },
  ]);
  const [iconOpen, setIconOpen] = useState(false);
  const [cropOpen, setCropOpen] = useState(false);
  const errors = useFormErrors();
  const submission = useSubmission();
  const queryClient = useQueryClient();
  const icons = useApiQuery<string[]>(["icon-catalog"], "/icon-catalog");
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
    if (submission.pending || submission.uncertain || !validate()) return;
    const ok = await submission.run(
      async () => {
        const payload = create
          ? {
              ...form,
              ...(separateDescription ? { description: "" } : {}),
              name: form.name.trim(),
              icon,
              admin_user_ids: adminIds,
            }
          : {
              name: form.name.trim(),
              summary: form.summary,
              ...(separateDescription ? {} : { description: form.description }),
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
          ? kind === "teams"
            ? "填写团队资料并选择初始管理员。简介和图标可稍后补充。"
            : "按步骤填写资料并选择初始管理员，返回不会清空内容。"
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
          {wizard && step > 0 && (
            <Button variant="outline" onClick={() => setStep(0)}>
              上一步
            </Button>
          )}
          <SheetClose asChild>
            <Button variant="outline" disabled={submission.pending}>
              取消
            </Button>
          </SheetClose>
          {wizard && step === 0 ? (
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
      {wizard && (
        <WizardSteps steps={["基本资料", "管理员与简介"]} current={step} />
      )}
      <form
        ref={errors.formRef}
        className="mt-5"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (wizard && step === 0) {
            if (validate()) setStep(1);
          } else void save();
        }}
      >
        <ErrorNotice error={errors.error} />
        <ErrorNotice error={submission.error} />
        <fieldset disabled={submission.pending} className="min-w-0">
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
                <Popover
                  open={iconOpen}
                  onOpenChange={(open) => {
                    if (!cropOpen) setIconOpen(open);
                  }}
                >
                  <PopoverTrigger asChild>
                    <Button
                      variant="ghost"
                      className="h-auto gap-3 p-1"
                      disabled={submission.pending}
                      aria-label="更换图标"
                    >
                      <ResourceIcon
                        resource={resourcePreview}
                        className="size-12"
                      />
                      <span className="text-sm text-foreground">更换图标</span>
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent
                    align="start"
                    className="w-80"
                    aria-label="选择图标"
                    onInteractOutside={(event) => {
                      if (cropOpen) event.preventDefault();
                    }}
                  >
                    <p className="mb-3 text-sm font-medium">选择图标</p>
                    <div className="grid grid-cols-4 gap-2">
                      {(icons.data?.data ?? Object.keys(iconLabels)).map(
                        (key) => {
                          const selected =
                            icon.type === "builtin" && icon.key === key;
                          return (
                            <button
                              key={key}
                              type="button"
                              aria-pressed={selected}
                              className={`relative grid justify-items-center gap-1 rounded-lg border px-1 py-2 text-xs hover:bg-surface-hover ${selected ? "border-primary bg-accent-soft text-primary" : "border-transparent"}`}
                              onClick={() => {
                                setIcon({ type: "builtin", key });
                                setImage(null);
                                setIconOpen(false);
                              }}
                            >
                              <ResourceIcon
                                resource={{
                                  name:
                                    iconLabels[
                                      key as keyof typeof iconLabels
                                    ] ?? key,
                                  icon_key: key,
                                  icon_file_id: null,
                                }}
                                className="size-8"
                              />
                              <span className="text-foreground">
                                {iconLabels[key as keyof typeof iconLabels] ??
                                  key}
                              </span>
                              {selected && (
                                <Check
                                  className="absolute right-1 top-1 size-3"
                                  aria-hidden
                                />
                              )}
                            </button>
                          );
                        },
                      )}
                    </div>
                    <div className="mt-3 flex items-center justify-between gap-2 border-t pt-3">
                      <ImageEditor
                        kind="icon"
                        value={image}
                        compact
                        onEditingChange={setCropOpen}
                        disabled={submission.pending}
                        onChange={(value) => {
                          if (value) {
                            setImage(value);
                            setIcon({ type: "upload", file_id: value.id });
                            setIconOpen(false);
                          }
                        }}
                      />
                      {icon.type !== "default" && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setIcon({ type: "default" });
                            setImage(null);
                            setIconOpen(false);
                          }}
                        >
                          恢复默认
                        </Button>
                      )}
                    </div>
                  </PopoverContent>
                </Popover>
              </div>
            </div>
          )}
          {create && (!wizard || step === 1) && (
            <div className="mt-6 grid gap-5">
              <section>
                <p className="mb-3 text-xs text-muted">
                  至少选择 1 位，最多 100 位；不会自动加入其他创建者。
                </p>
                <WorkspaceUserPicker
                  label="初始管理员"
                  name="admin_user_ids"
                  endpoint="/admin/collaboration/user-options"
                  multiple
                  min={1}
                  max={100}
                  value={selectedUsers}
                  disabled={submission.pending}
                  error={errors.fields.admin_user_ids}
                  onChange={(users) => {
                    setSelectedUsers(users);
                    setAdminIds(users.map((user) => user.id));
                    errors.change("admin_user_ids");
                  }}
                />
              </section>
              {!separateDescription && (
                <>
                  <Field
                    label="简介"
                    hint="支持 Markdown；不超过 100 KiB UTF-8"
                    error={errors.fields.description}
                  >
                    <Textarea
                      name="description"
                      className="min-h-40 font-mono"
                      value={form.description}
                      onChange={(event) =>
                        update("description", event.target.value)
                      }
                    />
                  </Field>
                </>
              )}
              {kind === "projects" && (
                <Notice>
                  创建只写入本地资料与成员关系，不会自动关联仓库或创建远端 Git
                  分支。
                </Notice>
              )}
            </div>
          )}
          {!create && !separateDescription && (
            <Field
              label={kind === "teams" ? "团队简介" : "项目简介"}
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
        </fieldset>
      </form>
    </Drawer>
  );
}
