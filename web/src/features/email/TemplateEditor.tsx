import { useOperationToast } from "@/components/platform/operation-toast";
import { useEffect, useState } from "react";
import type { EmailTemplate } from "@/shared/email";
import { request } from "@/lib/api";
import { jsonObject, usePreview } from "@/lib/preview";
import { writeReviewMessage } from "@/lib/write-error";
import { useSubmission } from "@/components/platform/use-submission";
import { useFormErrors } from "@/components/platform/use-form-errors";
import { useNavigationProtection } from "@/components/platform/navigation-guard";
import {
  TextControl,
  AreaControl,
  ChoiceControl,
} from "@/components/platform/form-controls";
import { ErrorBox } from "@/components/platform/feedback";
import { Button } from "@/components/ui/button";
function draft(t?: EmailTemplate) {
  return {
    code: t?.code || "",
    name: t?.name || "",
    description: t?.description || "",
    enabled: t?.enabled ?? true,
    engine_id: t?.engine_id || "go_template",
    engine_version: t?.engine_version || 1,
    subject_template: t?.subject_template ?? "{{.title}}",
    body_format: t?.body_format || "text",
    body_template: t?.body_template ?? "你好，{{.name}}。",
    text_body_template: t?.text_body_template || "",
    schema: JSON.stringify(
      t?.parameter_schema || {
        name: { type: "string", required: true },
        title: { type: "string", required: true },
      },
      null,
      2,
    ),
    sample: JSON.stringify(
      t?.sample_data || { name: "同事", title: "项目更新" },
      null,
      2,
    ),
  };
}
export const previewDocument = (html: string) =>
  "<!doctype html><html><head><meta charset=\"utf-8\"><meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; style-src 'unsafe-inline'; img-src data:; form-action 'none'; base-uri 'none'\"></head><body>" +
  html +
  "</body></html>";
