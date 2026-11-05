import { useState, type FormEvent } from "react";
import { Link, Navigate } from "react-router";
import { z } from "zod";
import { Monitor, Moon, Sun } from "lucide-react";
import { api, request, resetCSRF } from "@/api/client";
import { useAuth, useLoginComplete } from "@/app/auth";
import { appearanceLabels, useTheme, type Appearance } from "@/app/theme";
import { Button, IconButton } from "@/components/button";
import { ErrorNotice } from "@/components/feedback";
import { Field, Input } from "@/components/fields";
import { useFormErrors, useSubmission } from "@/hooks/use-form";
import { authHref, returnTarget } from "@/lib/routes";
import type { Session } from "@/types/auth";
import {
  displayNameSchema,
  passwordSchema as passwordPolicy,
  usernameSchema,
} from "@/domain/validation";

const username = usernameSchema;
const displayName = displayNameSchema;
const password = passwordPolicy;
const loginSchema = z.object({
  username: z.string().min(1, "请输入用户名"),
  password: z.string().min(1, "请输入密码"),
});
export const registerSchema = z
  .object({
    username,
    display_name: displayName,
    password,
    confirm: z.string(),
  })
  .refine((value) => value.password === value.confirm, {
    path: ["confirm"],
    message: "两次输入的密码不一致",
  });
const passwordSchema = z
  .object({
    current_password: z.string().min(1, "请输入当前密码"),
    password,
    confirm: z.string(),
  })
  .refine((value) => value.password === value.confirm, {
    path: ["confirm"],
    message: "两次输入的密码不一致",
  });

interface AuthForm {
  username: string;
  display_name: string;
  current_password: string;
  password: string;
  confirm: string;
}
const initialForm: AuthForm = {
  username: "",
  display_name: "",
  current_password: "",
  password: "",
  confirm: "",
};

export function AuthPage({
  mode,
}: {
  mode: "login" | "register" | "required-password";
}) {
  const auth = useAuth();
  const target = returnTarget(new URL(window.location.href));
  if (mode !== "required-password" && auth.session)
    return (
      <Navigate
        to={
          auth.session.require_password_change
            ? authHref("/required-password", target)
            : target
        }
        replace
      />
    );
  if (mode === "required-password" && !auth.session)
    return <Navigate to={authHref("/login", target)} replace />;
  if (
    mode === "required-password" &&
    auth.session &&
    !auth.session.require_password_change
  )
    return <Navigate to={target} replace />;
  return <AuthForm key={mode} mode={mode} target={target} />;
}

