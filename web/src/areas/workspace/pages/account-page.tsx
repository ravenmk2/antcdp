import { request, resetCSRF } from "@/api/client";
import { useSession } from "@/app/auth";
import { Button } from "@/components/button";
import { ErrorNotice, Notice } from "@/components/feedback";
import { Field, Input } from "@/components/fields";
import { PageHeader, Panel } from "@/components/layout";
import {
  displayNameSchema,
  optionalEmailSchema,
  passwordSchema as newPasswordSchema,
} from "@/domain/validation";
import { AccountEmailField } from "@/features/access/account-email-field";
import { ImageEditor, type ImageValue } from "@/features/media/image-editor";
import { useFormErrors, useSubmission } from "@/hooks/use-form";
import { useUnsaved } from "@/hooks/use-unsaved";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useLocation } from "react-router";
import { z } from "zod";
import { personalSettingsSection } from "./personal-settings-navigation";

const profileSchema = z.object({
  display_name: displayNameSchema,
  email: optionalEmailSchema,
});
const profileFieldClass =
  "py-3 sm:grid-cols-[130px_minmax(0,1fr)] sm:items-center sm:gap-x-6 sm:[&>p]:col-start-2";
const passwordSchema = z
  .object({
    current: z.string().min(1, "请输入当前密码"),
    next: newPasswordSchema,
    confirm: z.string(),
  })
  .refine((value) => value.next === value.confirm, {
    path: ["confirm"],
    message: "两次输入的密码不一致",
  });

export function AccountPage() {
  const { pathname, search } = useLocation();
  const { key: section } = personalSettingsSection(pathname, search);
  return (
    <div className="page">
      <PageHeader
        title={
          section === "security"
            ? "账号安全"
            : section === "profile"
              ? "个人资料"
              : "个人凭证"
        }
        description={
          section === "security"
            ? "管理登录密码，保护你的账号访问。"
            : section === "profile"
              ? "设置头像、显示名称和邮箱。"
              : "管理你访问服务和远程主机时使用的凭证。"
        }
      />
      <div
        className={section === "security" ? "max-w-[680px]" : "max-w-[800px]"}
      >
        {section === "profile" ? (
          <Profile />
        ) : section === "security" ? (
          <Password />
        ) : section === "integrations" ? (
          <CredentialEntry kind="service" />
        ) : (
          <CredentialEntry kind="ssh" />
        )}
      </div>
    </div>
  );
}

function Profile() {
  const session = useSession();
  const user = session.user;
  const [name, setName] = useState(user.display_name);
  const [email, setEmail] = useState(user.email ?? "");
  const [avatar, setAvatar] = useState<ImageValue | null | undefined>(
    undefined,
  );
  const errors = useFormErrors();
  const submission = useSubmission();
  const queryClient = useQueryClient();
  const dirty =
    name !== user.display_name ||
    email !== (user.email ?? "") ||
    avatar !== undefined;
  useUnsaved(dirty, submission.pending);
  async function save() {
    const result = profileSchema.safeParse({ display_name: name, email });
    if (!result.success) {
      errors.validate(
        Object.fromEntries(
          result.error.issues.map((issue) => [
            String(issue.path[0]),
            issue.message,
          ]),
        ),
      );
      return;
    }
    await submission.run(
      async () => {
        await request("/account", {
          method: "PATCH",
          etag: `"u-${user.id}-v${user.version}"`,
          body: {
            display_name: result.data.display_name,
            ...(result.data.email !== (user.email ?? "")
              ? { email: result.data.email }
              : {}),
            ...(avatar === undefined
              ? {}
              : { avatar_upload_id: avatar?.id ?? null }),
          },
        });
        await queryClient.invalidateQueries({ queryKey: ["session"] });
        window.location.reload();
      },
      (error) =>
        errors.show(error, ["display_name", "email", "avatar_upload_id"]),
    );
  }
  return (
    <Panel title="账号资料" bodyClassName="p-6">
      <form
        ref={errors.formRef}
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <ErrorNotice error={errors.error || submission.error} />
        <div className="mb-2">
          <ImageEditor
            kind="avatar"
            avatarName={name}
            current={user.avatar?.url}
            value={avatar}
            onChange={setAvatar}
            disabled={submission.pending}
          />
        </div>
        <div className="divide-y divide-border-subtle">
          <Field label="用户名" className={profileFieldClass}>
            <Input
              name="username"
              autoComplete="username"
              value={user.username}
              readOnly
            />
          </Field>
          <Field
            label="显示名称"
            required
            className={profileFieldClass}
            error={errors.fields.display_name}
          >
            <Input
              name="display_name"
              autoComplete="nickname"
              disabled={submission.pending}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
          <AccountEmailField
            className={profileFieldClass}
            value={email}
            savedEmail={user.email}
            verified={user.email_verified}
            disabled={submission.pending}
            error={errors.fields.email}
            autoComplete="email"
            onChange={setEmail}
          />
        </div>
        <div className="form-actions">
          {dirty && (
            <span className="mr-auto text-xs text-muted">有未保存的修改</span>
          )}
          <Button
            variant="outline"
            disabled={!dirty || submission.pending}
            onClick={() => {
              setName(user.display_name);
              setEmail(user.email ?? "");
              setAvatar(undefined);
            }}
          >
            撤销
          </Button>
          <Button type="submit" disabled={!dirty} pending={submission.pending}>
            保存资料
          </Button>
        </div>
      </form>
    </Panel>
  );
}

