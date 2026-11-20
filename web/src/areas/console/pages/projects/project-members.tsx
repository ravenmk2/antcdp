import { useId, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Plus, Search, UserRoundMinus, UserRoundPlus } from "lucide-react";
import { request } from "@/api/client";
import {
  ConsoleDialog,
  ConsoleDialogCancel,
} from "@/areas/console/components/dialog";
import styles from "@/areas/console/styles/management.module.css";
import { Button } from "@/components/button";
import { AsyncBoundary, ErrorNotice, StatusBadge } from "@/components/feedback";
import { Field, Input, Select, StandaloneInput } from "@/components/fields";
import { OverlayPresence } from "@/components/overlay-presence";
import { Pagination } from "@/components/pagination";
import { Avatar } from "@/components/resource-icon";
import { SimpleTable } from "@/components/table";
import { TableToolbar } from "@/components/table-toolbar";
import { MemberRoleActions } from "@/features/collaboration/member-role-actions";
import { ProjectMemberRoles } from "@/features/collaboration/project-roles";
import { useApiQuery } from "@/hooks/use-api";
import { useFormErrors, useSubmission } from "@/hooks/use-form";
import { useDebouncedSearch } from "@/hooks/use-search";
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
  const [q, setQ] = useState("");
  const search = useDebouncedSearch(q, (value) => {
    setQ(value);
    setPage(1);
  });
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
      queryClient.invalidateQueries({
        queryKey: ["console-project-member-options", project.id],
        refetchType: "none",
      }),
    ]);
  }
  return (
    <section className={styles.scope} aria-label="成员管理">
      <header className={styles.memberHeading}>
        <h2>项目成员</h2>
      </header>
      <div className={`panel ${styles.memberDirectory}`}>
        <TableToolbar
          toolbarClassName={styles.directoryToolbar}
          onReset={() => {
            search.setValue("");
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
            className={styles.search}
            onSubmit={(event) => {
              event.preventDefault();
              if (!search.composing.current) search.submit();
            }}
          >
            <Search aria-hidden />
            <StandaloneInput
              className="w-full ps-9"
              aria-label="搜索成员"
              placeholder="搜索姓名或用户名"
              value={search.value}
              onChange={(event) => search.setValue(event.target.value)}
              onCompositionStart={() => {
                search.composing.current = true;
              }}
              onCompositionEnd={search.compositionEnd}
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
              className={styles.memberTable}
              containerProps={{ className: styles.tableViewport }}
              headers={[
                "成员",
                "项目身份",
                "自定义角色",
                "来源",
                "账号状态",
                "操作",
              ]}
            >
              {list.data.data.items.map((member) => (
                <tr key={member.user_id}>
                  <td>
                    <div className={styles.identity}>
                      <Avatar
                        className="size-8"
                        name={member.display_name}
                        url={
                          member.avatar_file_id
                            ? `/api/v1/avatars/${member.avatar_file_id}`
                            : undefined
                        }
                      />
                      <div className="min-w-0">
                        <strong
                          className={styles.nameButton}
                          title={member.display_name}
                        >
                          {member.display_name}
                        </strong>
                        <small
                          className={styles.account}
                          title={member.username}
                        >
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
                    <ProjectMemberRoles roles={member.custom_roles} />
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
                        member.account_status === "active"
                          ? "success"
                          : "neutral"
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
      </div>
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
          project={project}
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
  const formId = useId();
  const [selected, setSelected] = useState<UserOption | null>(null);
  const [role, setRole] = useState("member");
  const [query, setQuery] = useState("");
  const search = useDebouncedSearch(query, setQuery, 300);
  const options = useApiQuery<UserOption[]>(
    ["console-project-member-options", project.id, query],
    `/projects/${project.id}/member-options?${new URLSearchParams({ q: query })}`,
    { retry: false, staleTime: 0 },
  );
  const users = options.data?.data ?? [];
  const loading =
    options.isPending || options.isFetching || search.value.trim() !== query;
  const errors = useFormErrors();
  const submission = useSubmission();
  const dirty = Boolean(selected) || role !== "member";
  const markSaved = useUnsaved(dirty, submission.pending);

  async function save() {
    if (!selected) {
      errors.validate({ user_id: "请选择用户" });
      return;
    }
    await submission.run(
      async () => {
        await request(`/projects/${project.id}/members`, {
          method: "POST",
          etag,
          body: { user_id: selected.id, role },
        });
        markSaved();
        await onSaved();
        onClose();
      },
      (error) => errors.show(error, ["user_id", "role"]),
    );
  }
  return (
    <ConsoleDialog
      wide
      title="添加直接成员"
      description={`${project.name} · 团队继承身份不会改变`}
      icon={<UserRoundPlus />}
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
            添加成员
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
        <div className={styles.memberFields}>
          <section aria-label="候选用户">
            <Field label="选择用户" required error={errors.fields.user_id}>
              <div className={styles.pickerSearch}>
                <Search aria-hidden />
                <Input
                  name="user_id"
                  className="ps-9"
                  data-console-initial-focus
                  autoComplete="off"
                  placeholder="搜索姓名或用户名"
                  value={search.value}
                  disabled={submission.pending}
                  onChange={(event) => search.setValue(event.target.value)}
                  onCompositionStart={() => {
                    search.composing.current = true;
                  }}
                  onCompositionEnd={search.compositionEnd}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter" || event.nativeEvent.isComposing)
                      return;
                    event.preventDefault();
                    if (!search.composing.current) search.submit();
                  }}
                />
              </div>
            </Field>
            <p className={styles.pickerCount} aria-live="polite">
              {loading
                ? "搜索中…"
                : options.isError
                  ? "加载失败"
                  : `${users.length} 位候选用户`}
            </p>
            <div
              className={styles.pickerResults}
              role="group"
              aria-label="搜索结果"
              aria-busy={loading}
            >
              <AsyncBoundary
                loading={loading}
                error={options.error}
                onRetry={() => void options.refetch()}
                empty={!users.length}
                emptyCompact
                emptyTitle={query ? "没有匹配的用户" : "暂无可选用户"}
              >
                {users.map((user) => (
                  <label
                    key={user.id}
                    className={styles.candidate}
                    data-selected={selected?.id === user.id}
                  >
                    <input
                      type="radio"
                      name="candidate"
                      value={user.id}
                      checked={selected?.id === user.id}
                      disabled={submission.pending}
                      onChange={() => {
                        setSelected(user);
                        errors.change("user_id");
                      }}
                    />
                    <CandidateIdentity user={user} />
                  </label>
                ))}
              </AsyncBoundary>
            </div>
          </section>
          <div className={styles.memberSelection}>
            <div className={styles.selectionIdentity} aria-live="polite">
              <span className={styles.fieldLabel}>已选用户</span>
              {selected ? (
                <CandidateIdentity user={selected} />
              ) : (
                <span className="text-sm text-muted">尚未选择</span>
              )}
            </div>
            <Field label="直接角色" required error={errors.fields.role}>
              <Select
                name="role"
                value={role}
                onValueChange={(value) => {
                  setRole(value);
                  errors.change("role");
                }}
                disabled={submission.pending}
              >
                <option value="member">项目成员</option>
                <option value="admin">项目管理员</option>
              </Select>
            </Field>
          </div>
        </div>
      </form>
    </ConsoleDialog>
  );
}

function CandidateIdentity({ user }: { user: UserOption }) {
  return (
    <span className={styles.identity}>
      <span aria-hidden>
        <Avatar
          className="size-8"
          name={user.display_name}
          url={
            user.avatar_file_id
              ? `/api/v1/avatars/${user.avatar_file_id}`
              : undefined
          }
        />
      </span>
      <span className="min-w-0">
        <strong className={styles.nameButton} title={user.display_name}>
          {user.display_name}
        </strong>
        <small className={styles.account} title={user.username}>
          @{user.username}
        </small>
      </span>
    </span>
  );
}

function RemoveMemberDialog({
  project,
  member,
  etag,
  onClose,
  onSaved,
}: {
  project: Resource;
  member: Member;
  etag: string;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const submission = useSubmission();
  return (
    <ConsoleDialog
      title="移除直接成员关系"
      description={`${member.display_name} · @${member.username}`}
      tone="danger"
      icon={<UserRoundMinus />}
      pending={submission.pending}
      onClose={onClose}
      footer={
        <>
          <ConsoleDialogCancel pending={submission.pending} initialFocus />
          <Button
            variant="danger"
            pending={submission.pending}
            disabled={submission.uncertain}
            onClick={() => {
              void submission.run(async () => {
                await request(
                  `/projects/${project.id}/members/${member.user_id}`,
                  {
                    method: "DELETE",
                    etag,
                  },
                );
                await onSaved();
                onClose();
              });
            }}
          >
            移除直接关系
          </Button>
        </>
      }
    >
      <ErrorNotice error={submission.error} />
      <p className="text-sm text-muted">
        其他团队来源不会受影响。若移除最后一位管理员，之后需由系统管理员接管。
      </p>
    </ConsoleDialog>
  );
}
