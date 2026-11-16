import { useId, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Trash2, Users } from "lucide-react";
import { isVersionConflict, request } from "@/api/client";
import { Button } from "@/components/button";
import { AsyncBoundary, ErrorNotice, StatusBadge } from "@/components/feedback";
import { Field, Input, Textarea } from "@/components/fields";
import {
  ConfirmDialog,
  Drawer,
  OverlayCancelButton,
} from "@/components/overlays";
import { OverlayPresence } from "@/components/overlay-presence";
import {
  RowAction,
  RowActionSeparator,
  RowActions,
} from "@/components/row-actions";
import { SimpleTable } from "@/components/table";
import { TableToolbar } from "@/components/table-toolbar";
import type { SelectableUser } from "@/components/user-picker";
import { useApiQuery } from "@/hooks/use-api";
import { useSubmission } from "@/hooks/use-form";
import { useUnsaved } from "@/hooks/use-unsaved";
import type {
  Resource,
  RoleDetail,
  RoleSummary,
  ScopedRole,
} from "@/types/collaboration";
import { ResourceUserPicker } from "./user-picker";

type Dialog =
  | { kind: "create" }
  | { kind: "edit" | "members" | "delete"; role: ScopedRole };

export function ProjectMemberRoles({ roles }: { roles?: RoleSummary[] }) {
  if (!roles?.length) return <span className="text-muted">—</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {roles.map((role) => (
        <StatusBadge key={role.id}>{role.name}</StatusBadge>
      ))}
    </div>
  );
}

export function ProjectRoles({ project }: { project: Resource }) {
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const queryClient = useQueryClient();
  const key = ["roles", "projects", project.id];
  const path = `/projects/${project.id}/roles`;
  const roles = useApiQuery<{ items: ScopedRole[] }>(key, path, {
    staleTime: 0,
  });
  const close = () => setDialog(null);
  async function saved() {
    close();
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: key }),
      queryClient.invalidateQueries({
        queryKey: ["members", "projects", project.id],
      }),
    ]);
  }
  async function reload() {
    const result = await roles.refetch();
    if (result.isSuccess) close();
  }
  const items = roles.data?.data.items ?? [];

  return (
    <section className="panel">
      <TableToolbar
        onRefresh={() => roles.refetch()}
        refreshing={roles.isFetching}
        actions={
          project.can_manage && (
            <Button onClick={() => setDialog({ kind: "create" })}>
              <Plus />
              新建角色
            </Button>
          )
        }
      />
      <AsyncBoundary
        loading={roles.isPending}
        error={roles.error}
        onRetry={() => void roles.refetch()}
        empty={items.length === 0}
        emptyTitle="暂无自定义角色"
      >
        <SimpleTable
          actions
          label={`${project.name}的自定义角色`}
          headers={["名称", "描述", "已分配人数", "操作"]}
        >
          {items.map((role) => (
            <tr key={role.id}>
              <td className="font-medium break-all">{role.name}</td>
              <td className="max-w-96 break-words whitespace-pre-wrap">
                {role.description || "—"}
              </td>
              <td>{role.member_count} 人</td>
              <td>
                <RowActions label={role.name}>
                  {project.can_manage && (
                    <RowAction
                      icon={<Pencil />}
                      onSelect={() => setDialog({ kind: "edit", role })}
                    >
                      编辑
                    </RowAction>
                  )}
                  <RowAction
                    icon={<Users />}
                    onSelect={() => setDialog({ kind: "members", role })}
                  >
                    {project.can_manage ? "管理成员" : "查看成员"}
                  </RowAction>
                  {project.can_manage && (
                    <>
                      <RowActionSeparator />
                      <RowAction
                        icon={<Trash2 />}
                        variant="destructive"
                        onSelect={() => setDialog({ kind: "delete", role })}
                      >
                        删除
                      </RowAction>
                    </>
                  )}
                </RowActions>
              </td>
            </tr>
          ))}
        </SimpleTable>
      </AsyncBoundary>
      <OverlayPresence>
        {dialog && (dialog.kind === "create" || dialog.kind === "edit") && (
          <RoleEditor
            path={path}
            role={dialog.kind === "edit" ? dialog.role : undefined}
            onClose={close}
            onSaved={saved}
            onReload={reload}
          />
        )}
      </OverlayPresence>
      <OverlayPresence>
        {dialog?.kind === "members" && (
          <RoleMembers
            project={project}
            role={dialog.role}
            onClose={close}
            onSaved={saved}
            onReload={reload}
          />
        )}
      </OverlayPresence>
      <OverlayPresence>
        {dialog?.kind === "delete" && (
          <DeleteRole
            path={path}
            role={dialog.role}
            onClose={close}
            onSaved={saved}
            onReload={reload}
          />
        )}
      </OverlayPresence>
    </section>
  );
}

