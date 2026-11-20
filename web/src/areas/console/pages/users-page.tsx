import { request } from "@/api/client";
import { useSession } from "@/app/auth";
import {
  ConsoleDialog,
  ConsoleDialogCancel,
} from "@/areas/console/components/dialog";
import { ConsoleListPage } from "@/areas/console/components/list-page";
import { Button } from "@/components/button";
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
import { PageHeader } from "@/components/layout";
import { Pagination } from "@/components/pagination";
import { Avatar } from "@/components/resource-icon";
import {
  RowAction,
  RowActions,
  RowActionSeparator,
} from "@/components/row-actions";
import { DataTable, type DataColumn } from "@/components/table";
import { TableToolbar } from "@/components/table-toolbar";
import {
  displayNameSchema,
  passwordSchema,
  usernameSchema,
} from "@/domain/validation";
import { ImageEditor, type ImageValue } from "@/features/media/image-editor";
import { useApiQuery } from "@/hooks/use-api";
import { useFormErrors, useSubmission } from "@/hooks/use-form";
import { usePageSize } from "@/hooks/use-page-size";
import { useDebouncedSearch } from "@/hooks/use-search";
import { formatDate } from "@/lib/utils";
import type { User } from "@/types/auth";
import { useQueryClient } from "@tanstack/react-query";
import {
  KeyRound,
  Pencil,
  Plus,
  Search,
  Shield,
  Trash2,
  UserCheck,
  UserRound,
  UserRoundPlus,
  UserX,
} from "lucide-react";
import { useId, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { z } from "zod";
import styles from "@/areas/console/styles/management.module.css";

interface Counts {
  users_total: number;
  users_active: number;
  users_disabled: number;
}
type Action = "create" | "edit" | "role" | "status" | "password" | "delete";

export function UsersPage() {
  const session = useSession();
  const heading = useRef<HTMLElement>(null);
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
    if (action?.user) {
      await queryClient.invalidateQueries({
        queryKey: ["user", action.user.id],
        refetchType: "none",
      });
    }
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
        cell: ({ row }) => {
          const user = row.original;
          const canEdit = !user.is_founder || user.id === session.user.id;
          return (
            <div className={styles.identity}>
              <Avatar
                className="size-8"
                url={user.avatar?.url}
                name={user.display_name}
              />
              <div className="min-w-0">
                <div className={styles.nameLine}>
                  {canEdit ? (
                    <button
                      type="button"
                      className={styles.nameButton}
                      title={user.display_name}
                      onClick={() => setAction({ type: "edit", user })}
                    >
                      {user.display_name}
                    </button>
                  ) : (
                    <strong
                      className={styles.nameButton}
                      title={user.display_name}
                    >
                      {user.display_name}
                    </strong>
                  )}
                  {user.id === session.user.id && (
                    <span className={styles.self}>你</span>
                  )}
                </div>
                <small className={styles.account} title={user.username}>
                  @{user.username}
                </small>
              </div>
            </div>
          );
        },
      },
      {
        id: "role",
        header: "身份",
        cell: ({ row }) => (
          <StatusBadge
            tone={row.original.role === "admin" ? "info" : "neutral"}
            className={
              row.original.is_founder
                ? "bg-(--role-founder-soft) text-(--role-founder)"
                : undefined
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
          <span className={styles.timestamp}>
            {formatDate(row.original.created_at)}
          </span>
        ),
      },
      {
        id: "login",
        header: "最近登录",
        cell: ({ row }) => (
          <span className={styles.timestamp}>
            {formatDate(row.original.last_login_at)}
          </span>
        ),
      },
      {
        id: "actions",
        header: "操作",
        cell: ({ row }) => (
          <RowActions
            label={row.original.display_name}
            disabled={
              row.original.is_founder && row.original.id !== session.user.id
            }
          >
            <RowAction
              icon={<Pencil />}
              disabled={
                row.original.is_founder && row.original.id !== session.user.id
              }
              onSelect={() => setAction({ type: "edit", user: row.original })}
            >
              编辑
            </RowAction>
            {!row.original.is_founder &&
              row.original.id !== session.user.id && (
                <UserMenu
                  user={row.original}
                  onAction={(type) => setAction({ type, user: row.original })}
                />
              )}
          </RowActions>
        ),
      },
    ],
    [session.user.id],
  );
  return (
    <ConsoleListPage className={styles.scope}>
      <PageHeader
        ref={heading}
        tabIndex={-1}
        title="用户管理"
        description="管理系统账号、管理员权限与登录状态。"
      />
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
          className={styles.search}
          onSubmit={(event) => {
            event.preventDefault();
            if (!search.composing.current) search.submit();
          }}
        >
          <Search aria-hidden />
          <StandaloneInput
            name="q"
            className="w-full ps-9"
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
            全部状态 · {counts.data?.data.users_total ?? "—"}
          </option>
          <option value="active">
            正常 · {counts.data?.data.users_active ?? "—"}
          </option>
          <option value="disabled">
            已禁用 · {counts.data?.data.users_disabled ?? "—"}
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
        emptyTitle={q || status || identity ? "没有匹配的用户" : "暂无用户"}
        emptyDescription={
          q || status || identity ? "请调整搜索或筛选条件。" : undefined
        }
      >
        {list.data && (
          <DataTable
            actionColumn="actions"
            data={list.data.data}
            columns={columns}
            rowKey={(row) => row.id}
            label="用户管理"
            className={styles.userTable}
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
            const header = heading.current;
            if (header && window.scrollY > 0) {
              header.focus({ preventScroll: true });
              header.scrollIntoView({ block: "start" });
            }
          }}
        />
      )}
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
    </ConsoleListPage>
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
    <>
      <RowAction icon={<Shield />} onSelect={() => onAction("role")}>
        {user.role === "admin" ? "取消管理员" : "设为管理员"}
      </RowAction>
      <RowAction
        icon={user.status === "active" ? <UserX /> : <UserCheck />}
        onSelect={() => onAction("status")}
      >
        {user.status === "active" ? "禁用" : "启用"}
      </RowAction>
      <RowAction icon={<KeyRound />} onSelect={() => onAction("password")}>
        重置密码
      </RowAction>
      <RowActionSeparator />
      <RowAction
        icon={<Trash2 />}
        variant="destructive"
        onSelect={() => onAction("delete")}
      >
        删除用户
      </RowAction>
    </>
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
  const formId = useId();
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
    <ConsoleDialog
      wide
      title="创建用户"
      icon={<UserRoundPlus />}
      description="新用户首次登录时需要更改初始密码。"
      pending={submission.pending}
      dirty={
        Boolean(
          form.username || form.display_name || form.password || form.confirm,
        ) ||
        form.role !== "user" ||
        avatar !== undefined
      }
      onClose={onClose}
      footer={
        <>
          <ConsoleDialogCancel pending={submission.pending} />
          <Button
            type="submit"
            form={formId}
            pending={submission.pending}
            disabled={submission.uncertain}
          >
            创建用户
          </Button>
        </>
      }
    >
      <form
        id={formId}
        ref={errors.formRef}
        className={`${styles.scope} ${styles.form}`}
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <ErrorNotice error={errors.error || submission.error} />
        <fieldset disabled={submission.pending} className={styles.formSection}>
          <legend>账号资料</legend>
          <div className={styles.profileFields}>
            <div className={styles.formGrid}>
              <Field label="用户名" required error={errors.fields.username}>
                <Input
                  name="username"
                  data-console-initial-focus
                  autoComplete="off"
                  value={form.username}
                  onChange={(event) =>
                    setForm({ ...form, username: event.target.value })
                  }
                />
              </Field>
              <Field
                label="显示名称"
                required
                error={errors.fields.display_name}
              >
                <Input
                  name="display_name"
                  autoComplete="off"
                  value={form.display_name}
                  onChange={(event) =>
                    setForm({ ...form, display_name: event.target.value })
                  }
                />
              </Field>
              <Field
                label="系统身份"
                required
                className={styles.fullField}
                error={errors.fields.role}
              >
                <Select
                  name="role"
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
            </div>
            <div className={styles.avatarEditor}>
              <span className={styles.fieldLabel}>头像（可选）</span>
              <ImageEditor kind="avatar" value={avatar} onChange={setAvatar} />
            </div>
          </div>
        </fieldset>
        <fieldset disabled={submission.pending} className={styles.formSection}>
          <legend>登录凭证</legend>
          <div className={styles.formGrid}>
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
        </fieldset>
      </form>
    </ConsoleDialog>
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
  const [restoreFocusTo] = useState(() =>
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null,
  );
  const detail = useApiQuery<User>(
    ["user", user.id],
    `/admin/users/${user.id}`,
    { staleTime: 0 },
  );
  // Never initialize a form or derive a toggle from a previous opening's cache.
  if (detail.isPending || !detail.isFetchedAfterMount)
    return (
      <ConsoleDialog
        restoreFocusTo={restoreFocusTo}
        title="读取用户"
        onClose={onClose}
      >
        <AsyncBoundary loading />
      </ConsoleDialog>
    );
  if (detail.error)
    return (
      <ConsoleDialog
        restoreFocusTo={restoreFocusTo}
        title="无法读取用户"
        onClose={onClose}
      >
        <ErrorNotice error={detail.error} />
        <Button variant="outline" onClick={() => void detail.refetch()}>
          重新加载
        </Button>
      </ConsoleDialog>
    );
  if (action === "edit")
    return (
      <EditUser
        restoreFocusTo={restoreFocusTo}
        user={detail.data.data}
        etag={detail.data.etag}
        onClose={onClose}
        onSaved={onSaved}
      />
    );
  return (
    <SimpleUserAction
      restoreFocusTo={restoreFocusTo}
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
  restoreFocusTo,
}: {
  user: User;
  etag: string;
  onClose: () => void;
  onSaved: () => Promise<void>;
  restoreFocusTo: HTMLElement | null;
}) {
  const formId = useId();
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
    <ConsoleDialog
      restoreFocusTo={restoreFocusTo}
      wide
      title="编辑用户"
      icon={<UserRound />}
      description={`@${user.username}`}
      dirty={dirty}
      pending={submission.pending}
      onClose={onClose}
      footer={
        <>
          <ConsoleDialogCancel pending={submission.pending} />
          <Button
            type="submit"
            form={formId}
            pending={submission.pending}
            disabled={submission.uncertain}
          >
            保存更改
          </Button>
        </>
      }
    >
      <form
        id={formId}
        ref={errors.formRef}
        className={`${styles.scope} ${styles.form}`}
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <ErrorNotice error={errors.error || submission.error} />
        <fieldset disabled={submission.pending} className={styles.formSection}>
          <legend>账号资料</legend>
          <div className={styles.profileFields}>
            <div className={styles.formGrid}>
              <Field label="用户名" required error={errors.fields.username}>
                <Input
                  name="username"
                  data-console-initial-focus
                  value={form.username}
                  onChange={(event) =>
                    setForm({ ...form, username: event.target.value })
                  }
                />
              </Field>
              <Field
                label="显示名称"
                required
                error={errors.fields.display_name}
              >
                <Input
                  name="display_name"
                  value={form.display_name}
                  onChange={(event) =>
                    setForm({ ...form, display_name: event.target.value })
                  }
                />
              </Field>
            </div>
            <div className={styles.avatarEditor}>
              <span className={styles.fieldLabel}>头像</span>
              <ImageEditor
                kind="avatar"
                current={user.avatar?.url}
                value={avatar}
                onChange={setAvatar}
              />
            </div>
          </div>
        </fieldset>
      </form>
    </ConsoleDialog>
  );
}

