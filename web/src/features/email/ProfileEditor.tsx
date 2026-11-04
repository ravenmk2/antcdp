import { useState } from "react";
import type { EmailProfile } from "@/shared/email";
import { request } from "@/lib/api";
import { writeReviewMessage } from "@/lib/write-error";
import { useSubmission } from "@/components/platform/use-submission";
import { useFormErrors } from "@/components/platform/use-form-errors";
import { FormDrawer } from "@/components/platform/form-drawer";
import { ErrorBox } from "@/components/platform/feedback";
import {
  TextControl,
  AreaControl,
  ChoiceControl,
} from "@/components/platform/form-controls";
import { Button } from "@/components/ui/button";
export type ProfileMode = "create" | "edit" | "auth" | "names";
export function ProfileEditor({
  mode,
  profile,
  tag,
  onClose,
  onSaved,
}: {
  mode: ProfileMode;
  profile?: EmailProfile;
  tag?: string;
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const [version] = useState(tag),
    [initial] = useState(() => ({
      name: profile?.name || "",
      code: profile?.code || "",
      description: profile?.description || "",
      host: profile?.config.host || "",
      port: String(profile?.config.port || 465),
      tls_mode: profile?.config.tls_mode || "implicit_tls",
      from_address: profile?.config.from_address || "",
      custom_ca_pem: profile?.config.custom_ca_pem || "",
      username: profile?.username || "",
      password: "",
    })),
    [d, set] = useState(initial),
    [startNames] = useState(
      () => profile?.sender_names || [{ id: "", name: "", default: true }],
    ),
    [names, setNames] = useState(startNames);
  const save = useSubmission(),
    errors = useFormErrors(),
    base = "/admin/email/profiles",
    dirty =
      JSON.stringify(d) !== JSON.stringify(initial) ||
      JSON.stringify(names) !== JSON.stringify(startNames);
  const change = (k: keyof typeof d, v: string) =>
    set((old) => ({ ...old, [k]: v }));
  const control = (k: keyof typeof d) => ({
    value: d[k],
    onValue: (v: string) => change(k, v),
    error: errors.fields[k],
  });
  async function submit() {
    errors.clear();
    const fields: Record<string, string> = {};
    const basic = mode === "create" || mode === "edit";
    if (basic) {
      if (!d.name.trim()) fields.name = "请输入配置名称。";
      if (d.code && !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(d.code))
        fields.code = "编码格式无效。";
      if (!d.host.trim()) fields.host = "请输入 SMTP 主机。";
      if (
        !Number.isInteger(Number(d.port)) ||
        Number(d.port) < 1 ||
        Number(d.port) > 65535
      )
        fields.port = "端口范围为 1–65535。";
      if (!/^[^\s@]+@[^\s@]+$/.test(d.from_address))
        fields.from_address = "请输入有效的发件地址。";
    }
    if (mode === "create" || mode === "auth") {
      if (!d.username.trim()) fields.username = "请输入认证用户名。";
      if (!d.password) fields.password = "请输入认证密码。";
    }
    if (mode === "create" || mode === "names") {
      for (const [i, n] of names.entries())
        if (!n.name.trim()) fields["sender" + i] = "请输入发件名称。";
    }
    if (!errors.validate(fields)) return;
    const auth = { username: d.username, password: d.password };
    const path = profile ? base + "/" + profile.id : base;
    const body =
      mode === "auth"
        ? auth
        : mode === "names"
          ? { sender_names: names }
          : {
              code: d.code,
              name: d.name,
              description: d.description,
              config: {
                host: d.host,
                port: Number(d.port),
                tls_mode: d.tls_mode,
                from_address: d.from_address,
                custom_ca_pem: d.custom_ca_pem,
              },
              ...(mode === "create"
                ? { sender_names: names, authentication: auth }
                : {}),
            };
    await save.submit(
      async () => {
        const r = await request<EmailProfile>(
          path + (mode === "auth" ? "/authentication" : ""),
          {
            method:
              mode === "create" ? "POST" : mode === "auth" ? "PUT" : "PATCH",
            etag: version,
            body,
          },
        );
        onSaved(profile?.id || r.data.id);
      },
      (e) => {
        change("password", "");
        errors.show(e, [...Object.keys(d), "sender_names"], {
          "config.custom_ca_pem": "custom_ca_pem",
        });
      },
    );
  }
  return (
    <FormDrawer
      title={
        {
          create: "创建邮件配置",
          edit: "编辑邮件配置",
          names: "管理发件名称",
          auth: "替换 SMTP 认证",
        }[mode]
      }
      description={profile?.name || "配置 SMTP 连接、认证材料与默认发件名称。"}
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
            form="email-profile-form"
            disabled={save.pending || save.blocked || !dirty}
          >
            保存配置
          </Button>
        </>
      )}
    >
      <form
        id="email-profile-form"
        ref={errors.formRef}
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        className="space-y-4"
      >
        <ErrorBox>{errors.error || errors.fields.sender_names}</ErrorBox>
        {save.blocked && <p role="alert">{writeReviewMessage}</p>}
        <fieldset disabled={save.pending || save.blocked} className="space-y-5">
          {(mode === "create" || mode === "edit") && (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <TextControl label="配置名称" required {...control("name")} />
                <TextControl
                  label="配置编码"
                  readOnly={mode === "edit"}
                  hint="留空由系统生成"
                  {...control("code")}
                />
              </div>
              <AreaControl label="说明" {...control("description")} />
              <div className="grid gap-4 sm:grid-cols-2">
                <TextControl label="SMTP 主机" required {...control("host")} />
                <TextControl
                  label="端口"
                  inputMode="numeric"
                  required
                  {...control("port")}
                />
                <ChoiceControl
                  label="连接安全"
                  options={[
                    ["implicit_tls", "TLS 直连"],
                    ["starttls", "STARTTLS"],
                  ]}
                  {...control("tls_mode")}
                />
                <TextControl
                  label="发件地址"
                  required
                  type="email"
                  {...control("from_address")}
                />
              </div>
              <details
                open={Boolean(
                  initial.custom_ca_pem || errors.fields.custom_ca_pem,
                )}
                className="space-y-2"
              >
                <summary className="cursor-pointer text-sm">
                  高级 TLS 设置{d.custom_ca_pem && " · 已填写 CA"}
                </summary>
                <AreaControl
                  label="自定义 CA"
                  rows={3}
                  {...control("custom_ca_pem")}
                />
              </details>
            </>
          )}
          {(mode === "create" || mode === "auth") && (
            <div className="grid gap-4 border-t pt-4 sm:grid-cols-2">
              <TextControl
                label="认证用户名"
                required
                autoComplete="off"
                {...control("username")}
              />
              <TextControl
                type="password"
                label="认证密码"
                required
                autoComplete="new-password"
                {...control("password")}
              />
            </div>
          )}
          {(mode === "names" || mode === "create") && (
            <section className="space-y-3 border-t pt-4">
              <h3 className="font-medium">发件名称</h3>
              {names.map((n, i) => (
                <div key={n.id || i} className="flex flex-wrap items-end gap-3">
                  <div className="min-w-32 flex-1">
                    <TextControl
                      label={"名称 " + (i + 1)}
                      value={n.name}
                      required
                      error={errors.fields["sender" + i]}
                      onValue={(v) =>
                        setNames((old) =>
                          old.map((x, j) => (j === i ? { ...x, name: v } : x)),
                        )
                      }
                    />
                  </div>
                  <label className="flex h-10 items-center gap-1">
                    <input
                      type="radio"
                      name="default-sender"
                      checked={n.default}
                      onChange={() =>
                        setNames((old) =>
                          old.map((x, j) => ({ ...x, default: j === i })),
                        )
                      }
                    />
                    默认
                  </label>
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={n.default || names.length === 1}
                    onClick={() =>
                      setNames((old) => old.filter((_, j) => j !== i))
                    }
                  >
                    移除
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                onClick={() =>
                  setNames((old) => [
                    ...old,
                    { id: "", name: "", default: false },
                  ])
                }
              >
                添加名称
              </Button>
            </section>
          )}
        </fieldset>
      </form>
    </FormDrawer>
  );
}
