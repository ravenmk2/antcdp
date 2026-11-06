import { TableToolbar } from "@/components/table-toolbar";
import { useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { KeyRound, Plus, Shield, Trash2 } from "lucide-react";
import { z } from "zod";
import { request } from "@/api/client";
import { useSession } from "@/app/auth";
import { Avatar } from "@/components/resource-icon";
import { Button, IconButton } from "@/components/button";
import {
  AsyncBoundary,
  ErrorNotice,
  Notice,
  StatusBadge,
} from "@/components/feedback";
import {
  Field,
  Input,
  Select,
  StandaloneInput,
  StandaloneSelect,
} from "@/components/fields";
import { ImageEditor, type ImageValue } from "@/components/image-editor";
import { PageHeader } from "@/components/layout";
import { Modal } from "@/components/overlays";
import { Pagination } from "@/components/pagination";
import { DataTable, type DataColumn } from "@/components/table";
import { useApiQuery } from "@/hooks/use-api";
import { useFormErrors, useSubmission } from "@/hooks/use-form";
import { usePageSize } from "@/hooks/use-page-size";
import { useDebouncedSearch } from "@/hooks/use-search";
import { formatDate } from "@/lib/utils";
import type { User } from "@/types/auth";
import {
  displayNameSchema,
  passwordSchema,
  usernameSchema,
} from "@/domain/validation";

interface Counts {
  users_total: number;
  users_active: number;
  users_disabled: number;
}
type Action = "create" | "edit" | "role" | "status" | "password" | "delete";

export function UsersPage() {
  const session = useSession();
  const [params, setParams] = useSearchParams();
  const [preferredSize, setPreferredSize] = usePageSize("users", 10);
  const q = params.get("q") ?? "";
  const status = params.get("status") ?? "";
  const identity = params.get("identity") ?? "";
  const page = Math.max(1, Number(params.get("page")) || 1);
  const size = [10, 20, 50, 100].includes(Number(params.get("page_size")))
    ? Number(params.get("page_size"))
    : preferredSize;
  const [action, setAction] = useState<{ type: Action; user?: User } | null>(
    params.get("create") === "1" ? { type: "create" } : null,
  );
  const queryClient = useQueryClient();
  const list = useApiQuery<User[]>(
    ["users", q, status, identity, page, size],
    `/admin/users?${new URLSearchParams({ q, status, identity, page: String(page), page_size: String(size) })}`,
  );
  const counts = useApiQuery<Counts>(["admin-overview"], "/admin/overview");
  const search = useDebouncedSearch(q, (value) => filter({ q: value }));
  function filter(values: Record<string, string>) {
    setParams((current) => {
      const next = new URLSearchParams(current);
      next.set("page", "1");
      next.delete("create");
      for (const [key, value] of Object.entries(values)) {
        if (value) next.set(key, value);
        else next.delete(key);
      }
      return next;
    });
  }
  async function saved() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["users"] }),
      queryClient.invalidateQueries({ queryKey: ["admin-overview"] }),
      queryClient.invalidateQueries({ queryKey: ["session"] }),
    ]);
    setAction(null);
  }
  const columns = useMemo<DataColumn<User>[]>(
    () => [
      {
        id: "user",
        header: "用户",
        cell: ({ row }) => (
          <div className="flex min-w-48 items-center gap-3">
            <Avatar
              url={row.original.avatar?.url}
              name={row.original.display_name}
            />
            <div>
              <strong className="text-foreground">
                {row.original.display_name}
              </strong>
              {row.original.id === session.user.id && (
                <span className="ml-2 text-xs text-muted">你</span>
              )}
              <small className="block text-muted">
                @{row.original.username}
              </small>
            </div>
          </div>
        ),
      },
      {
        id: "role",
        header: "身份",
        cell: ({ row }) => (
          <StatusBadge
            tone={
              row.original.is_founder
                ? "warning"
                : row.original.role === "admin"
                  ? "info"
                  : "neutral"
            }
          >
            {row.original.is_founder
              ? "创始人"
              : row.original.role === "admin"
                ? "管理员"
                : "普通用户"}
          </StatusBadge>
        ),
      },
      {
        id: "status",
        header: "状态",
        cell: ({ row }) => (
          <StatusBadge
            tone={row.original.status === "active" ? "success" : "neutral"}
          >
            {row.original.status === "active" ? "正常" : "已禁用"}
          </StatusBadge>
        ),
      },
      {
        id: "created",
        header: "创建时间",
        cell: ({ row }) => (
          <span className="text-xs text-muted">
            {formatDate(row.original.created_at)}
          </span>
        ),
      },
      {
        id: "login",
        header: "最近登录",
        cell: ({ row }) => (
          <span className="text-xs text-muted">
            {formatDate(row.original.last_login_at)}
          </span>
        ),
      },
      {
        id: "actions",
        header: "操作",
        cell: ({ row }) => (
          <div className="flex justify-end gap-1">
            <Button
              size="sm"
              variant="ghost"
              disabled={
                row.original.is_founder && row.original.id !== session.user.id
              }
              onClick={() => setAction({ type: "edit", user: row.original })}
            >
              编辑
            </Button>
            {!row.original.is_founder &&
              row.original.id !== session.user.id && (
                <UserMenu
                  user={row.original}
                  onAction={(type) => setAction({ type, user: row.original })}
                />
              )}
          </div>
        ),
      },
    ],
    [session.user.id],
  );
  return (
    <div className="page">
      <PageHeader
        title="用户管理"
        description="创建账号、维护资料与身份，执行状态、密码和逻辑删除操作。"
      />
      <section className="panel">
        <TableToolbar
          onReset={() => {
            search.setValue("");
            filter({ q: "", status: "", identity: "" });
          }}
          onRefresh={() => void list.refetch()}
          refreshing={list.isFetching}
          actions={
            <Button onClick={() => setAction({ type: "create" })}>
              <Plus />
              添加用户
            </Button>
          }
        >
          <form
            className="flex shrink-0 items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (!search.composing.current) search.submit();
            }}
          >
            <StandaloneInput
              name="q"
              aria-label="搜索用户"
              value={search.value}
              onChange={(event) => search.setValue(event.target.value)}
              onCompositionStart={() => {
                search.composing.current = true;
              }}
              onCompositionEnd={search.compositionEnd}
              placeholder="搜索用户名或显示名称"
            />
          </form>
          <StandaloneSelect
            aria-label="用户状态"
            value={status}
            onValueChange={(value) => filter({ status: value })}
          >
            <option value="">
              全部 · {counts.data?.data.users_total ?? "—"}
            </option>
            <option value="active">
              正常 · {counts.data?.data.users_active ?? "—"}
            </option>
            <option value="disabled">
              禁用 · {counts.data?.data.users_disabled ?? "—"}
            </option>
          </StandaloneSelect>
          <StandaloneSelect
            aria-label="用户身份"
            value={identity}
            onValueChange={(value) => filter({ identity: value })}
          >
            <option value="">全部身份</option>
            <option value="founder">创始人</option>
            <option value="admin">管理员</option>
            <option value="user">普通用户</option>
          </StandaloneSelect>
        </TableToolbar>
        <AsyncBoundary
          loading={list.isPending}
          error={list.error}
          onRetry={() => void list.refetch()}
          empty={!list.data?.data.length}
          emptyTitle="没有找到匹配的用户"
        >
          {list.data && (
            <DataTable
              data={list.data.data}
              columns={columns}
              rowKey={(row) => row.id}
              label="用户管理"
            />
          )}
        </AsyncBoundary>
        {list.data && (
          <Pagination
            page={page}
            size={size}
            total={list.data.pagination?.total ?? 0}
            pending={list.isFetching}
            onChange={(nextPage, nextSize) => {
              if (nextSize !== size) setPreferredSize(nextSize);
              setParams((current) => {
                const next = new URLSearchParams(current);
                next.set("page", String(nextPage));
                next.set("page_size", String(nextSize));
                return next;
              });
            }}
          />
        )}
      </section>
      {action &&
        (action.type === "create" ? (
          <UserEditor onClose={() => setAction(null)} onSaved={saved} />
        ) : (
          action.user && (
            <UserAction
              action={action.type}
              user={action.user}
              onClose={() => setAction(null)}
              onSaved={saved}
            />
          )
        ))}
    </div>
  );
}