function AuthForm({
  mode,
  target,
}: {
  mode: "login" | "register" | "required-password";
  target: string;
}) {
  const { settings } = useAuth();
  const { appearance, cycle, resolved } = useTheme();
  const [form, setForm] = useState<AuthForm>(initialForm);
  const [forgot, setForgot] = useState(false);
  const errors = useFormErrors();
  const submission = useSubmission();
  const complete = useLoginComplete();
  const register = mode === "register";
  const change = mode === "required-password";
  const title = change ? "设置新密码" : register ? "创建账号" : "欢迎回来";
  if (register && !settings.registration_enabled)
    return <Navigate to={authHref("/login", target)} replace />;

  function update(key: keyof AuthForm, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
    errors.change(key);
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    errors.clear();
    const schema = change
      ? passwordSchema
      : register
        ? registerSchema
        : loginSchema;
    const payload = change
      ? {
          current_password: form.current_password,
          password: form.password,
          confirm: form.confirm,
        }
      : register
        ? {
            username: form.username,
            display_name: form.display_name,
            password: form.password,
            confirm: form.confirm,
          }
        : { username: form.username, password: form.password };
    const result = schema.safeParse(payload);
    if (!result.success) {
      const fields: Record<string, string> = {};
      for (const issue of result.error.issues) {
        const key = String(issue.path[0] ?? "");
        if (!fields[key]) fields[key] = issue.message;
      }
      errors.validate(fields);
      return;
    }
    await submission.run(
      async () => {
        if (change) {
          await request("/account/password", {
            method: "PUT",
            body: {
              current_password: form.current_password,
              new_password: form.password,
            },
          });
          resetCSRF();
          window.location.replace(authHref("/login", target));
          return;
        }
        const session = await api<Session>(
          register ? "/auth/register" : "/auth/login",
          register
            ? {
                username: form.username,
                display_name: form.display_name.trim(),
                password: form.password,
              }
            : { username: form.username, password: form.password },
        );
        await complete(
          session.require_password_change
            ? authHref("/required-password", target)
            : target,
        );
      },
      (error) =>
        errors.show(error, Object.keys(form), { new_password: "password" }),
    );
  }
  async function logout() {
    await submission.run(async () => {
      await api("/auth/logout", {});
      resetCSRF();
      window.location.replace(authHref("/login", target));
    });
  }
  return (
    <main className="auth-page">
      <section className="auth-dialog" aria-label={title}>
        <div className="auth-visual">
          <div className="relative z-10 flex items-center gap-3 text-lg font-semibold">
            <img src="/logo-inverse.svg" className="size-9" alt="" />
            AntCDP
          </div>
        </div>
        <div className="auth-form">
          <IconButton
            className="absolute top-4 right-4"
            label={`外观：${appearanceLabels[appearance]}，点击切换`}
            onClick={cycle}
          >
            {resolved === "dark" ? (
              <Moon />
            ) : appearance === "system" ? (
              <Monitor />
            ) : (
              <Sun />
            )}
          </IconButton>
          <h1 className="mb-2 text-[26px] font-semibold tracking-tight">
            {title}
          </h1>
          <p className="mb-6 text-sm text-muted">
            {change
              ? "当前账号需要更新密码后才能继续使用。"
              : register
                ? "填写账号信息，加入当前协作空间。"
                : "使用你的平台账号继续。"}
          </p>
          <form
            ref={errors.formRef}
            noValidate
            onSubmit={(event) => void submit(event)}
          >
            <fieldset disabled={submission.pending} className="grid gap-4">
              <ErrorNotice error={errors.error} />
              {change && (
                <TextField
                  label="当前密码"
                  field="current_password"
                  type="password"
                  value={form.current_password}
                  autoComplete="current-password"
                  error={errors.fields.current_password}
                  onChange={update}
                />
              )}
              {!change && (
                <TextField
                  label="用户名"
                  field="username"
                  value={form.username}
                  autoComplete="username"
                  hint={register ? "3–30 位小写字母、数字、_ 或 -" : undefined}
                  error={errors.fields.username}
                  onChange={update}
                />
              )}
              {register && (
                <TextField
                  label="显示名称"
                  field="display_name"
                  value={form.display_name}
                  autoComplete="nickname"
                  error={errors.fields.display_name}
                  onChange={update}
                />
              )}
              <TextField
                label={change ? "新密码" : "密码"}
                field="password"
                type="password"
                value={form.password}
                autoComplete={
                  change || register ? "new-password" : "current-password"
                }
                hint={
                  change || register
                    ? "至少 8 个字符，且不超过 72 个 UTF-8 字节"
                    : undefined
                }
                error={errors.fields.password}
                onChange={update}
              />
              {(change || register) && (
                <TextField
                  label="确认密码"
                  field="confirm"
                  type="password"
                  value={form.confirm}
                  autoComplete="new-password"
                  error={errors.fields.confirm}
                  onChange={update}
                />
              )}
              {!change && !register && (
                <div className="text-right">
                  <Button
                    variant="link"
                    className="text-xs text-muted"
                    onClick={() => setForgot(!forgot)}
                    aria-expanded={forgot}
                  >
                    忘记密码？
                  </Button>
                  {forgot && (
                    <p className="mt-2 text-left text-xs leading-5 text-muted">
                      请联系管理员重置密码。创始人需由部署维护者协助恢复。
                    </p>
                  )}
                </div>
              )}
              <Button
                size="lg"
                className="w-full"
                type="submit"
                pending={submission.pending}
              >
                {change ? "保存新密码" : register ? "创建账号" : "登录"}
              </Button>
            </fieldset>
          </form>
          {!change && settings.registration_enabled && (
            <Link
              className="link mt-5 text-center text-sm"
              to={authHref(register ? "/login" : "/register", target)}
            >
              {register ? "已有账号，前往登录" : "注册新账号"}
            </Link>
          )}
          {change && (
            <Button
              variant="link"
              className="mt-5 text-sm"
              disabled={submission.pending}
              onClick={() => void logout()}
            >
              退出登录
            </Button>
          )}
        </div>
      </section>
    </main>
  );
}

function TextField({
  label,
  field,
  value,
  error,
  onChange,
  type = "text",
  autoComplete,
  hint,
}: {
  label: string;
  field: keyof AuthForm;
  value: string;
  error?: string;
  onChange: (field: keyof AuthForm, value: string) => void;
  type?: string;
  autoComplete?: string;
  hint?: string;
}) {
  return (
    <Field label={label} required error={error} hint={hint}>
      <Input
        name={field}
        type={type}
        value={value}
        autoComplete={autoComplete}
        onChange={(event) => onChange(field, event.target.value)}
      />
    </Field>
  );
}

export type { Appearance };
