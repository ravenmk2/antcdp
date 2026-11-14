import { request, resetCSRF } from "@/api/client";
import { useSession } from "@/app/auth";
import { Button } from "@/components/button";
import { ErrorNotice, Notice } from "@/components/feedback";
import { Field, Input } from "@/components/fields";
import { PageHeader, Panel } from "@/components/layout";
import {
  displayNameSchema,
  passwordSchema as newPasswordSchema,
} from "@/domain/validation";
import { ImageEditor, type ImageValue } from "@/features/media/image-editor";
import { useFormErrors, useSubmission } from "@/hooks/use-form";
import { useUnsaved } from "@/hooks/use-unsaved";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router";
import { z } from "zod";

const profileSchema = z.object({ display_name: displayNameSchema });
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
  const location = useLocation();
  const [params] = useSearchParams();
  const section = location.pathname.endsWith("/security")
    ? "security"
    : (params.get("section") ?? "profile");
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
              ? "设置头像和显示名称，让协作成员更容易识别你。"
              : "管理你访问服务和远程主机时使用的凭证。"
        }
      />
      <div className="account-settings-content" data-section={section}>
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
  const [avatar, setAvatar] = useState<ImageValue | null | undefined>(
    undefined,
  );
  const errors = useFormErrors();
  const submission = useSubmission();
  const queryClient = useQueryClient();
  const dirty = name !== user.display_name || avatar !== undefined;
  useUnsaved(dirty, submission.pending);
  async function save() {
    const result = profileSchema.safeParse({ display_name: name });
    if (!result.success) {
      errors.validate({
        display_name: result.error.issues[0]?.message ?? "资料不正确",
      });
      return;
    }
    await submission.run(
      async () => {
        await request("/account", {
          method: "PATCH",
          etag: `"u-${user.id}-v${user.version}"`,
          body: {
            display_name: name.trim(),
            ...(avatar === undefined
              ? {}
              : { avatar_upload_id: avatar?.id ?? null }),
          },
        });
        await queryClient.invalidateQueries({ queryKey: ["session"] });
        window.location.reload();
      },
      (error) => errors.show(error, ["display_name", "avatar_upload_id"]),
    );
  }
  return (
    <Panel title="头像与名称" bodyClassName="p-6">
      <form
        ref={errors.formRef}
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <ErrorNotice error={errors.error || submission.error} />
        <div className="mb-6">
          <ImageEditor
            kind="avatar"
            current={user.avatar?.url}
            value={avatar}
            onChange={setAvatar}
            disabled={submission.pending}
          />
        </div>
        <div className="grid gap-5">
          <dl className="text-sm">
            <dt className="mb-2 text-xs text-muted">用户名</dt>
            <dd className="break-all font-medium">{user.username}</dd>
            <dd className="mt-1 text-xs text-muted">
              用于登录，个人设置中不可修改。
            </dd>
          </dl>
          <Field label="显示名称" required error={errors.fields.display_name}>
            <Input
              name="display_name"
              autoComplete="nickname"
              disabled={submission.pending}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
        </div>
        <div className="form-actions">
          <span className="mr-auto text-xs text-muted">
            {dirty ? "有未保存的修改" : "资料已保存"}
          </span>
          <Button
            variant="outline"
            disabled={!dirty || submission.pending}
            onClick={() => {
              setName(user.display_name);
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
      title={kind === "service" ? "个人服务凭证" : "个人 SSH 凭证"}
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
              进入凭证管理
            </Link>
          }
          nativeButton={false}
          role="link"
        />
      }
    >
      <Notice>
        个人凭证仅本人可维护，系统管理员不能代管或读取。密码、Token
        和私钥保存后不可查看。
      </Notice>
    </Panel>
  );
}
