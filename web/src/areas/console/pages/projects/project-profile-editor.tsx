import { useId, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Pencil } from "lucide-react";
import { request } from "@/api/client";
import {
  ConsoleDialog,
  ConsoleDialogCancel,
} from "@/areas/console/components/dialog";
import styles from "@/areas/console/styles/management.module.css";
import { Button } from "@/components/button";
import { ErrorNotice } from "@/components/feedback";
import { Field, Input, Textarea } from "@/components/fields";
import { ResourceIconField } from "@/features/collaboration/resource-icon-field";
import { useFormErrors, useSubmission } from "@/hooks/use-form";
import { useUnsaved } from "@/hooks/use-unsaved";
import type { Resource, ResourceIconValue } from "@/types/collaboration";

export function ProjectProfileEditor({
  project,
  onClose,
  onSaved,
}: {
  project: Resource;
  onClose: () => void;
  onSaved: () => void;
}) {
  const formId = useId();
  const [form, setForm] = useState({
    name: project.name,
    summary: project.summary,
  });
  const [icon, setIcon] = useState<ResourceIconValue>(initialIcon(project));
  const errors = useFormErrors();
  const submission = useSubmission();
  const queryClient = useQueryClient();
  const dirty =
    form.name !== project.name ||
    form.summary !== project.summary ||
    JSON.stringify(icon) !== JSON.stringify(initialIcon(project));
  const markSaved = useUnsaved(dirty, submission.pending);

  function validate() {
    const fields: Record<string, string> = {};
    if (!form.name.trim()) fields.name = "请输入项目名称";
    else if (Array.from(form.name.trim()).length > 100)
      fields.name = "项目名称最多 100 个字符";
    if (Array.from(form.summary).length > 300)
      fields.summary = "摘要最多 300 个字符";
    return errors.validate(fields);
  }

  async function save() {
    if (submission.pending || submission.uncertain || !validate()) return;
    await submission.run(
      async () => {
        await request<Resource>(`/projects/${project.id}`, {
          method: "PATCH",
          etag: project.etag,
          body: { name: form.name.trim(), summary: form.summary, icon },
        });
        markSaved();
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ["project", project.id] }),
          queryClient.invalidateQueries({ queryKey: ["projects"] }),
        ]);
        onSaved();
      },
      (error) =>
        errors.show(error, ["name", "summary"], {
          "icon.key": "icon_key",
          "icon.file_id": "icon_file_id",
        }),
    );
  }

  return (
    <ConsoleDialog
      side="right"
      title="编辑项目资料"
      description={project.name}
      icon={<Pencil />}
      dirty={dirty}
      pending={submission.pending}
      onClose={onClose}
      footer={
        <>
          <ConsoleDialogCancel pending={submission.pending} />
          <Button
            type="submit"
            form={formId}
            pending={submission.pending}
            disabled={submission.uncertain}
          >
            保存更改
          </Button>
        </>
      }
    >
      <form
        id={formId}
        ref={errors.formRef}
        className={`${styles.scope} ${styles.form}`}
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <ErrorNotice error={errors.error || submission.error} />
        <fieldset disabled={submission.pending} className={styles.formSection}>
          <legend>基本资料</legend>
          <div className={styles.formGrid}>
            <Field label="项目名称" required error={errors.fields.name}>
              <Input
                name="name"
                data-console-initial-focus
                value={form.name}
                onChange={(event) => {
                  setForm((current) => ({
                    ...current,
                    name: event.target.value,
                  }));
                  errors.change("name");
                }}
              />
            </Field>
            <Field label="项目编码" hint="创建后不可修改">
              <Input
                name="code"
                className="mono"
                value={project.code}
                readOnly
              />
            </Field>
            <Field
              label="摘要"
              hint="最多 300 个字符"
              className={styles.fullField}
              error={errors.fields.summary}
            >
              <Textarea
                name="summary"
                value={form.summary}
                onChange={(event) => {
                  setForm((current) => ({
                    ...current,
                    summary: event.target.value,
                  }));
                  errors.change("summary");
                }}
              />
            </Field>
            <ResourceIconField
              value={icon}
              onChange={setIcon}
              previewName={form.name || "未命名项目"}
              disabled={submission.pending}
              label="项目图标"
              triggerLabel="更换项目图标"
              triggerText="更换图标"
              popupLabel="选择项目图标"
              popupTitle="选择图标"
            />
          </div>
        </fieldset>
      </form>
    </ConsoleDialog>
  );
}

function initialIcon(resource: Resource): ResourceIconValue {
  if (resource.icon_file_id)
    return { type: "upload", file_id: resource.icon_file_id };
  if (resource.icon_key) return { type: "builtin", key: resource.icon_key };
  return { type: "default" };
}
