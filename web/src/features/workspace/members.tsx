import { TableToolbar } from "@/components/table-toolbar";
import { StandaloneSelect } from "@/components/fields";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, Users } from "lucide-react";
import { request } from "@/api/client";
import { Button } from "@/components/button";
import { AsyncBoundary, ErrorNotice, StatusBadge } from "@/components/feedback";
import { Field, Select, StandaloneInput } from "@/components/fields";
import { ConfirmDialog, Drawer, Modal } from "@/components/overlays";
import { Pagination } from "@/components/pagination";
import { SimpleTable } from "@/components/table";
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
              添加直接成员
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
            label={`${resource.name}成员`}
            headers={[
              "成员",
              "有效角色",
              "直接角色",
              "权限来源",
              "账号状态",
              "操作",
            ]}
          >
            {list.data.data.items.map((member) => (
              <tr key={member.user_id}>
                <td>
                  <strong className="text-foreground">
                    {member.display_name}
                  </strong>
                  <small className="mt-1 block text-muted">
                    @{member.username}
                  </small>
                </td>
                <td>
                  {member.effective_role === "admin"
                    ? kind === "projects"
                      ? "项目管理员"
                      : "团队管理员"
                    : "成员"}
                </td>
                <td>
                  {member.direct_role ? (
                    <RoleSelect
                      kind={kind}
                      resource={resource}
                      member={member}
                      etag={membershipEtag}
                      onSaved={refresh}
                    />
                  ) : (
                    "—"
                  )}
                </td>
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
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-danger"
                      onClick={() => setRemove(member)}
                    >
                      <Trash2 />
                      移除直接关系
                    </Button>
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
      {add && (
        <AddMember
          kind={kind}
          resource={resource}
          etag={membershipEtag}
          onClose={() => setAdd(false)}
          onSaved={refresh}
        />
      )}
      {remove && (
        <RemoveMember
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

function RoleSelect({
  kind,
  resource,
  member,
  etag,
  onSaved,
}: {
  kind: ResourceKind;
  resource: Resource;
  member: Member;
  etag: string;
  onSaved: () => Promise<void>;
}) {
  const submission = useSubmission();
  if (!resource.can_manage)
    return member.direct_role === "admin" ? "管理员" : "成员";
  return (
    <>
      <StandaloneSelect
        aria-label={`调整 ${member.display_name} 的直接角色`}
        className="min-h-8 w-28 rounded-md border bg-surface px-2 py-1 text-xs data-[size=default]:h-8"
        value={member.direct_role}
        disabled={submission.pending}
        onValueChange={(value) =>
          void submission.run(async () => {
            await request(`/${kind}/${resource.id}/members/${member.user_id}`, {
              method: "PATCH",
              etag,
              body: { role: value },
            });
            await onSaved();
          })
        }
      >
        <option value="member">成员</option>
        <option value="admin">管理员</option>
      </StandaloneSelect>
      <ErrorNotice error={submission.error} />
    </>
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
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [userId, setUserId] = useState("");
  const [role, setRole] = useState("member");
  const errors = useFormErrors();
  const submission = useSubmission();
  const options = useApiQuery<UserOption[]>(
    ["member-options", kind, resource.id, search],
    `/${kind}/${resource.id}/member-options?q=${encodeURIComponent(search)}`,
  );
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
      title="添加直接成员"
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
        <ErrorNotice error={errors.error} />
        <ErrorNotice error={submission.error} />
        <div>
          <label className="mb-2 block text-xs font-medium">搜索正常用户</label>
          <div className="flex gap-2">
            <StandaloneInput
              aria-label="搜索可添加用户"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <Button variant="outline" onClick={() => setSearch(query.trim())}>
              搜索
            </Button>
          </div>
        </div>
        <div className="max-h-64 overflow-y-auto rounded-lg border">
          {options.data?.data.map((user) => (
            <label
              key={user.id}
              className="flex items-center gap-3 border-b p-3 last:border-0"
            >
              <input
                type="radio"
                name="user_id"
                value={user.id}
                checked={userId === user.id}
                onChange={() => setUserId(user.id)}
              />
              <span>
                {user.display_name}
                <small className="ml-2 text-muted">@{user.username}</small>
              </span>
            </label>
          ))}
          {options.data && !options.data.data.length && (
            <p className="p-5 text-sm text-muted">没有可添加的用户。</p>
          )}
        </div>
        {errors.fields.user_id && (
          <p className="text-xs text-danger">{errors.fields.user_id}</p>
        )}
        <Field label="直接角色" required error={errors.fields.role}>
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

function RemoveMember({
  kind,
  resource,
  member,
  etag,
  onClose,
  onSaved,
}: {
  kind: ResourceKind;
  resource: Resource;
  member: Member;
  etag: string;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const submission = useSubmission();
  return (
    <ConfirmDialog
      open
      danger
      title="移除直接成员关系"
      description={`${member.display_name} · @${member.username}`}
      confirmLabel="移除直接关系"
      pending={submission.pending}
      onClose={onClose}
      onConfirm={() =>
        void submission.run(async () => {
          await request(`/${kind}/${resource.id}/members/${member.user_id}`, {
            method: "DELETE",
            etag,
          });
          await onSaved();
          onClose();
        })
      }
    >
      <ErrorNotice error={submission.error} />
      <p className="text-sm text-muted">
        其他团队来源不会受影响。若移除最后一位管理员，之后需由系统管理员接管。
      </p>
    </ConfirmDialog>
  );
}

export function ProjectTeams({ resource }: { resource: Resource }) {
  const [add, setAdd] = useState(false);
  const [remove, setRemove] = useState<Resource | null>(null);
  const queryClient = useQueryClient();
  const list = useApiQuery<Resource[]>(
    ["project-teams", resource.id],
    `/projects/${resource.id}/teams`,
  );
  const submission = useSubmission();
  async function refresh() {
    await queryClient.invalidateQueries({
      queryKey: ["project-teams", resource.id],
    });
  }
  return (
    <section className="panel">
      <header className="panel-header">
        <h2 className="panel-title">授权团队</h2>
        {resource.can_manage && (
          <Button size="sm" onClick={() => setAdd(true)}>
            <Plus />
            授权团队
          </Button>
        )}
      </header>
      <AsyncBoundary
        loading={list.isPending}
        error={list.error}
        onRetry={() => void list.refetch()}
        empty={!list.data?.data.length}
        emptyTitle="尚未授权团队"
        emptyDescription="团队只提供项目成员权限，不继承团队管理员身份。"
      >
        <ul className="divide-y">
          {list.data?.data.map((team) => (
            <li key={team.id} className="flex items-center gap-3 px-5 py-4">
              <Users className="size-5 text-muted" />
              <div className="min-w-0 flex-1">
                <strong>{team.name}</strong>
                <small className="mono block text-muted">{team.code}</small>
              </div>
              {resource.can_manage && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-danger"
                  onClick={() => setRemove(team)}
                >
                  撤销授权
                </Button>
              )}
            </li>
          ))}
        </ul>
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
        onClose={() => setRemove(null)}
        onConfirm={() => {
          if (!remove) return;
          void submission.run(async () => {
            await request(`/projects/${resource.id}/teams/${remove.id}`, {
              method: "DELETE",
              etag: resource.membership_etag,
            });
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
            disabled={!selected}
            pending={submission.pending}
            onClick={() =>
              void submission.run(async () => {
                await request(`/projects/${resource.id}/teams`, {
                  method: "POST",
                  etag: resource.membership_etag,
                  body: { team_id: selected },
                });
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
            className="flex items-center gap-3 border-b p-3 last:border-0"
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
