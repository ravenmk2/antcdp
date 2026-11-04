import { useState } from "react";
import type { Profile } from "@/shared/sms";
import { request } from "@/lib/api";
import { writeReviewMessage } from "@/lib/write-error";
import { useSubmission } from "@/components/platform/use-submission";
import { useFormErrors } from "@/components/platform/use-form-errors";
import { FormDrawer } from "@/components/platform/form-drawer";
import { ErrorBox } from "@/components/platform/feedback";
import { TextControl, AreaControl } from "@/components/platform/form-controls";
import { Button } from "@/components/ui/button";
export function ProfileEditor({
  profile,
  tag,
  authOnly = false,
  onSaved,
  onClose,
}: {
  profile?: Profile;
  tag?: string;
  authOnly?: boolean;
  onSaved: (id: string) => void;
  onClose: () => void;
}) {
  const [version] = useState(tag),
    [initial] = useState({
      name: profile?.name || "",
      code: profile?.code || "",
      description: profile?.description || "",
      access_key_id: profile?.access_key_id || "",
      access_key_secret: "",
    }),
    [d, set] = useState(initial),
    errors = useFormErrors(),
    save = useSubmission(),
    dirty = JSON.stringify(d) !== JSON.stringify(initial);
  const prop = (k: keyof typeof d) => ({
    value: d[k],
    onValue: (v: string) => set((old) => ({ ...old, [k]: v })),
    error: errors.fields[k],
  });
  async function submit() {
    errors.clear();
    const fields: Record<string, string> = {};
    if (!authOnly && !d.name.trim()) fields.name = "请输入配置名称。";
    if (!authOnly && d.code && !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(d.code))
      fields.code = "请输入有效编码。";
    if (authOnly || !profile) {
      if (!/^[A-Za-z0-9]{8,128}$/.test(d.access_key_id))
        fields.access_key_id = "AccessKey ID 应为 8–128 位字母或数字。";
      if (!d.access_key_secret)
        fields.access_key_secret = "请输入 AccessKey Secret。";
    }
    if (!errors.validate(fields)) return;
    const authentication = {
      access_key_id: d.access_key_id,
      access_key_secret: d.access_key_secret,
    };
    const path = "/admin/sms/profiles" + (profile ? "/" + profile.id : "");
    await save.submit(
      async () => {
        const r = await request<Profile>(
          path + (authOnly ? "/authentication" : ""),
          {
            method: authOnly ? "PUT" : profile ? "PATCH" : "POST",
            etag: version,
            body: authOnly
              ? authentication
              : {
                  name: d.name,
                  code: d.code,
                  description: d.description,
                  ...(!profile
                    ? { config: { provider: "aliyun_sms" }, authentication }
                    : {}),
                },
          },
        );
        onSaved(profile?.id || r.data.id);
      },
      (e) => {
        set((v) => ({ ...v, access_key_secret: "" }));
        errors.show(e, Object.keys(d), { authentication: "access_key_secret" });
      },
    );
  }
  return (
    <FormDrawer
      title={
        authOnly ? "替换阿里云认证" : profile ? "编辑短信配置" : "创建短信配置"
      }
      description={profile?.name || "配置阿里云短信访问身份。"}
      dirty={dirty}
      pending={save.pending}
      onClose={onClose}
      footer={(close) => (
        <>
          <Button
            variant="outline"
            disabled={save.pending}
            onClick={() => close()}
          >
            取消
          </Button>
          <Button
            type="submit"
            form="sms-config"
            disabled={save.pending || save.blocked || !dirty}
          >
            保存配置
          </Button>
        </>
      )}
    >
      <form
        ref={errors.formRef}
        id="sms-config"
        noValidate
        className="space-y-5"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <ErrorBox>{errors.error}</ErrorBox>
        {save.blocked && <p role="alert">{writeReviewMessage}</p>}
        <fieldset disabled={save.pending || save.blocked} className="space-y-4">
          {!authOnly && (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <TextControl required label="配置名称" {...prop("name")} />
                <TextControl
                  label="配置编码"
                  readOnly={!!profile}
                  hint="留空由系统生成"
                  {...prop("code")}
                />
              </div>
              <AreaControl label="说明" {...prop("description")} />
            </>
          )}
          {(!profile || authOnly) && (
            <>
              <TextControl
                label="AccessKey ID"
                required
                autoComplete="off"
                {...prop("access_key_id")}
              />
              <TextControl
                label="AccessKey Secret"
                required
                type="password"
                autoComplete="new-password"
                {...prop("access_key_secret")}
              />
            </>
          )}
        </fieldset>
      </form>
    </FormDrawer>
  );
}