type DialogActions = {
  onClose: () => void;
  onSaved: () => Promise<void>;
  onReload: () => Promise<void>;
};

function RoleEditor({
  path,
  role,
  onClose,
  onSaved,
  onReload,
}: DialogActions & { path: string; role?: ScopedRole }) {
  const formId = useId();
  const [name, setName] = useState(role?.name ?? "");
  const [description, setDescription] = useState(role?.description ?? "");
  const submission = useSubmission();
  const dirty =
    name !== (role?.name ?? "") || description !== (role?.description ?? "");
  const release = useUnsaved(dirty, submission.pending);
  const needsReload =
    submission.uncertain || isVersionConflict(submission.error);
  async function save() {
    if (!name.trim() || !dirty || needsReload || submission.pending) return;
    if (
      await submission.run(async () => {
        await request(role ? `${path}/${role.id}` : path, {
          method: role ? "PATCH" : "POST",
          etag: role?.etag,
          body: { name: name.trim(), description: description.trim() },
        });
      })
    ) {
      release();
      await onSaved();
    }
  }
  return (
    <Drawer
      open
      title={role ? "编辑角色" : "新建角色"}
      onClose={onClose}
      dirty={dirty}
      pending={submission.pending}
      footer={
        <>
          <OverlayCancelButton />
          <Button
            type="submit"
            form={formId}
            pending={submission.pending}
            disabled={!name.trim() || !dirty || needsReload}
          >
            保存
          </Button>
        </>
      }
    >
      <form
        id={formId}
        className="grid gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <RoleWriteFeedback
          error={submission.error}
          needsReload={needsReload}
          onReload={onReload}
        />
        <Field label="角色名称" required>
          <Input
            name="name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
          />
        </Field>
        <Field label="描述">
          <Textarea
            name="description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </Field>
      </form>
    </Drawer>
  );
}

function RoleMembers({
  project,
  role,
  onClose,
  onSaved,
  onReload,
}: DialogActions & { project: Resource; role: ScopedRole }) {
  const path = `/projects/${project.id}/roles/${role.id}`;
  const detail = useApiQuery<RoleDetail>(
    ["roles", "projects", project.id, role.id],
    path,
    { staleTime: 0 },
  );
  const initialLoading =
    detail.isPending || (detail.isFetching && !detail.isFetchedAfterMount);
  if (initialLoading || detail.error || !detail.data) {
    return (
      <Drawer open title={role.name} onClose={onClose}>
        <AsyncBoundary
          loading={initialLoading}
          error={detail.error}
          onRetry={() => void detail.refetch()}
        />
      </Drawer>
    );
  }
  return (
    <RoleMemberEditor
      project={project}
      detail={detail.data.data}
      path={path}
      onClose={onClose}
      onSaved={onSaved}
      onReload={onReload}
    />
  );
}