function UserMenu({
  user,
  onAction,
}: {
  user: User;
  onAction: (action: Action) => void;
}) {
  return (
    <div className="flex gap-1">
      <Button size="sm" variant="ghost" onClick={() => onAction("role")}>
        <Shield />
        {user.role === "admin" ? "取消管理员" : "设为管理员"}
      </Button>
      <Button size="sm" variant="ghost" onClick={() => onAction("status")}>
        {user.status === "active" ? "禁用" : "启用"}
      </Button>
      <IconButton
        size="iconSm"
        label={`重置 ${user.display_name} 密码`}
        onClick={() => onAction("password")}
      >
        <KeyRound />
      </IconButton>
      <IconButton
        size="iconSm"
        label={`删除 ${user.display_name}`}
        onClick={() => onAction("delete")}
      >
        <Trash2 />
      </IconButton>
    </div>
  );
}

const userSchema = z
  .object({
    username: usernameSchema,
    display_name: displayNameSchema,
    role: z.enum(["user", "admin"]),
    password: passwordSchema,
    confirm: z.string(),
  })
  .refine((value) => value.password === value.confirm, {
    path: ["confirm"],
    message: "两次输入的密码不一致",
  });
function UserEditor({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [form, setForm] = useState({
    username: "",
    display_name: "",
    role: "user" as "user" | "admin",
    password: "",
    confirm: "",
  });
  const [avatar, setAvatar] = useState<ImageValue | null | undefined>(
    undefined,
  );
  const errors = useFormErrors();
  const submission = useSubmission();
  async function save() {
    const result = userSchema.safeParse(form);
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
        await request("/admin/users", {
          method: "POST",
          body: {
            username: form.username,
            display_name: form.display_name.trim(),
            role: form.role,
            password: form.password,
            ...(avatar ? { avatar_upload_id: avatar.id } : {}),
          },
        });
        await onSaved();
      },
      (error) =>
        errors.show(error, ["username", "display_name", "role", "password"], {
          new_password: "password",
        }),
    );
  }
  return (
    <Modal
      open
      wide
      title="创建用户"
      description="创建后用户首次登录必须修改密码"
      pending={submission.pending}
      dirty
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button pending={submission.pending} onClick={() => void save()}>
            创建用户
          </Button>
        </>
      }
    >
      <form
        ref={errors.formRef}
        className="grid gap-4"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <ErrorNotice error={errors.error} />
        <ImageEditor kind="avatar" value={avatar} onChange={setAvatar} />
        <div className="form-grid">
          <Field label="用户名" required error={errors.fields.username}>
            <Input
              name="username"
              autoComplete="off"
              value={form.username}
              onChange={(event) =>
                setForm({ ...form, username: event.target.value })
              }
            />
          </Field>
          <Field label="显示名称" required error={errors.fields.display_name}>
            <Input
              name="display_name"
              autoComplete="off"
              value={form.display_name}
              onChange={(event) =>
                setForm({ ...form, display_name: event.target.value })
              }
            />
          </Field>
          <Field label="系统身份" required>
            <Select
              value={form.role}
              onValueChange={(value) =>
                setForm({
                  ...form,
                  role: value as "user" | "admin",
                })
              }
            >
              <option value="user">普通用户</option>
              <option value="admin">管理员</option>
            </Select>
          </Field>
          <Field label="初始密码" required error={errors.fields.password}>
            <Input
              name="password"
              type="password"
              autoComplete="new-password"
              value={form.password}
              onChange={(event) =>
                setForm({ ...form, password: event.target.value })
              }
            />
          </Field>
          <Field label="确认密码" required error={errors.fields.confirm}>
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
        </div>
      </form>
    </Modal>
  );
}

