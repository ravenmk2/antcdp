import { useState } from "react";
import type { Robot } from "@/shared/dingtalk";
import { request } from "@/lib/api";
import { writeReviewMessage } from "@/lib/write-error";
import { useSubmission } from "@/components/platform/use-submission";
import { useFormErrors } from "@/components/platform/use-form-errors";
import { FormDrawer } from "@/components/platform/form-drawer";
import { TextControl, AreaControl } from "@/components/platform/form-controls";
import { ErrorBox } from "@/components/platform/feedback";
import { Button } from "@/components/ui/button";
export const base = "/admin/dingtalk/robots";
export function Editor({
  robot,
  tag,
  authOnly = false,
  onSaved,
  onClose,
}: {
  robot?: Robot;
  tag?: string;
  authOnly?: boolean;
  onSaved: (id: string) => void;
  onClose: () => void;
}) {
  const [original] = useState({
      name: robot?.name || "",
      code: robot?.code || "",
      description: robot?.description || "",
      keyword: robot?.keyword || "",
      access_token: "",
      secret: "",
    }),
    [version] = useState(tag),
    [d, set] = useState(original),
    save = useSubmission(),
    errors = useFormErrors(),
    dirty = JSON.stringify(original) !== JSON.stringify(d);
  const control = (k: keyof typeof d) => ({
    value: d[k],
    onValue: (v: string) => set((old) => ({ ...old, [k]: v })),
    error: errors.fields[k],
  });
  async function submit() {
    errors.clear();
    const fields: Record<string, string> = {};
    if (!authOnly) {
      if (!d.name.trim()) fields.name = "请输入机器人名称。";
      if (d.code && !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(d.code))
        fields.code = "请输入有效的机器人标识。";
      if (
        !d.keyword.trim() ||
        [...d.keyword.trim()].length > 20 ||
        /[\r\n]/.test(d.keyword)
      )
        fields.keyword = "关键词须为单行 1–20 个字符。";
    }
    if (!robot || authOnly) {
      if (!/^[A-Za-z0-9_-]{16,256}$/.test(d.access_token))
        fields.access_token = "填写机器人 access_token，长度为 16–256 个字符。";
      if (!/^SEC[A-Za-z0-9]{16,256}$/.test(d.secret))
        fields.secret = "填写以 SEC 开头的加签密钥。";
    }
    if (!errors.validate(fields)) return;
    const auth = { access_token: d.access_token, secret: d.secret };
    const path =
      base +
      (robot ? "/" + robot.id : "") +
      (authOnly ? "/authentication" : "");
    await save.submit(
      async () => {
        const r = await request<Robot>(path, {
          method: authOnly ? "PUT" : robot ? "PATCH" : "POST",
          etag: version,
          body: authOnly
            ? auth
            : {
                name: d.name,
                code: d.code,
                description: d.description,
                keyword: d.keyword,
                ...(!robot ? { authentication: auth } : {}),
              },
        });
        onSaved(robot?.id || r.data.id);
      },
      (e) => {
        set((old) => ({ ...old, access_token: "", secret: "" }));
        errors.show(e, Object.keys(d), { authentication: "access_token" });
      },
    );
  }
  return (
    <FormDrawer
      size="compact"
      title={authOnly ? "替换机器人认证" : robot ? "编辑机器人" : "添加机器人"}
      description={robot?.name || "配置群机器人的身份、关键词和加签材料。"}
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
            form="dingtalk-edit"
            disabled={!dirty || save.pending || save.blocked}
          >
            保存
          </Button>
        </>
      )}
    >
      <form
        id="dingtalk-edit"
        ref={errors.formRef}
        className="space-y-5"
        noValidate
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
                <TextControl
                  required
                  label="机器人名称"
                  maxLength={100}
                  {...control("name")}
                />
                <TextControl
                  label="机器人标识"
                  readOnly={!!robot}
                  hint="留空由系统生成"
                  {...control("code")}
                />
              </div>
              <AreaControl
                label="说明"
                maxLength={1000}
                {...control("description")}
              />
              <TextControl
                required
                label="关键词"
                hint="发送时将关键词置于正文首行。"
                {...control("keyword")}
              />
            </>
          )}
          {(!robot || authOnly) && (
            <>
              <TextControl
                required
                label="Access Token"
                type="password"
                autoComplete="new-password"
                {...control("access_token")}
              />
              <TextControl
                required
                label="加签密钥"
                type="password"
                autoComplete="new-password"
                {...control("secret")}
              />
            </>
          )}
        </fieldset>
      </form>
    </FormDrawer>
  );
}