function Password() {
  const [form, setForm] = useState({ current: "", next: "", confirm: "" });
  const errors = useFormErrors();
  const submission = useSubmission();
  async function save() {
    const result = passwordSchema.safeParse(form);
    if (!result.success) {
      errors.validate(
        Object.fromEntries(
          result.error.issues.map((issue) => [
            String(issue.path[0]),
            issue.message,
          ]),
        ),
      );
      return;
    }
    await submission.run(
      async () => {
        await request("/account/password", {
          method: "PUT",
          body: { current_password: form.current, new_password: form.next },
        });
        resetCSRF();
        window.location.replace("/login");
      },
      (error) =>
        errors.show(error, ["current", "next"], {
          current_password: "current",
          new_password: "next",
        }),
    );
  }
  return (
    <Panel title="修改密码" bodyClassName="p-6">
      <Notice className="mb-5">
        成功后全部会话失效，需要使用新密码重新登录。
      </Notice>
      <form
        ref={errors.formRef}
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <ErrorNotice error={errors.error || submission.error} />
        <fieldset disabled={submission.pending} className="grid gap-5">
          <Field label="当前密码" required error={errors.fields.current}>
            <Input
              name="current"
              type="password"
              autoComplete="current-password"
              value={form.current}
              onChange={(event) =>
                setForm({ ...form, current: event.target.value })
              }
            />
          </Field>
          <Field
            label="新密码"
            required
            hint="至少 8 个字符，且不超过 72 个 UTF-8 字节"
            error={errors.fields.next}
          >
            <Input
              name="next"
              type="password"
              autoComplete="new-password"
              value={form.next}
              onChange={(event) =>
                setForm({ ...form, next: event.target.value })
              }
            />
          </Field>
          <Field label="确认新密码" required error={errors.fields.confirm}>
            <Input
              name="confirm"
              type="password"
              autoComplete="new-password"
              value={form.confirm}
              onChange={(event) =>
                setForm({ ...form, confirm: event.target.value })
              }
            />
          </Field>
        </fieldset>
        <div className="form-actions">
          <Button type="submit" pending={submission.pending}>
            修改密码
          </Button>
        </div>
      </form>
    </Panel>
  );
}

function CredentialEntry({ kind }: { kind: "service" | "ssh" }) {
  return (
    <Panel
      title={kind === "service" ? "个人服务连接" : "个人远程主机"}
      action={
        <Button
          render={
            <Link
              to={
                kind === "service"
                  ? "/account/integrations"
                  : "/account/remote-hosts"
              }
            >
              设置首选凭据
            </Link>
          }
          nativeButton={false}
          role="link"
        />
      }
    >
      <Notice>在个人凭据页维护材料，在具体资源中设置首选。</Notice>
    </Panel>
  );
}
