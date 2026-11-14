import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { request } from "@/api/client";
import { Button } from "@/components/button";
import { ErrorNotice } from "@/components/feedback";
import { Field, Input, Textarea } from "@/components/fields";
import { Drawer } from "@/components/overlays";
import { SheetClose } from "@/components/ui/sheet";
import { useFormErrors, useSubmission } from "@/hooks/use-form";
import { useUnsaved } from "@/hooks/use-unsaved";
import type {
  Resource,
  ResourceIconValue,
  ResourceKind,
} from "@/types/collaboration";
import { ResourceIconField } from "./resource-icon-field";
import { resourceSchema, type ResourceFormValues } from "./resource-validation";

export function ResourceProfileEditor({
  kind,
  resource,
  separateDescription = false,
  onClose,
  onSaved,
}: {
  kind: ResourceKind;
  resource: Resource;
  separateDescription?: boolean;
  onClose: () => void;
  onSaved: (resource: Resource) => void;
}) {
  const [form, setForm] = useState<ResourceFormValues>({
    name: resource.name,
    code: resource.code,
    summary: resource.summary,
    description: resource.description,
  });
  const [icon, setIcon] = useState<ResourceIconValue>(initialIcon(resource));
  const errors = useFormErrors();
  const submission = useSubmission();
  const queryClient = useQueryClient();
  const initial = {
    name: resource.name,
    code: resource.code,
    summary: resource.summary,
    description: resource.description,
  };
  const dirty =
    JSON.stringify(form) !== JSON.stringify(initial) ||
    JSON.stringify(icon) !== JSON.stringify(initialIcon(resource));
  const markSaved = useUnsaved(dirty, submission.pending);
  const title = `编辑${kind === "projects" ? "项目" : "团队"}`;

  function update(key: keyof ResourceFormValues, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
    errors.change(key);
  }

  function validate() {
    const result = resourceSchema.safeParse(form);
    if (result.success) return true;
    return errors.validate(
      Object.fromEntries(
        result.error.issues.map((issue) => [
          String(issue.path[0]),
          issue.message,
        ]),
      ),
    );
  }

  async function save() {
    if (submission.pending || submission.uncertain || !validate()) return;
    const ok = await submission.run(
      async () => {
        const response = await request<Resource>(`/${kind}/${resource.id}`, {
          method: "PATCH",
          etag: resource.etag,
          body: {
            name: form.name.trim(),
            summary: form.summary,
            ...(separateDescription ? {} : { description: form.description }),
            icon,
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
          {
            "icon.key": "icon_key",
            "icon.file_id": "icon_file_id",
          },
        ),
    );
    if (!ok) return;
  }

  return (
    <Drawer
      open
      wide
      title={title}
      description={`${resource.code} · 编码创建后不可修改`}
      dirty={dirty}
      pending={submission.pending}
      onClose={() => {
        markSaved();
        onClose();
      }}
      footer={
        <>
          <SheetClose
            render={
              <Button variant="outline" disabled={submission.pending}>
                取消
              </Button>
            }
          />
          <Button
            pending={submission.pending}
            disabled={submission.uncertain}
            onClick={() => void save()}
          >
            保存更改
          </Button>
        </>
      }
    >
      <form
        ref={errors.formRef}
        className="mt-5"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <ErrorNotice error={errors.error || submission.error} />
        <fieldset disabled={submission.pending} className="min-w-0">
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
              hint="编码不可修改"
              error={errors.fields.code}
            >
              <Input
                name="code"
                className="mono"
                value={form.code}
                readOnly
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
          {!separateDescription && (
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

function initialIcon(resource: Resource): ResourceIconValue {
  if (resource.icon_file_id)
    return { type: "upload", file_id: resource.icon_file_id };
  if (resource.icon_key) return { type: "builtin", key: resource.icon_key };
  return { type: "default" };
}
