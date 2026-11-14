import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { request } from "@/api/client";
import { Button } from "@/components/button";
import { AsyncBoundary, ErrorNotice, StatusBadge } from "@/components/feedback";
import { Field, Select, StandaloneInput } from "@/components/fields";
import { Drawer, OverlayCancelButton } from "@/components/overlays";
import { OverlayPresence } from "@/components/overlay-presence";
import { Pagination } from "@/components/pagination";
import { Avatar } from "@/components/resource-icon";
import { SimpleTable } from "@/components/table";
import { TableToolbar } from "@/components/table-toolbar";
import { MemberRoleActions } from "@/features/collaboration/member-role-actions";
import { RemoveMemberDialog } from "@/features/collaboration/remove-member-dialog";
import { ResourceUserPicker } from "@/features/collaboration/user-picker";
import { useApiQuery } from "@/hooks/use-api";
import { useFormErrors, useSubmission } from "@/hooks/use-form";
import { useUnsaved } from "@/hooks/use-unsaved";
import type {
  Member,
  MemberPage,
  Resource,
  UserOption,
} from "@/types/collaboration";

export function ProjectMembers({ project }: { project: Resource }) {
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(20);
  const [input, setInput] = useState("");
  const [q, setQ] = useState("");
  const [add, setAdd] = useState(false);
  const [remove, setRemove] = useState<Member | null>(null);
  const queryClient = useQueryClient();
  const list = useApiQuery<MemberPage>(
    ["members", "projects", project.id, q, page, size],
    `/projects/${project.id}/members?${new URLSearchParams({ q, page: String(page), page_size: String(size) })}`,
  );
  const membershipEtag =
    list.data?.data.membership_etag || project.membership_etag;
  async function refresh() {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: ["members", "projects", project.id],
      }),
      queryClient.invalidateQueries({ queryKey: ["project", project.id] }),
    ]);
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
          project.can_manage && (
            <Button onClick={() => setAdd(true)}>
              <Plus />
              添加直接成员
            </Button>
          )
        }
      >
        <form
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
        </form>
      </TableToolbar>
      <AsyncBoundary
        loading={list.isPending}
        error={list.error}
        onRetry={() => void list.refetch()}
        empty={!list.data?.data.items.length}
        emptyTitle={q ? "没有匹配的成员" : "暂无成员"}
        emptyDescription={q ? "请调整搜索条件。" : undefined}
      >
        {list.data && (
          <SimpleTable
            actions
            label={`${project.name}成员`}
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
                  <div className="flex min-w-48 items-center gap-3">
                    <Avatar
                      name={member.display_name}
                      url={
                        member.avatar_file_id
                          ? `/api/v1/avatars/${member.avatar_file_id}`
                          : undefined
                      }
                    />
                    <div className="min-w-0">
                      <strong className="block break-all text-foreground">
                        {member.display_name}
                      </strong>
                      <small className="mt-1 block break-all text-muted">
                        @{member.username}
                      </small>
                    </div>
                  </div>
                </td>
                <td>
                  {member.effective_role === "admin"
                    ? "项目管理员"
                    : "项目成员"}
                </td>
                <td>
                  {member.direct_role
                    ? member.direct_role === "admin"
                      ? "项目管理员"
                      : "项目成员"
                    : "—"}
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
                  {project.can_manage && member.direct_role ? (
                    <MemberRoleActions
                      kind="projects"
                      resource={project}
                      member={member}
                      etag={membershipEtag}
                      onSaved={refresh}
                      onRemove={() => setRemove(member)}
                    />
                  ) : member.direct_role ? (
                    "仅可查看"
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
            project={project}
            etag={membershipEtag}
            onClose={() => setAdd(false)}
            onSaved={refresh}
          />
        )}
      </OverlayPresence>
      {remove && (
        <RemoveMemberDialog
          kind="projects"
          resource={project}
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
  project,
  etag,
  onClose,
  onSaved,
}: {
  project: Resource;
  etag: string;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [selected, setSelected] = useState<UserOption[]>([]);
  const [role, setRole] = useState("member");
  const errors = useFormErrors();
  const submission = useSubmission();
  useUnsaved(selected.length > 0, submission.pending);
  async function save() {
    if (!selected[0]) {
      errors.validate({ user_id: "请选择用户" });
      return;
    }
    await submission.run(
      async () => {
        await request(`/projects/${project.id}/members`, {
          method: "POST",
          etag,
          body: { user_id: selected[0].id, role },
        });
        await onSaved();
        onClose();
      },
      (error) => errors.show(error, ["user_id", "role"]),
    );
  }
  return (
    <Drawer
      open
      title="添加直接成员"
      description={`${project.name} · 团队继承身份不会改变`}
      dirty={selected.length > 0}
      pending={submission.pending}
      onClose={onClose}
      footer={
        <>
          <OverlayCancelButton />
          <Button
            pending={submission.pending}
            disabled={submission.uncertain}
            onClick={() => void save()}
          >
            添加成员
          </Button>
        </>
      }
    >
      <form
        ref={errors.formRef}
        className="grid gap-5"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <ErrorNotice error={errors.error || submission.error} />
        <ResourceUserPicker
          label="用户"
          name="user_id"
          multiple={false}
          min={1}
          max={1}
          value={selected}
          disabled={submission.pending}
          error={errors.fields.user_id}
          endpoint={`/projects/${project.id}/member-options`}
          onChange={(users) => {
            setSelected(users);
            errors.change("user_id");
          }}
        />
        <Field label="直接角色" required error={errors.fields.role}>
          <Select
            name="role"
            value={role}
            onValueChange={setRole}
            disabled={submission.pending}
          >
            <option value="member">项目成员</option>
            <option value="admin">项目管理员</option>
          </Select>
        </Field>
      </form>
    </Drawer>
  );
}
