import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/app/auth";
import { Button } from "@/components/button";
import { ErrorNotice, Notice } from "@/components/feedback";
import { Field, Input, Textarea } from "@/components/fields";
import { Drawer } from "@/components/overlays";
import { SheetClose } from "@/components/ui/sheet";
import { WizardSteps } from "@/components/wizard";
import { useFormErrors, useSubmission } from "@/hooks/use-form";
import { useUnsaved } from "@/hooks/use-unsaved";
import { request } from "@/api/client";
import type {
  Resource,
  ResourceIconValue,
  ResourceKind,
  UserOption,
} from "@/types/collaboration";
import { ResourceIconField } from "./resource-icon-field";
import { resourceSchema, type ResourceFormValues } from "./resource-validation";
import { ResourceUserPicker } from "./user-picker";

const initialForm: ResourceFormValues = {
  name: "",
  code: "",
  summary: "",
  description: "",
};
const initialIcon: ResourceIconValue = { type: "default" };

export function ResourceCreateEditor({
  kind,
  separateDescription = false,
  onClose,
  onSaved,
}: {
  kind: ResourceKind;
  separateDescription?: boolean;
  onClose: () => void;
  onSaved: (resource: Resource) => void;
}) {
  const session = useSession();
  const wizard = kind === "projects";
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<ResourceFormValues>(initialForm);
  const [icon, setIcon] = useState<ResourceIconValue>(initialIcon);
  const [adminIds, setAdminIds] = useState<string[]>([session.user.id]);
  const [selectedUsers, setSelectedUsers] = useState<UserOption[]>([
    { ...session.user, avatar_url: session.user.avatar?.url },
  ]);
  const errors = useFormErrors();
  const submission = useSubmission();
  const queryClient = useQueryClient();
  const dirty =
    JSON.stringify(form) !== JSON.stringify(initialForm) ||
    JSON.stringify(icon) !== JSON.stringify(initialIcon) ||
    JSON.stringify(adminIds) !== JSON.stringify([session.user.id]);
  const markSaved = useUnsaved(dirty, submission.pending);
  const title = `创建${kind === "projects" ? "项目" : "团队"}`;

  function update(key: keyof ResourceFormValues, value: string) {
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
    if (adminIds.length < 1 || adminIds.length > 100)
      return errors.validate({ admin_user_ids: "请选择 1–100 位初始管理员" });
    return true;
  }

  async function save() {
    if (submission.pending || submission.uncertain || !validate()) return;
    const ok = await submission.run(
      async () => {
        const response = await request<Resource>(`/${kind}`, {
          method: "POST",
          body: {
            ...form,
            ...(separateDescription ? { description: "" } : {}),
            name: form.name.trim(),
            icon,
            admin_user_ids: adminIds,
          },
        });
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

  return (
    <Drawer
      open
      wide
      title={title}
      description={
        kind === "teams"
          ? "填写团队资料并选择初始管理员。简介和图标可稍后补充。"
          : "按步骤填写资料并选择初始管理员，返回不会清空内容。"
      }
      dirty={dirty}
      pending={submission.pending}
      onClose={() => {
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
          <SheetClose
            render={
              <Button variant="outline" disabled={submission.pending}>
                取消
              </Button>
            }
          />
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
              {title}
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
        <ErrorNotice error={errors.error || submission.error} />
        <fieldset disabled={submission.pending} className="min-w-0">
          {(!wizard || step === 0) && (
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
                hint="创建后不可修改"
                error={errors.fields.code}
              >
                <Input
                  name="code"
                  className="mono"
                  value={form.code}
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
              <ResourceIconField
                value={icon}
                onChange={setIcon}
                previewName={form.name}
                disabled={submission.pending}
              />
            </div>
          )}
          {(!wizard || step === 1) && (
            <div className="mt-6 grid gap-5">
              <section>
                <p className="mb-3 text-xs text-muted">
                  至少选择 1 位，最多 100 位；不会自动加入其他创建者。
                </p>
                <ResourceUserPicker
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
              )}
              {kind === "projects" && (
                <Notice>
                  创建只写入本地资料与成员关系，不会自动关联仓库或创建远端 Git
                  分支。
                </Notice>
              )}
            </div>
          )}
        </fieldset>
      </form>
    </Drawer>
  );
}
