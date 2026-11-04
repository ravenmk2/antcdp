import { useOperationToast } from "@/components/platform/operation-toast";
import { useRef, useState } from "react";
import { useLocation, useRevalidator } from "react-router";
import { useIdentity, invalidateIdentity, type User } from "@/app/identity";
import { identityLoader } from "@/lib/loaders";
import { request, resetCSRF } from "@/lib/api";
import { authHref } from "@/lib/navigation";
import { writeRequiresReview, writeReviewMessage } from "@/lib/write-error";
import { useDate } from "@/lib/date";
import {
  validateDisplayName,
  validatePassword,
  passwordHelp,
} from "@/shared/validation";
import { AccountFrame } from "./AccountFrame";
import { Field } from "@/components/platform/field";
import { useFormErrors } from "@/components/platform/use-form-errors";
import {
  useNavigationProtection,
  useNavigateAfterSave,
} from "@/components/platform/navigation-guard";
import { FormDialog } from "@/components/platform/form-dialog";
import { ErrorBox } from "@/components/platform/feedback";
import { Avatar } from "@/components/platform/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AvatarEditor, type AvatarHandle } from "@/features/media/AvatarEditor";
export const loader = identityLoader;
export function Component() {
  const identity = useIdentity(),
    location = useLocation(),
    date = useDate();
  const user = identity.session.user;
  const security = location.pathname.endsWith("/security");
  return (
    <AccountFrame>
      <h1 className="text-2xl font-semibold">
        {security ? "账号安全" : "个人资料"}
      </h1>
      <section className="max-w-3xl rounded-xl border bg-card p-5 sm:p-7">
        <div className="mb-6 flex items-center gap-4 border-b pb-6">
          {security && (
            <Avatar url={user.avatar?.url} name={user.display_name} large />
          )}
          <div>
            <h2 className="text-lg font-medium">{user.display_name}</h2>
            <p className="text-sm text-muted-foreground">
              @{user.username} ·{" "}
              {user.is_founder
                ? "创始人"
                : user.role === "admin"
                  ? "管理员"
                  : "普通用户"}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              加入于 {date(user.created_at)}
            </p>
          </div>
        </div>
        {security ? (
          <Security key={`security-${user.id}`} />
        ) : (
          <Profile key={user.id} initial={user} />
        )}
      </section>
    </AccountFrame>
  );
}
export function Profile({ initial }: { initial: User }) {
  const [saved, setSaved] = useState(initial),
    [name, setName] = useState(initial.display_name);
  const [avatar, setAvatar] = useState<string | null>(),
    [processing, setProcessing] = useState(false);
  const avatarRef = useRef<AvatarHandle>(null);
  const [avatarKey, setAvatarKey] = useState(0),
    [busy, setBusy] = useState(false),
    [blocked, setBlocked] = useState(false),
    notify = useOperationToast();
  const locked = useRef(false),
    errors = useFormErrors(),
    revalidator = useRevalidator();
  const dirty = name !== saved.display_name || avatar !== undefined;
  useNavigationProtection(
    busy || processing ? "pending" : dirty ? "dirty" : undefined,
  );
  async function save() {
    if (locked.current || processing || blocked) return;
    errors.clear();
    if (!errors.validate({ display_name: validateDisplayName(name) })) return;
    locked.current = true;
    setBusy(true);

    try {
      const result = await request<User>("/account", {
        method: "PATCH",
        etag: `"u-${saved.id}-v${saved.version}"`,
        body: {
          display_name: name,
          ...(avatar !== undefined ? { avatar_upload_id: avatar } : {}),
        },
      });
      avatarRef.current?.saved();
      setSaved(result.data);
      setName(result.data.display_name);
      setAvatar(undefined);
      setAvatarKey((k) => k + 1);
      notify("个人资料已保存。");
      invalidateIdentity();
      void revalidator.revalidate();
    } catch (e) {
      errors.show(e, ["display_name"]);
      setBlocked(writeRequiresReview(e));
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  return (
    <form
      ref={errors.formRef}
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
      className="max-w-xl space-y-6"
    >
      <ErrorBox>{errors.error}</ErrorBox>
      {blocked && (
        <p role="alert" className="text-sm">
          {writeReviewMessage}可通过页面刷新重新读取。
        </p>
      )}

      <AvatarEditor
        key={avatarKey}
        ref={avatarRef}
        avatar={saved.avatar}
        value={avatar}
        onChange={setAvatar}
        onProcessing={setProcessing}
        disabled={busy}
      />
      <Field label="显示名称" required error={errors.fields.display_name}>
        {(props) => (
          <Input
            {...props}
            name="display-name"
            autoComplete="nickname"
            value={name}
            disabled={busy}
            onChange={(e) => {
              setName(e.target.value);
              errors.setFields({});
            }}
          />
        )}
      </Field>
      <Field label="用户名" hint="用户名用于登录，由管理员维护。">
        {(props) => (
          <Input
            {...props}
            readOnly
            value={saved.username}
            autoComplete="username"
          />
        )}
      </Field>
      <div className="flex flex-wrap items-center justify-between gap-4 border-t pt-5">
        <span className="text-sm text-muted-foreground">
          {dirty ? "有未保存的修改" : "资料已保存"}
        </span>
        <Button
          type="submit"
          disabled={busy || processing || blocked || !dirty}
        >
          {busy ? "正在保存…" : "保存资料"}
        </Button>
      </div>
    </form>
  );
}
function Security() {
  const { session } = useIdentity(),
    [open, setOpen] = useState(false);
  return (
    <div className="space-y-8">
      <section className="flex flex-wrap items-center justify-between gap-4 border-b pb-6">
        <div>
          <h2 className="font-medium">登录密码</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            修改密码后撤销已有会话，需要重新登录。
          </p>
        </div>
        <Button variant="outline" onClick={() => setOpen(true)}>
          修改密码
        </Button>
      </section>
      <section>
        <h2 className="font-medium">当前会话</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          闲置有效期 {session.session_ttl_days}{" "}
          天，有效访问时自动续期。可通过账号菜单退出登录。
        </p>
      </section>
      {open && <PasswordDialog onClose={() => setOpen(false)} />}
    </div>
  );
}
export function PasswordDialog({ onClose }: { onClose: () => void }) {
  const [form, setForm] = useState({
    current_password: "",
    new_password: "",
    confirm: "",
  });
  const [busy, setBusy] = useState(false),
    [blocked, setBlocked] = useState(false),
    locked = useRef(false),
    errors = useFormErrors();
  const afterSave = useNavigateAfterSave();
  async function save() {
    if (locked.current || blocked) return;
    errors.clear();
    if (
      !errors.validate({
        current_password: form.current_password ? "" : "请输入当前密码。",
        new_password: validatePassword(form.new_password),
        confirm:
          form.new_password === form.confirm ? "" : "两次输入的密码不一致。",
      })
    )
      return;
    locked.current = true;
    setBusy(true);
    try {
      await request("/account/password", {
        method: "PUT",
        body: {
          current_password: form.current_password,
          new_password: form.new_password,
        },
      });
      setForm({ current_password: "", new_password: "", confirm: "" });
      resetCSRF();
      invalidateIdentity();
      afterSave(authHref("/login"));
    } catch (e) {
      errors.show(e, ["current_password", "new_password", "confirm"]);
      setBlocked(writeRequiresReview(e));
      locked.current = false;
      setBusy(false);
    }
  }
  return (
    <FormDialog
      open
      title="修改密码"
      description="更新成功后需要使用新密码重新登录。"
      dirty={Object.values(form).some(Boolean)}
      pending={busy}
      onClose={onClose}
      footer={(close) => (
        <>
          <Button variant="outline" disabled={busy} onClick={close}>
            取消
          </Button>
          <Button
            form="account-password"
            type="submit"
            disabled={busy || blocked}
          >
            {busy ? "正在保存…" : "更新密码"}
          </Button>
        </>
      )}
    >
      <form
        id="account-password"
        ref={errors.formRef}
        className="space-y-5"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <ErrorBox>{errors.error}</ErrorBox>
        {blocked && (
          <p role="alert">{writeReviewMessage}请尝试重新登录以核实结果。</p>
        )}
        {(
          [
            ["current_password", "当前密码"],
            ["new_password", "新密码"],
            ["confirm", "确认新密码"],
          ] as const
        ).map(([key, label]) => (
          <Field
            key={key}
            label={label}
            required
            error={errors.fields[key]}
            hint={key === "new_password" ? passwordHelp : undefined}
          >
            {(props) => (
              <Input
                {...props}
                type="password"
                autoComplete={
                  key === "current_password"
                    ? "current-password"
                    : "new-password"
                }
                value={form[key]}
                disabled={busy}
                onChange={(e) => {
                  setForm((f) => ({ ...f, [key]: e.target.value }));
                  errors.setFields((f) => ({ ...f, [key]: "" }));
                }}
              />
            )}
          </Field>
        ))}
      </form>
    </FormDialog>
  );
}