function RoleMemberEditor({
  project,
  detail,
  path,
  onClose,
  onSaved,
  onReload,
}: DialogActions & { project: Resource; detail: RoleDetail; path: string }) {
  const [snapshot] = useState(detail);
  const [users, setUsers] = useState<SelectableUser[]>(() =>
    snapshot.members.map((user) => ({
      ...user,
      avatar_url: user.avatar_file_id
        ? `/api/v1/avatars/${user.avatar_file_id}`
        : null,
    })),
  );
  const submission = useSubmission();
  const initialIDs = new Set(snapshot.members.map((user) => user.id));
  const dirty =
    users.length !== initialIDs.size ||
    users.some((user) => !initialIDs.has(user.id));
  const release = useUnsaved(dirty, submission.pending);
  const needsReload =
    submission.uncertain || isVersionConflict(submission.error);
  async function save() {
    if (!dirty || needsReload || submission.pending) return;
    if (
      await submission.run(async () => {
        await request(`${path}/members`, {
          method: "PUT",
          etag: snapshot.etag,
          body: { user_ids: users.map((user) => user.id) },
        });
      })
    ) {
      release();
      await onSaved();
    }
  }
  return (
    <Drawer
      open
      title={project.can_manage ? "管理角色成员" : "角色成员"}
      description={snapshot.name}
      onClose={onClose}
      dirty={dirty}
      pending={submission.pending}
      footer={
        project.can_manage && (
          <>
            <OverlayCancelButton />
            <Button
              onClick={() => void save()}
              pending={submission.pending}
              disabled={!dirty || needsReload}
            >
              保存
            </Button>
          </>
        )
      }
    >
      <div className="grid gap-4">
        <RoleWriteFeedback
          error={submission.error}
          needsReload={needsReload}
          onReload={onReload}
        />
        {project.can_manage ? (
          <ResourceUserPicker
            endpoint={`/projects/${project.id}/role-member-options`}
            label="已分配成员"
            name="role-members"
            value={users}
            onChange={setUsers}
            multiple
            max={Number.MAX_SAFE_INTEGER}
            disabled={submission.pending || needsReload}
          />
        ) : users.length ? (
          <ul className="divide-y divide-border-subtle">
            {users.map((user) => (
              <li key={user.id} className="py-2 break-words">
                {user.display_name}{" "}
                <span className="text-muted">@{user.username}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">暂无已分配成员</p>
        )}
      </div>
    </Drawer>
  );
}

function DeleteRole({
  path,
  role,
  onClose,
  onSaved,
  onReload,
}: DialogActions & { path: string; role: ScopedRole }) {
  const submission = useSubmission();
  const needsReload =
    submission.uncertain || isVersionConflict(submission.error);
  async function remove() {
    if (needsReload || submission.pending) return;
    if (
      await submission.run(async () => {
        await request(`${path}/${role.id}`, {
          method: "DELETE",
          etag: role.etag,
        });
      })
    )
      await onSaved();
  }
  return (
    <ConfirmDialog
      open
      title={`删除「${role.name}」？`}
      description={`删除后，${role.member_count} 位成员的角色分配将一并移除。`}
      confirmLabel="删除角色"
      danger
      pending={submission.pending}
      confirmDisabled={needsReload}
      onClose={onClose}
      onConfirm={() => void remove()}
    >
      <RoleWriteFeedback
        error={submission.error}
        needsReload={needsReload}
        onReload={onReload}
      />
    </ConfirmDialog>
  );
}

function RoleWriteFeedback({
  error,
  needsReload,
  onReload,
}: {
  error: unknown;
  needsReload: boolean;
  onReload: () => Promise<void>;
}) {
  const [pending, setPending] = useState(false);
  async function reload() {
    setPending(true);
    try {
      await onReload();
    } finally {
      setPending(false);
    }
  }
  if (!error) return null;
  return (
    <div className="grid justify-items-start gap-2">
      <ErrorNotice error={error} />
      {needsReload && (
        <Button
          variant="outline"
          size="sm"
          pending={pending}
          onClick={() => void reload()}
        >
          返回并刷新角色列表
        </Button>
      )}
    </div>
  );
}
