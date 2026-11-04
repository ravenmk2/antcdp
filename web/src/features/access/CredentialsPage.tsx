import { useState } from "react";
import {
  useLoaderData,
  redirectDocument,
  type LoaderFunctionArgs,
} from "react-router";
import {
  readIdentity,
  invalidateIdentity,
  type Session,
  type Identity,
} from "@/app/identity";
import { api, request, resetCSRF } from "@/lib/api";
import { authHref, returnTarget } from "@/lib/navigation";
import { TextControl } from "@/components/platform/form-controls";
import { useFormErrors } from "@/components/platform/use-form-errors";
import { useSubmission } from "@/components/platform/use-submission";
import { ErrorBox } from "@/components/platform/feedback";
import { Button } from "@/components/ui/button";
import {
  validateUsername,
  validateDisplayName,
  validatePassword,
  passwordHelp,
  usernameHelp,
} from "@/shared/validation";
import { PublicFrame } from "./PublicFrame";
export async function loader({ request: req }: LoaderFunctionArgs) {
  const url = new URL(req.url),
    target = returnTarget(url),
    page = url.pathname.split("/").filter(Boolean).pop();
  const { setup, identity } = await readIdentity();
  if (setup !== "ready") throw redirectDocument(authHref("/setup", target));
  if (identity?.session.require_password_change && page !== "required-password")
    throw redirectDocument(authHref("/required-password", target));
  if (identity && !identity.session.require_password_change)
    throw redirectDocument(new URL(target, url.origin).href);
  if (!identity && page === "required-password")
    throw redirectDocument(authHref("/login", target));
  const settings =
    identity?.settings ?? (await api<Identity["settings"]>("/public/settings"));
  if (page === "register" && !settings.registration_enabled)
    throw redirectDocument(authHref("/login", target));
  return { page, target, settings };
}
export function Component() {
  const data = useLoaderData<typeof loader>();
  return <Credentials key={data.page} {...data} />;
}
function Credentials({
  page,
  target,
  settings,
}: Awaited<ReturnType<typeof loader>>) {
  const register = page === "register",
    change = page === "required-password";
  const [form, setForm] = useState({
    username: "",
    display_name: "",
    current_password: "",
    password: "",
    confirm: "",
  });
  const [forgot, setForgot] = useState(false);
  const errors = useFormErrors(),
    submission = useSubmission(),
    title = change ? "设置新密码" : register ? "创建账号" : "欢迎回来";
  const field = (
    key: keyof typeof form,
    label: string,
    autocomplete: string,
    secret = false,
  ) => (
    <TextControl
      required
      name={key}
      placeholder={
        key === "username"
          ? register
            ? "设置用于登录的用户名"
            : "请输入用户名"
          : key === "display_name"
            ? "你的姓名或常用称呼"
            : key === "confirm"
              ? "再次输入密码"
              : key === "password" && !register && !change
                ? "请输入密码"
                : undefined
      }
      label={label}
      value={form[key]}
      type={secret ? "password" : "text"}
      autoComplete={autocomplete}
      hint={
        key === "password" && (change || register)
          ? passwordHelp
          : key === "username" && register
            ? usernameHelp
            : undefined
      }
      error={errors.fields[key]}
      onValue={(value) => {
        setForm((old) => ({ ...old, [key]: value }));
        errors.setFields((old) => ({ ...old, [key]: "" }));
      }}
    />
  );
  async function submit() {
    errors.clear();
    if (
      !errors.validate({
        username: change
          ? ""
          : register
            ? validateUsername(form.username)
            : form.username
              ? ""
              : "请输入用户名。",
        display_name: register ? validateDisplayName(form.display_name) : "",
        current_password:
          change && !form.current_password ? "请输入当前密码。" : "",
        password:
          register || change
            ? validatePassword(form.password)
            : form.password
              ? ""
              : "请输入密码。",
        confirm:
          (register || change) && form.password !== form.confirm
            ? "两次输入的密码不一致。"
            : "",
      })
    )
      return;
    await submission.submit(
      async () => {
        let destination = target;
        if (change) {
          await request("/account/password", {
            method: "PUT",
            body: {
              current_password: form.current_password,
              new_password: form.password,
            },
          });
          destination = authHref("/login", target);
        } else {
          const session = await api<Session>(
            register ? "/auth/register" : "/auth/login",
            {
              username: form.username,
              password: form.password,
              ...(register ? { display_name: form.display_name } : {}),
            },
          );
          if (session.require_password_change)
            destination = authHref("/required-password", target);
        }
        resetCSRF();
        invalidateIdentity();
        window.location.replace(destination);
      },
      (e) => errors.show(e, Object.keys(form), { new_password: "password" }),
    );
  }
  return (
    <PublicFrame
      title={title}
      signIn={!change}
      site={settings.site_name}
      intro={
        change
          ? "首次使用此账号需更新密码。保存后请用新密码重新登录。"
          : register
            ? "填写账号信息，加入当前协作空间。"
            : "使用你的平台账号继续。"
      }
    >
      <form
        ref={errors.formRef}
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <fieldset
          disabled={submission.pending || submission.blocked}
          className="space-y-4"
        >
          <ErrorBox>{errors.error}</ErrorBox>
          {register && field("display_name", "显示名称", "nickname")}
          {!change && field("username", "用户名", "username")}
          {change &&
            field("current_password", "当前密码", "current-password", true)}
          {field(
            "password",
            change ? "新密码" : "密码",
            change || register ? "new-password" : "current-password",
            true,
          )}
          {(register || change) &&
            field("confirm", "确认密码", "new-password", true)}
          {!register && !change && (
            <div className="text-right">
              <button
                type="button"
                className="text-sm text-muted-foreground hover:underline"
                onClick={() => setForgot(!forgot)}
                aria-expanded={forgot}
              >
                忘记密码？
              </button>
              {forgot && (
                <p role="status" className="mt-2 text-left text-sm">
                  请联系管理员重置密码。创始人需由部署维护者协助恢复。
                </p>
              )}
            </div>
          )}
          <Button className="w-full" type="submit">
            {submission.pending
              ? "正在提交…"
              : change
                ? "保存新密码"
                : register
                  ? "创建账号"
                  : "登录"}
          </Button>
        </fieldset>
      </form>
      {submission.blocked && (
        <a
          href={authHref("/login", target)}
          className="mt-4 block text-sm underline"
        >
          重新核对登录状态
        </a>
      )}
      {!change && settings.registration_enabled && (
        <a
          className="mt-5 block text-center text-sm text-primary underline-offset-4 hover:underline"
          href={authHref(register ? "/login" : "/register", target)}
        >
          {register ? "已有账号，前往登录" : "注册新账号"}
        </a>
      )}
      {change && (
        <button
          className="mt-4 text-sm underline"
          disabled={submission.pending}
          onClick={() =>
            void submission.submit(
              async () => {
                await api("/auth/logout", {});
                resetCSRF();
                window.location.replace(authHref("/login", target));
              },
              (e) => errors.show(e, []),
            )
          }
        >
          退出登录
        </button>
      )}
    </PublicFrame>
  );
}
