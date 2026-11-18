import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { request } from "@/api/client";
import { Button } from "@/components/button";
import { AsyncBoundary, ErrorNotice, StatusBadge } from "@/components/feedback";
import { Field, Select, StandaloneInput } from "@/components/fields";
import { OverlayPresence } from "@/components/overlay-presence";
import { ConfirmDialog, Drawer, Modal } from "@/components/overlays";
import { Pagination } from "@/components/pagination";
import { Avatar, ResourceIcon } from "@/components/resource-icon";
import { RowAction, RowActions } from "@/components/row-actions";
import { SimpleTable } from "@/components/table";
import { TableToolbar } from "@/components/table-toolbar";
import { useApiQuery } from "@/hooks/use-api";
import { useFormErrors, useSubmission } from "@/hooks/use-form";
import type {
  Member,
  MemberPage,
  Resource,
  ResourceKind,
  TeamOption,
  UserOption,
} from "@/types/collaboration";
import { MemberRoleActions } from "./member-role-actions";
import { ProjectMemberRoles } from "./project-roles";
import { authorizeProjectTeam, revokeProjectTeam } from "./project-team-api";
import { RemoveMemberDialog } from "./remove-member-dialog";
import { ResourceUserPicker } from "./user-picker";

export function MembersPanel({
  kind,
  resource,
}: {
  kind: ResourceKind;
  resource: Resource;
}) {
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(20);
  const [input, setInput] = useState("");
  const [q, setQ] = useState("");
  const [add, setAdd] = useState(false);
  const [remove, setRemove] = useState<Member | null>(null);
  const queryClient = useQueryClient();
  const list = useApiQuery<MemberPage>(
    ["members", kind, resource.id, q, page, size],
    `/${kind}/${resource.id}/members?${new URLSearchParams({ q, page: String(page), page_size: String(size) })}`,
  );
  const membershipEtag =
    list.data?.data.membership_etag || resource.membership_etag;
  async function refresh() {
    await queryClient.invalidateQueries({
      queryKey: ["members", kind, resource.id],
    });
    await queryClient.invalidateQueries({
      queryKey: [kind === "projects" ? "project" : "team", resource.id],
    });
  }
  return (
    <section className="panel">
      <TableToolbar
        onReset={() => {
          setInput("");
          setQ("");
          setPage(1);
        }}
        onRefresh={() => void list.refetch()}
        refreshing={list.isFetching}
        actions={
          resource.can_manage && (
            <Button
              className="flex items-center gap-2"
              onClick={() => setAdd(true)}
            >
              <Plus />
              {kind === "teams" ? "添加成员" : "添加直接成员"}
            </Button>
          )
        }
      >
        <form
          className="flex shrink-0 items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            setQ(input.trim());
            setPage(1);
          }}
        >
          <StandaloneInput
            aria-label="搜索成员"
            placeholder="搜索姓名或用户名"
            value={input}
            onChange={(event) => setInput(event.target.value)}
          />
          <Button aria-label="搜索" type="submit" variant="outline">
            搜索
          </Button>
        </form>
      </TableToolbar>
      <AsyncBoundary
        loading={list.isPending}
        error={list.error}
        onRetry={() => void list.refetch()}
        empty={!list.data?.data.items.length}
        emptyTitle="暂无成员"
        emptyDescription={q ? "没有匹配的成员，请调整搜索。" : undefined}
      >
        {list.data && (
          <SimpleTable
            actions
            className="member-table"
            label={`${resource.name}成员`}
            headers={
              kind === "teams"
                ? ["成员", "团队角色", "账号状态", "操作"]
                : ["成员", "项目身份", "自定义角色", "来源", "账号状态", "操作"]
            }
          >
            {list.data.data.items.map((member) => (
              <tr key={member.user_id}>
                <td className="min-w-32">
                  <div className="flex items-center gap-3">
                    {kind === "teams" && (
                      <Avatar
                        name={member.display_name}
                        url={
                          member.avatar_file_id
                            ? `/api/v1/avatars/${member.avatar_file_id}`
                            : undefined
                        }
                      />
                    )}
                    <div>
                      <strong className="text-foreground">
                        {member.display_name}
                      </strong>
                      <small className="mt-1 block whitespace-nowrap text-muted">
                        @{member.username}
                      </small>
                    </div>
                  </div>
                </td>
                {kind === "projects" && (
                  <td className="whitespace-nowrap">
                    {member.effective_role === "admin"
                      ? "项目管理员"
                      : "项目成员"}
                  </td>
                )}
                <td
                  className={kind === "teams" ? "whitespace-nowrap" : undefined}
                >
                  {kind === "projects" ? (
                    <ProjectMemberRoles roles={member.custom_roles} />
                  ) : member.direct_role ? (
                    member.direct_role === "admin" ? (
                      "团队管理员"
                    ) : (
                      "团队成员"
                    )
                  ) : (
                    "—"
                  )}
                </td>
                {kind === "projects" && (
                  <td>
                    <div className="flex max-w-md flex-wrap gap-1">
                      {member.sources.map((source, index) => (
                        <StatusBadge
                          key={`${source.type}-${source.team_id ?? index}`}
                        >
                          {source.type === "direct"
                            ? "直接成员"
                            : source.team_name || "团队"}
                        </StatusBadge>
                      ))}
                    </div>
                  </td>
                )}
                <td>
                  <StatusBadge
                    tone={
                      member.account_status === "active" ? "success" : "neutral"
                    }
                  >
                    {member.account_status === "active" ? "正常" : "已禁用"}
                  </StatusBadge>
                </td>
                <td>
                  {resource.can_manage && member.direct_role ? (
                    <MemberRoleActions
                      kind={kind}
                      resource={resource}
                      member={member}
                      etag={membershipEtag}
                      onSaved={refresh}
                      onRemove={() => setRemove(member)}
                    />
                  ) : member.direct_role ? (
                    "仅可查看来源"
                  ) : (
                    "由团队管理"
                  )}
                </td>
              </tr>
            ))}
          </SimpleTable>
        )}
      </AsyncBoundary>
      {list.data && (
        <Pagination
          page={page}
          size={size}
          total={list.data.data.total}
          pending={list.isFetching}
          onChange={(nextPage, nextSize) => {
            setPage(nextPage);
            setSize(nextSize);
          }}
        />
      )}
      <OverlayPresence>
        {add && (
          <AddMember
            kind={kind}
            resource={resource}
            etag={membershipEtag}
            onClose={() => setAdd(false)}
            onSaved={refresh}
          />
        )}
      </OverlayPresence>
      {remove && (
        <RemoveMemberDialog
          kind={kind}
          resource={resource}
          member={remove}
          etag={membershipEtag}
          onClose={() => setRemove(null)}
          onSaved={refresh}
        />
      )}
    </section>
  );
}