function SimpleUserAction({
  action,
  user,
  etag,
  onClose,
  onSaved,
  restoreFocusTo,
}: {
  action: "role" | "status" | "password" | "delete";
  user: User;
  etag: string;
  onClose: () => void;
  onSaved: () => Promise<void>;
  restoreFocusTo: HTMLElement | null;
}) {
  const formId = useId();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const errors = useFormErrors();
  const submission = useSubmission();
  const destructive = action === "delete";
  const consequential = destructive || action === "role" || action === "status";
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
    <ConsoleDialog
      restoreFocusTo={restoreFocusTo}
      title={title}
      tone={destructive ? "danger" : consequential ? "warning" : undefined}
      icon={
        destructive ? (
          <Trash2 />
        ) : action === "password" ? (
          <KeyRound />
        ) : undefined
      }
      description={`${user.display_name} · @${user.username}`}
      pending={submission.pending}
      dirty={
        action === "password"
          ? Boolean(password || confirm)
          : action === "delete"
            ? Boolean(confirmation)
            : false
      }
      onClose={onClose}
      footer={
        <>
          <ConsoleDialogCancel
            pending={submission.pending}
            initialFocus={consequential}
          />
          <Button
            variant={destructive ? "danger" : "default"}
            type="submit"
            form={formId}
            pending={submission.pending}
            disabled={submission.uncertain}
          >
            {title}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        ref={errors.formRef}
        className="grid gap-4"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <ErrorNotice error={errors.error || submission.error} />
        <Notice
          tone={
            destructive ? "danger" : action === "password" ? "info" : "warning"
          }
        >
          {destructive
            ? "删除后无法从界面恢复，用户名不可复用。该用户的会话与凭证将被撤销。"
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
                data-console-initial-focus
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
    </ConsoleDialog>
  );
}