function UserAction({
  action,
  user,
  onClose,
  onSaved,
}: {
  action: Exclude<Action, "create">;
  user: User;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const detail = useApiQuery<User>(
    ["user", user.id],
    `/admin/users/${user.id}`,
  );
  if (detail.isPending)
    return (
      <Modal open title="读取用户" onClose={onClose}>
        <AsyncBoundary loading />
      </Modal>
    );
  if (detail.error)
    return (
      <Modal open title="无法读取用户" onClose={onClose}>
        <ErrorNotice error={detail.error} />
      </Modal>
    );
  if (action === "edit")
    return (
      <EditUser
        user={detail.data.data}
        etag={detail.data.etag}
        onClose={onClose}
        onSaved={onSaved}
      />
    );
  return (
    <SimpleUserAction
      action={action}
      user={detail.data.data}
      etag={detail.data.etag}
      onClose={onClose}
      onSaved={onSaved}
    />
  );
}

function EditUser({
  user,
  etag,
  onClose,
  onSaved,
}: {
  user: User;
  etag: string;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [form, setForm] = useState({
    username: user.username,
    display_name: user.display_name,
  });
  const [avatar, setAvatar] = useState<ImageValue | null | undefined>(
    undefined,
  );
  const errors = useFormErrors();
  const submission = useSubmission();
  const dirty =
    JSON.stringify(form) !==
      JSON.stringify({
        username: user.username,
        display_name: user.display_name,
      }) || avatar !== undefined;
  async function save() {
    await submission.run(
      async () => {
        await request(`/admin/users/${user.id}`, {
          method: "PATCH",
          etag,
          body: {
            ...form,
            display_name: form.display_name.trim(),
            ...(avatar === undefined
              ? {}
              : { avatar_upload_id: avatar?.id ?? null }),
          },
        });
        await onSaved();
      },
      (error) => errors.show(error, ["username", "display_name"]),
    );
  }
  return (
    <Modal
      open
      wide
      title="编辑用户"
      description={`@${user.username}`}
      dirty={dirty}
      pending={submission.pending}
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button pending={submission.pending} onClick={() => void save()}>
            保存更改
          </Button>
        </>
      }
    >
      <form
        ref={errors.formRef}
        className="grid gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <ErrorNotice error={errors.error} />
        <ErrorNotice error={submission.error} />
        <ImageEditor
          kind="avatar"
          current={user.avatar?.url}
          value={avatar}
          onChange={setAvatar}
        />
        <Field label="用户名" required error={errors.fields.username}>
          <Input
            name="username"
            value={form.username}
            onChange={(event) =>
              setForm({ ...form, username: event.target.value })
            }
          />
        </Field>
        <Field label="显示名称" required error={errors.fields.display_name}>
          <Input
            name="display_name"
            value={form.display_name}
            onChange={(event) =>
              setForm({ ...form, display_name: event.target.value })
            }
          />
        </Field>
      </form>
    </Modal>
  );
}

function SimpleUserAction({
  action,
  user,
  etag,
  onClose,
  onSaved,
}: {
  action: "role" | "status" | "password" | "delete";
  user: User;
  etag: string;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const errors = useFormErrors();
  const submission = useSubmission();
  const title =
    action === "role"
      ? user.role === "admin"
        ? "取消管理员身份"
        : "设为管理员"
      : action === "status"
        ? user.status === "active"
          ? "禁用用户"
          : "启用用户"
        : action === "password"
          ? "重置密码"
          : "删除用户";
  async function save() {
    if (
      action === "password" &&
      (password.length < 8 ||
        new TextEncoder().encode(password).length > 72 ||
        password !== confirm)
    ) {
      errors.validate({
        password:
          password.length < 8
            ? "密码至少 8 个字符"
            : new TextEncoder().encode(password).length > 72
              ? "密码不能超过 72 个 UTF-8 字节"
              : "",
        confirm: password !== confirm ? "两次输入的密码不一致" : "",
      });
      return;
    }
    if (action === "delete" && confirmation !== user.username) {
      errors.validate({ confirmation: "请输入完全一致的用户名" });
      return;
    }
    await submission.run(
      async () => {
        const path = `/admin/users/${user.id}${action === "role" || action === "status" || action === "password" ? `/${action}` : ""}`;
        await request(path, {
          method: action === "delete" ? "DELETE" : "PUT",
          etag,
          ...(action === "delete"
            ? { headers: { "X-Confirm-Username": confirmation } }
            : {}),
          body:
            action === "role"
              ? { role: user.role === "admin" ? "user" : "admin" }
              : action === "status"
                ? { status: user.status === "active" ? "disabled" : "active" }
                : action === "password"
                  ? { new_password: password }
                  : undefined,
        });
        await onSaved();
      },
      (error) =>
        errors.show(error, ["password", "confirm", "confirmation"], {
          new_password: "password",
        }),
    );
  }
  return (
    <Modal
      open
      title={title}
      description={`${user.display_name} · @${user.username}`}
      pending={submission.pending}
      dirty={action === "password" || action === "delete"}
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button
            variant={action === "delete" ? "danger" : "default"}
            pending={submission.pending}
            onClick={() => void save()}
          >
            {title}
          </Button>
        </>
      }
    >
      <form
        ref={errors.formRef}
        className="grid gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <ErrorNotice error={errors.error} />
        <ErrorNotice error={submission.error} />
        <Notice tone={action === "delete" ? "danger" : "warning"}>
          {action === "delete"
            ? "逻辑删除无法从界面恢复，用户名不可复用；会话与凭证将被撤销。"
            : action === "password"
              ? "重置后撤销全部会话，并强制用户下次登录改密。"
              : "此操作会撤销目标用户的既有会话。"}
        </Notice>
        {action === "password" && (
          <>
            <Field label="新密码" required error={errors.fields.password}>
              <Input
                name="password"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </Field>
            <Field label="确认密码" required error={errors.fields.confirm}>
              <Input
                name="confirm"
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(event) => setConfirm(event.target.value)}
              />
            </Field>
          </>
        )}
        {action === "delete" && (
          <Field
            label={`输入用户名 ${user.username}`}
            required
            error={errors.fields.confirmation}
          >
            <Input
              name="confirmation"
              autoComplete="off"
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
            />
          </Field>
        )}
      </form>
    </Modal>
  );
}