function AddMember({
  kind,
  resource,
  etag,
  onClose,
  onSaved,
}: {
  kind: ResourceKind;
  resource: Resource;
  etag: string;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [selectedUsers, setSelectedUsers] = useState<UserOption[]>([]);
  const userId = selectedUsers[0]?.id ?? "";
  const [role, setRole] = useState("member");
  const errors = useFormErrors();
  const submission = useSubmission();
  async function save() {
    if (!userId) {
      errors.validate({ user_id: "请选择用户" });
      return;
    }
    const ok = await submission.run(
      async () => {
        await request(`/${kind}/${resource.id}/members`, {
          method: "POST",
          etag,
          body: { user_id: userId, role },
        });
        await onSaved();
        onClose();
      },
      (error) => errors.show(error, ["user_id", "role"]),
    );
    if (!ok) return;
  }
  return (
    <Drawer
      open
      title={kind === "teams" ? "添加成员" : "添加直接成员"}
      description={`${resource.name} · 团队继承身份不会改变`}
      onClose={onClose}
      pending={submission.pending}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button pending={submission.pending} onClick={() => void save()}>
            添加成员
          </Button>
        </>
      }
    >
      <form
        ref={errors.formRef}
        className="grid gap-5"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <ErrorNotice error={errors.error || submission.error} />
        <ResourceUserPicker
          label="用户"
          name="user_id"
          endpoint={`/${kind}/${resource.id}/member-options`}
          min={1}
          max={1}
          value={selectedUsers}
          disabled={submission.pending}
          error={errors.fields.user_id}
          onChange={(users) => {
            setSelectedUsers(users);
            errors.change("user_id");
          }}
        />
        <Field
          label={kind === "teams" ? "团队角色" : "直接角色"}
          required
          error={errors.fields.role}
        >
          <Select
            name="role"
            value={role}
            onValueChange={(value) => setRole(value)}
          >
            <option value="member">成员</option>
            <option value="admin">管理员</option>
          </Select>
        </Field>
      </form>
    </Drawer>
  );
}