export function TemplateEditor({
  template,
  tag,
  onSaved,
  onCancel,
  onDirty,
}: {
  template?: EmailTemplate;
  tag?: string;
  onSaved: (t: EmailTemplate) => void;
  onCancel?: () => void;
  onDirty: (dirty: boolean) => void;
}) {
  const [baseline, setBaseline] = useState(() => draft(template)),
    [d, set] = useState(baseline),
    [version, setVersion] = useState(tag),
    notify = useOperationToast();
  const errors = useFormErrors(),
    save = useSubmission(),
    dirty = JSON.stringify(baseline) !== JSON.stringify(d);
  useEffect(() => onDirty(dirty), [dirty, onDirty]);
  useNavigationProtection(
    save.pending ? "pending" : dirty ? "dirty" : undefined,
  );
  const { schema, sample, ...meta } = d;
  let body:
    | (typeof meta & {
        parameter_schema: Record<string, unknown>;
        sample_data: Record<string, unknown>;
      })
    | undefined;
  const invalid: Record<string, string> = {};
  let schemaValue = {},
    sampleValue = {};
  try {
    schemaValue = jsonObject(schema);
  } catch {
    invalid.schema = "参数定义必须为有效 JSON 对象。";
  }
  try {
    sampleValue = jsonObject(sample);
  } catch {
    invalid.sample = "样例数据必须为有效 JSON 对象。";
  }
  if (!Object.keys(invalid).length)
    body = { ...meta, parameter_schema: schemaValue, sample_data: sampleValue };
  const preview = usePreview<{
    subject: string;
    body: string;
    body_format: string;
    text_body: string;
  }>(
    "/admin/email/templates/preview",
    body ? JSON.stringify({ draft: body }) : null,
    !!template,
  );
  const control = (
    key: Exclude<keyof typeof d, "enabled" | "engine_version">,
  ) => ({
    value: d[key],
    onValue: (v: string) => set((old) => ({ ...old, [key]: v })),
    error: errors.fields[key],
  });
  async function persist() {
    errors.clear();
    if (
      !errors.validate({
        ...invalid,
        name: d.name.trim() ? "" : "请输入模板名称。",
        subject_template: d.subject_template.trim() ? "" : "请输入主题模板。",
        body_template: d.body_template.trim() ? "" : "请输入正文模板。",
      })
    )
      return;
    await save.submit(
      async () => {
        const r = await request<EmailTemplate>(
          "/admin/email/templates" + (template ? "/" + template.id : ""),
          { method: template ? "PATCH" : "POST", etag: version, body },
        );
        const saved = draft(r.data);
        setBaseline(saved);
        set(saved);
        setVersion(r.etag);
        notify("模板已保存。");
        onSaved(r.data);
      },
      (e) =>
        errors.show(
          e,
          [
            "code",
            "name",
            "subject_template",
            "body_template",
            "schema",
            "sample",
          ],
          { parameter_schema: "schema", sample_data: "sample" },
        ),
    );
  }
  return (
    <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
      <form
        ref={errors.formRef}
        noValidate
        className="space-y-5 rounded-xl border bg-card p-5"
        onSubmit={(e) => {
          e.preventDefault();
          void persist();
        }}
      >
        <ErrorBox>{errors.error}</ErrorBox>
        {save.blocked && <p role="alert">{writeReviewMessage}</p>}

        <fieldset className="space-y-4" disabled={save.pending || save.blocked}>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextControl required label="模板名称" {...control("name")} />
            <TextControl
              label="模板编码"
              readOnly={!!template}
              hint="留空由系统生成"
              {...control("code")}
            />
          </div>
          <AreaControl label="说明" {...control("description")} />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-sm text-muted-foreground">
              Go 模板 · v{d.engine_version}
            </span>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={d.enabled}
                onChange={(e) =>
                  set((old) => ({ ...old, enabled: e.target.checked }))
                }
              />
              启用模板
            </label>
          </div>
          <TextControl
            required
            label="主题模板"
            {...control("subject_template")}
          />
          <ChoiceControl
            label="正文格式"
            options={[
              ["text", "纯文本"],
              ["html", "HTML"],
            ]}
            {...control("body_format")}
          />
          <AreaControl
            required
            label="正文模板"
            rows={6}
            {...control("body_template")}
          />
          {d.body_format === "html" && (
            <AreaControl
              label="备用纯文本"
              rows={3}
              {...control("text_body_template")}
            />
          )}
          <AreaControl
            label="参数定义（JSON）"
            className="font-mono"
            rows={4}
            {...control("schema")}
          />
          <AreaControl
            label="样例数据（JSON）"
            className="font-mono"
            rows={4}
            {...control("sample")}
          />
        </fieldset>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-4">
          <small>{dirty ? "有未保存的修改" : "已读取模板"}</small>
          <div className="flex gap-2">
            {onCancel && (
              <Button type="button" variant="outline" onClick={onCancel}>
                取消编辑
              </Button>
            )}
            <Button disabled={save.pending || save.blocked || !dirty}>
              保存模板
            </Button>
          </div>
        </div>
      </form>
      <section className="space-y-4 rounded-xl border bg-card p-5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-semibold">邮件预览</h2>
          <Button
            variant="outline"
            disabled={preview.loading}
            onClick={() => {
              if (errors.validate(invalid)) preview.run();
            }}
          >
            更新预览
          </Button>
        </div>
        <ErrorBox>{preview.error}</ErrorBox>
        {preview.data ? (
          <>
            <h3 className="break-words font-medium">{preview.data.subject}</h3>
            {preview.data.body_format === "html" ? (
              <iframe
                title="隔离的邮件 HTML 预览"
                sandbox=""
                referrerPolicy="no-referrer"
                className="min-h-56 w-full rounded-lg border bg-white"
                srcDoc={previewDocument(preview.data.body)}
              />
            ) : (
              <pre className="whitespace-pre-wrap break-words font-sans text-sm">
                {preview.data.body}
              </pre>
            )}
            {preview.data.text_body && (
              <details>
                <summary>备用纯文本</summary>
                <pre className="whitespace-pre-wrap">
                  {preview.data.text_body}
                </pre>
              </details>
            )}
          </>
        ) : (
          <p role="status" className="py-6 text-sm text-muted-foreground">
            {preview.loading
              ? "正在生成预览…"
              : "更新预览以查看当前草稿的渲染结果。"}
          </p>
        )}
      </section>
    </div>
  );
}
