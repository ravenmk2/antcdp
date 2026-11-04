import { useRef, useState } from "react";
import type { User } from "@/app/identity";
import { useIdentity } from "@/app/identity";
import { request, ApiError } from "@/lib/api";
import {
  validateUsername,
  validateDisplayName,
  validatePassword,
  usernameHelp,
  passwordHelp,
} from "@/shared/validation";
import { FormDialog } from "@/components/platform/form-dialog";
import { Field } from "@/components/platform/field";
import { useFormErrors } from "@/components/platform/use-form-errors";
import { ErrorBox } from "@/components/platform/feedback";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AvatarEditor, type AvatarHandle } from "@/features/media/AvatarEditor";

export type UserAction =
  "create" | "edit" | "password" | "role" | "status" | "delete";
export type EditTarget = { mode: UserAction; user?: User; etag?: string };
export function UserEditor({
  target,
  onClose,
  onSaved,
}: {
  target: EditTarget;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const { mode, user, etag } = target;
  const identity = useIdentity();
  const initial = {
    username: user?.username || "",
    display_name: user?.display_name || "",
    role: "user",
    password: "",
    confirm: "",
    confirmation: "",
  };
  const [form, setForm] = useState(initial);
  const [avatar, setAvatar] = useState<string | null>();
  const avatarRef = useRef<AvatarHandle>(null);
  const [processing, setProcessing] = useState(false);
  const [busy, setBusy] = useState(false);
  const locked = useRef(false);
  const errors = useFormErrors();
  const [conflict, setConflict] = useState(false);
  const [unknown, setUnknown] = useState(false);
  const info = mode === "create" || mode === "edit";
  const password = mode === "create" || mode === "password";
  const self = user?.id === identity.session.user.id;
  const allowed =
    identity.session.user.role === "admin" &&
    (mode === "create" ||
      (!!user &&
        (mode === "edit"
          ? !user.is_founder || self
          : !user.is_founder && !self)));
  const dirty =
    JSON.stringify(form) !== JSON.stringify(initial) || avatar !== undefined;
  const labels = {
    create: "创建用户",
    edit: "编辑用户",
    password: "重置密码",
    delete: "删除用户",
    role: user?.role === "admin" ? "取消管理员身份" : "设为管理员",
    status: user?.status === "active" ? "禁用用户" : "启用用户",
  };
  function update(key: keyof typeof form, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
    errors.setFields((f) => ({ ...f, [key]: "" }));
  }
  async function save() {
    if (locked.current || processing || !allowed || conflict || unknown) return;
    errors.clear();
    const fields: Record<string, string> = {};
    if (info) {
      fields.username = validateUsername(form.username);
      fields.display_name = validateDisplayName(form.display_name);
    }
    if (password) {
      fields.password = validatePassword(form.password);
      if (form.password !== form.confirm)
        fields.confirm = "两次输入的密码不一致。";
    }
    if (mode === "delete" && form.confirmation !== user?.username)
      fields.confirmation = "请输入完全一致的用户名。";
    if (!errors.validate(fields)) return;
    if (mode !== "create" && !etag) {
      errors.setError("用户版本信息缺失，请重新打开后操作。");
      return;
    }
    locked.current = true;
    setBusy(true);
    const avatarBody = avatar === undefined ? {} : { avatar_upload_id: avatar };
    try {
      const path = `/admin/users/${user?.id}`;
      if (mode === "create")
        await request("/admin/users", {
          method: "POST",
          body: {
            username: form.username,
            display_name: form.display_name,
            role: form.role,
            password: form.password,
            ...avatarBody,
          },
        });
      else if (mode === "edit")
        await request(path, {
          method: "PATCH",
          etag,
          body: {
            username: form.username,
            display_name: form.display_name,
            ...avatarBody,
          },
        });
      else if (mode === "password")
        await request(`${path}/password`, {
          method: "PUT",
          etag,
          body: { new_password: form.password },
        });
      else if (mode === "delete")
        await request(path, {
          method: "DELETE",
          etag,
          headers: { "X-Confirm-Username": form.confirmation },
        });
      else if (mode === "role")
        await request(`${path}/role`, {
          method: "PUT",
          etag,
          body: { role: user!.role === "admin" ? "user" : "admin" },
        });
      else
        await request(`${path}/status`, {
          method: "PUT",
          etag,
          body: { status: user!.status === "active" ? "disabled" : "active" },
        });
      avatarRef.current?.saved();
      onSaved(
        password ? "操作已完成，用户下次登录需要修改密码。" : "操作已完成。",
      );
    } catch (e) {
      if (e instanceof ApiError) {
        setConflict(
          ["VERSION_CONFLICT", "PRECONDITION_FAILED"].includes(e.code),
        );
        setUnknown(
          ["NETWORK_ERROR", "INVALID_RESPONSE", "HTTP_ERROR"].includes(e.code),
        );
      }
      errors.show(
        e,
        [
          "username",
          "display_name",
          "role",
          "password",
          "confirm",
          "confirmation",
        ],
        { new_password: "password" },
      );
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  return (
    <FormDialog
      open
      compact={mode === "role" || mode === "status"}
      title={
        mode === "status" || mode === "role"
          ? labels[mode] + " · " + user?.display_name
          : labels[mode]
      }
      description={
        info
          ? "保存后生效，头像草稿不会提前替换原头像。"
          : mode === "delete"
            ? "删除后无法恢复，用户名不会释放。"
            : "此操作会撤销目标用户的现有登录会话。"
      }
      dirty={dirty}
      pending={busy || processing}
      onClose={onClose}
      footer={(close) => (
        <>
          <Button
            variant="outline"
            disabled={busy || processing}
            onClick={close}
          >
            取消
          </Button>
          <Button
            type="submit"
            form="user-editor"
            variant={mode === "delete" ? "destructive" : "default"}
            disabled={busy || processing || !allowed || conflict || unknown}
          >
            {busy ? "正在保存…" : labels[mode]}
          </Button>
        </>
      )}
    >
      <ErrorBox>
        {!allowed ? "当前身份不能对该用户执行此操作。" : errors.error}
      </ErrorBox>
      {conflict && (
        <p role="alert" className="text-sm">
          该记录已被其他操作更新。草稿已保留，请记录需要的修改并关闭，重新打开最新记录后操作。
        </p>
      )}
      {unknown && (
        <p role="alert" className="text-sm">
          请求结果尚未确认，请关闭并刷新用户列表核实，避免重复提交；重置密码需核实后重新发起明确操作。
        </p>
      )}
      <form
        id="user-editor"
        ref={errors.formRef}
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
        className="space-y-5"
      >
        <fieldset disabled={busy || !allowed} className="space-y-5">
          {info && (
            <>
              <AvatarEditor
                ref={avatarRef}
                avatar={user?.avatar}
                value={avatar}
                onChange={setAvatar}
                onProcessing={setProcessing}
                disabled={busy || !allowed}
              />
              <div className="grid gap-5 sm:grid-cols-2">
                <Field
                  label="显示名称"
                  required
                  error={errors.fields.display_name}
                >
                  {(props) => (
                    <Input
                      {...props}
                      value={form.display_name}
                      onChange={(e) => update("display_name", e.target.value)}
                      autoComplete="off"
                    />
                  )}
                </Field>
                <Field
                  label="用户名"
                  required
                  hint={usernameHelp}
                  error={errors.fields.username}
                >
                  {(props) => (
                    <Input
                      {...props}
                      value={form.username}
                      onChange={(e) => update("username", e.target.value)}
                      autoComplete="off"
                      autoCapitalize="none"
                      spellCheck={false}
                    />
                  )}
                </Field>
              </div>
              {mode === "create" && (
                <Field label="系统身份" required error={errors.fields.role}>
                  {(props) => (
                    <select
                      {...props}
                      value={form.role}
                      onChange={(e) => update("role", e.target.value)}
                      className="h-[var(--control-height)] w-full rounded-md border bg-background px-3"
                    >
                      <option value="user">普通用户</option>
                      <option value="admin">管理员</option>
                    </select>
                  )}
                </Field>
              )}
            </>
          )}
          {password && (
            <>
              <div className="grid gap-5 sm:grid-cols-2">
                <Field
                  label="密码"
                  required
                  hint={passwordHelp}
                  error={errors.fields.password}
                >
                  {(props) => (
                    <Input
                      {...props}
                      type="password"
                      autoComplete="new-password"
                      value={form.password}
                      onChange={(e) => update("password", e.target.value)}
                    />
                  )}
                </Field>
                <Field label="确认密码" required error={errors.fields.confirm}>
                  {(props) => (
                    <Input
                      {...props}
                      type="password"
                      autoComplete="new-password"
                      value={form.confirm}
                      onChange={(e) => update("confirm", e.target.value)}
                    />
                  )}
                </Field>
              </div>
              <p className="text-sm text-muted-foreground">
                用户下次登录必须修改密码，请通过合适的方式告知初始密码。
              </p>
            </>
          )}
          {mode === "delete" && (
            <Field
              label={`输入用户名 ${user?.username} 确认删除`}
              required
              error={errors.fields.confirmation}
            >
              {(props) => (
                <Input
                  {...props}
                  value={form.confirmation}
                  onChange={(e) => update("confirmation", e.target.value)}
                  autoComplete="off"
                />
              )}
            </Field>
          )}
        </fieldset>
      </form>
    </FormDialog>
  );
}