export function ProjectTeams({
  resource,
  label,
}: {
  resource: Resource;
  label: string;
}) {
  const [input, setInput] = useState("");
  const [q, setQ] = useState("");
  const [add, setAdd] = useState(false);
  const [remove, setRemove] = useState<Resource | null>(null);
  const queryClient = useQueryClient();
  const list = useApiQuery<Resource[]>(
    ["project-teams", resource.id],
    `/projects/${resource.id}/teams`,
  );
  const keyword = q.toLowerCase();
  const teams = list.data?.data.filter((team) =>
    [team.name, team.code, team.summary].some((value) =>
      value.toLowerCase().includes(keyword),
    ),
  );
  const submission = useSubmission();
  async function refresh() {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: ["project-teams", resource.id],
      }),
      queryClient.invalidateQueries({ queryKey: ["project", resource.id] }),
      queryClient.invalidateQueries({
        queryKey: ["members", "projects", resource.id],
      }),
    ]);
  }
  return (
    <section className="panel">
      <TableToolbar
        onReset={() => {
          setInput("");
          setQ("");
        }}
        onRefresh={refresh}
        refreshing={list.isFetching}
        actions={
          resource.can_manage && (
            <Button onClick={() => setAdd(true)}>
              <Plus />
              授权团队
            </Button>
          )
        }
      >
        <form
          className="flex shrink-0 items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            setQ(input.trim());
          }}
        >
          <StandaloneInput
            aria-label={`搜索${label}`}
            placeholder="搜索名称、编码或摘要"
            value={input}
            onChange={(event) => setInput(event.target.value)}
          />
          <Button type="submit" variant="outline">
            搜索
          </Button>
        </form>
      </TableToolbar>
      <AsyncBoundary
        loading={list.isPending}
        error={list.error}
        onRetry={() => void list.refetch()}
        empty={!teams?.length}
        emptyTitle={q ? "没有匹配的团队" : `暂无${label}`}
        emptyDescription={
          q
            ? "请调整搜索关键词。"
            : "为团队授权后，团队成员可获得项目成员权限。"
        }
      >
        <SimpleTable
          label={label}
          actions={resource.can_manage}
          headers={
            resource.can_manage
              ? ["团队名称", "摘要", "操作"]
              : ["团队名称", "摘要"]
          }
        >
          {teams?.map((team) => (
            <tr key={team.id}>
              <td>
                <div className="flex items-center gap-3">
                  <ResourceIcon resource={team} />
                  <span className="min-w-0">
                    <strong className="block truncate text-foreground">
                      {team.name}
                    </strong>
                    <small className="mt-1 block truncate font-mono text-muted">
                      {team.code}
                    </small>
                  </span>
                </div>
              </td>
              <td>{team.summary || "—"}</td>
              {resource.can_manage && (
                <td>
                  <RowActions label={team.name}>
                    <RowAction
                      icon={<Trash2 />}
                      variant="destructive"
                      onSelect={() => setRemove(team)}
                    >
                      撤销授权
                    </RowAction>
                  </RowActions>
                </td>
              )}
            </tr>
          ))}
        </SimpleTable>
      </AsyncBoundary>
      {add && (
        <AuthorizeTeam
          resource={resource}
          onClose={() => setAdd(false)}
          onSaved={refresh}
        />
      )}
      <ConfirmDialog
        open={Boolean(remove)}
        danger
        title="撤销团队授权"
        description={remove?.name}
        confirmLabel="撤销授权"
        pending={submission.pending}
        confirmDisabled={submission.uncertain}
        onClose={() => setRemove(null)}
        onConfirm={() => {
          if (!remove || submission.pending || submission.uncertain) return;
          void submission.run(async () => {
            await revokeProjectTeam(
              resource.id,
              remove.id,
              resource.membership_etag,
            );
            await refresh();
            setRemove(null);
          });
        }}
      >
        <ErrorNotice error={submission.error} />
        <p className="text-sm text-muted">直接成员与其他团队来源保留。</p>
      </ConfirmDialog>
    </section>
  );
}

function AuthorizeTeam({
  resource,
  onClose,
  onSaved,
}: {
  resource: Resource;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState("");
  const submission = useSubmission();
  const options = useApiQuery<TeamOption[]>(
    ["team-options", resource.id, search],
    `/projects/${resource.id}/team-options?q=${encodeURIComponent(search)}`,
  );
  return (
    <Modal
      open
      title="授权团队"
      description={resource.name}
      onClose={onClose}
      pending={submission.pending}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button
            disabled={!selected || submission.uncertain}
            pending={submission.pending}
            onClick={() =>
              void submission.run(async () => {
                await authorizeProjectTeam(
                  resource.id,
                  selected,
                  resource.membership_etag,
                );
                await onSaved();
                onClose();
              })
            }
          >
            确认授权
          </Button>
        </>
      }
    >
      <ErrorNotice error={submission.error} />
      <form
        className="mb-3 flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          setSearch(q.trim());
        }}
      >
        <StandaloneInput
          aria-label="搜索可授权团队"
          value={q}
          onChange={(event) => setQ(event.target.value)}
          placeholder="搜索团队"
        />
        <Button type="submit" variant="outline">
          搜索
        </Button>
      </form>
      <div className="max-h-64 overflow-y-auto rounded-lg border">
        {options.data?.data.map((team) => (
          <label
            key={team.id}
            className="flex items-center gap-3 border-b border-b-border-subtle p-3 last:border-0"
          >
            <input
              type="radio"
              checked={selected === team.id}
              onChange={() => setSelected(team.id)}
            />
            {team.name}
            <small className="mono text-muted">{team.code}</small>
          </label>
        ))}
      </div>
    </Modal>
  );
}
