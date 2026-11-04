import { useOperationToast } from "@/components/platform/operation-toast";
import { useState, useEffect } from "react";
import type { Template, Profile, Preview } from "@/shared/sms";
import { request } from "@/lib/api";
import { jsonObject, usePreview } from "@/lib/preview";
import { useCatalogPages } from "@/lib/use-catalog-pages";
import { useSubmission } from "@/components/platform/use-submission";
import { useFormErrors } from "@/components/platform/use-form-errors";
import { useNavigationProtection } from "@/components/platform/navigation-guard";
import { writeReviewMessage } from "@/lib/write-error";
import {
  AreaControl,
  TextControl,
  ChoiceControl,
} from "@/components/platform/form-controls";
import { ErrorBox } from "@/components/platform/feedback";
import { Button } from "@/components/ui/button";
import { PreviewContent } from "./Testing";
function draft(t?: Template) {
  return {
    name: t?.name || "",
    description: t?.description || "",
    code: t?.code || "",
    enabled: t?.enabled ?? true,
    mode: t?.mode || "remote",
    profile_id: t?.profile_id || "",
    sign_name: t?.sign_name || "",
    remote_template_id: t?.remote_template_id || "",
    body_template: t?.body_template || "你好，{{.name}}。这是一条测试通知。",
    mapping: Object.entries(t?.provider_parameters || { name: "name" }).map(
      ([target, source]) => ({ target, source }),
    ),
    schema: JSON.stringify(
      t?.parameter_schema || {
        name: { type: "string", required: true, description: "示例名称" },
      },
      null,
      2,
    ),
    sample: JSON.stringify(t?.sample_data || { name: "同事" }, null, 2),
  };
}
export function mappingPayload(rows: { target: string; source: string }[]) {
  const entries = new Map<string, string>();
  for (const row of rows) {
    if (!/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(row.target) || !row.source)
      throw Error("请填写有效的供应商参数名及对应的抽象参数名。");
    if (entries.has(row.target)) throw Error("供应商参数名不能重复。");
    entries.set(row.target, row.source);
  }
  return Object.fromEntries(entries);
}
export function TemplateEditor({
  template,
  tag,
  onSaved,
  onDirty,
}: {
  template?: Template;
  tag?: string;
  onSaved: (t: Template) => void;
  onDirty: (b: boolean) => void;
}) {
  const [baseline, setBaseline] = useState(() => draft(template)),
    [d, set] = useState(baseline),
    [version, setVersion] = useState(tag),
    notify = useOperationToast();
  const profiles = useCatalogPages<Profile>(
      "/admin/sms/profiles?status=enabled",
    ),
    save = useSubmission(),
    errors = useFormErrors(),
    dirty = JSON.stringify(d) !== JSON.stringify(baseline);
  useNavigationProtection(
    save.pending ? "pending" : dirty ? "dirty" : undefined,
  );
  useEffect(() => onDirty(dirty), [dirty, onDirty]);
  const remote = d.mode === "remote",
    invalid: Record<string, string> = {};
  let schema = {},
    sample = {},
    mapping = {};
  try {
    schema = jsonObject(d.schema);
  } catch {
    invalid.schema = "参数定义必须是 JSON 对象。";
  }
  try {
    sample = jsonObject(d.sample);
  } catch {
    invalid.sample = "样例数据必须是 JSON 对象。";
  }
  if (remote) {
    try {
      mapping = mappingPayload(d.mapping);
    } catch (e) {
      invalid.mapping = (e as Error).message;
    }
    if (!d.profile_id || d.profile_id === "0")
      invalid.profile_id = "请选择绑定的短信配置。";
    if (!d.sign_name.trim()) invalid.sign_name = "请输入短信签名。";
    if (!/^SMS_[A-Za-z0-9]{1,64}$/.test(d.remote_template_id))
      invalid.remote_template_id = "请输入以 SMS_ 开头的远端模板 ID。";
  } else if (!d.body_template.trim())
    invalid.body_template = "请输入本地正文模板。";
  const body = {
    name: d.name,
    code: d.code,
    description: d.description,
    enabled: d.enabled,
    mode: d.mode,
    profile_id: remote ? d.profile_id : "0",
    sign_name: remote ? d.sign_name : "",
    remote_template_id: remote ? d.remote_template_id : "",
    provider_parameters: remote ? mapping : {},
    engine_id: remote ? "" : "go_template",
    engine_version: remote ? 0 : 1,
    body_template: remote ? "" : d.body_template,
    parameter_schema: schema,
    sample_data: sample,
  };
  const preview = usePreview<Preview>(
    "/admin/sms/templates/preview",
    Object.keys(invalid).length ? null : JSON.stringify({ draft: body }),
    !!template,
  );
  const ctl = (
    key:
      | "name"
      | "code"
      | "description"
      | "profile_id"
      | "sign_name"
      | "remote_template_id"
      | "body_template"
      | "schema"
      | "sample",
  ) => ({
    value: d[key],
    error: errors.fields[key],
    onValue: (v: string) => set((old) => ({ ...old, [key]: v })),
  });
  async function persist() {
    errors.clear();
    if (
      !errors.validate({
        ...invalid,
        name: d.name.trim() ? "" : "请输入模板名称。",
      })
    )
      return;
    await save.submit(
      async () => {
        const r = await request<Template>(
          "/admin/sms/templates" + (template ? "/" + template.id : ""),
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
            "name",
            "code",
            "sign_name",
            "profile_id",
            "remote_template_id",
            "body_template",
            "schema",
            "sample",
            "mapping",
          ],
          {
            parameter_schema: "schema",
            sample_data: "sample",
            provider_parameters: "mapping",
          },
        ),
    );
  }
  const options = (profiles.items || []).map((p) => [p.id, p.name] as const);
  if (
    template?.mode === "remote" &&
    !options.some(([id]) => id === template.profile_id)
  )
    options.push([template.profile_id, "已绑定配置 " + template.profile_id]);
  return (
    <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
      <form
        ref={errors.formRef}
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void persist();
        }}
        className="space-y-5 rounded-xl border bg-card p-5"
      >
        <ErrorBox>{errors.error}</ErrorBox>
        {save.blocked && <p role="alert">{writeReviewMessage}</p>}

        <fieldset disabled={save.pending || save.blocked} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <TextControl required label="模板名称" {...ctl("name")} />
            <TextControl
              label="模板编码"
              readOnly={!!template}
              {...ctl("code")}
            />
          </div>
          <AreaControl label="说明" {...ctl("description")} />
          <ChoiceControl
            label="模板模式"
            disabled={!!template}
            value={d.mode}
            onValue={(v) =>
              set((old) => ({ ...old, mode: v as Template["mode"] }))
            }
            options={[
              ["remote", "阿里云远端模板"],
              ["local", "本地模拟正文"],
            ]}
          />
          {remote ? (
            <>
              <ErrorBox>{profiles.error}</ErrorBox>
              {profiles.error && (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={profiles.refresh}
                >
                  重新读取配置
                </Button>
              )}
              <ChoiceControl
                label="绑定短信配置"
                required
                disabled={!!template}
                {...ctl("profile_id")}
                options={[["", "请选择"], ...options]}
              />
              <div className="grid gap-4 sm:grid-cols-2">
                <TextControl required label="短信签名" {...ctl("sign_name")} />
                <TextControl
                  required
                  label="远端模板 ID"
                  {...ctl("remote_template_id")}
                />
              </div>
              <section className="space-y-3 border-y py-4">
                <h3 className="font-medium">供应商参数映射</h3>
                <ErrorBox>{errors.fields.mapping}</ErrorBox>
                {d.mapping.map((m, i) => (
                  <div
                    className="grid items-end gap-2 sm:grid-cols-[1fr_1fr_auto]"
                    key={i}
                  >
                    {(["target", "source"] as const).map((k) => (
                      <TextControl
                        key={k}
                        label={
                          (k === "target" ? "供应商参数名 " : "抽象参数名 ") +
                          (i + 1)
                        }
                        value={m[k]}
                        onValue={(v) =>
                          set((old) => ({
                            ...old,
                            mapping: old.mapping.map((r, j) =>
                              j === i ? { ...r, [k]: v } : r,
                            ),
                          }))
                        }
                      />
                    ))}
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() =>
                        set((old) => ({
                          ...old,
                          mapping: old.mapping.filter((_, j) => i !== j),
                        }))
                      }
                    >
                      移除
                    </Button>
                  </div>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  disabled={d.mapping.length >= 50}
                  onClick={() =>
                    set((old) => ({
                      ...old,
                      mapping: [...old.mapping, { target: "", source: "" }],
                    }))
                  }
                >
                  添加映射
                </Button>
              </section>
            </>
          ) : (
            <AreaControl
              label="本地正文模板"
              required
              rows={6}
              {...ctl("body_template")}
            />
          )}
          <AreaControl
            label="参数定义（JSON）"
            className="font-mono"
            rows={4}
            {...ctl("schema")}
          />
          <AreaControl
            label="样例数据（JSON）"
            className="font-mono"
            rows={4}
            {...ctl("sample")}
          />
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
        </fieldset>
        <div className="flex items-center justify-between gap-2 border-t pt-4">
          <small>{dirty ? "有未保存的修改" : "已读取模板"}</small>
          <Button disabled={save.pending || save.blocked || !dirty}>
            保存模板
          </Button>
        </div>
      </form>
      <section className="space-y-4 rounded-xl border bg-card p-5">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-semibold">
            {remote ? "供应商参数预览" : "短信正文预览"}
          </h2>
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
          <PreviewContent value={preview.data} />
        ) : (
          <p role="status" className="text-sm text-muted-foreground">
            {preview.loading ? "正在预览…" : "修改完成后可预览当前草稿。"}
          </p>
        )}
        {template?.last_simulation && (
          <p className="border-t pt-3 text-sm">
            最近模拟 ·{" "}
            {template.last_simulation.outdated ? "模板已变化" : "已记录"}
            ，未发送短信。
          </p>
        )}
      </section>
    </div>
  );
}
