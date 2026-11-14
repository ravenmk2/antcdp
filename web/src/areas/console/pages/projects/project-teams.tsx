import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, UsersRound } from "lucide-react";
import {
  authorizeProjectTeam,
  revokeProjectTeam,
} from "@/features/collaboration/project-team-api";
import { Button } from "@/components/button";
import { AsyncBoundary, ErrorNotice } from "@/components/feedback";
import { StandaloneInput } from "@/components/fields";
import {
  ConfirmDialog,
  Modal,
  OverlayCancelButton,
} from "@/components/overlays";
import { RowAction, RowActions } from "@/components/row-actions";
import { TableToolbar } from "@/components/table-toolbar";
import { useApiQuery } from "@/hooks/use-api";
import { useSubmission } from "@/hooks/use-form";
import type { Resource, TeamOption } from "@/types/collaboration";

export function ProjectTeams({ project }: { project: Resource }) {
  const [add, setAdd] = useState(false);
  const [remove, setRemove] = useState<Resource | null>(null);
  const queryClient = useQueryClient();
  const list = useApiQuery<Resource[]>(
    ["project-teams", project.id],
    `/projects/${project.id}/teams`,
  );
  const submission = useSubmission();
  async function refresh() {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: ["project-teams", project.id],
      }),
      queryClient.invalidateQueries({
        queryKey: ["members", "projects", project.id],
      }),
    ]);
  }
  return (
    <section className="panel">
      <TableToolbar
        onRefresh={() => void list.refetch()}
        refreshing={list.isFetching}
        actions={
          project.can_manage && (
            <Button onClick={() => setAdd(true)}>
              <Plus />
              授权团队
            </Button>
          )
        }
      >
        <span className="text-xs text-muted">
          团队只提供项目成员权限，不继承团队管理员身份。
        </span>
      </TableToolbar>
      <AsyncBoundary
        loading={list.isPending}
        error={list.error}
        onRetry={() => void list.refetch()}
        empty={!list.data?.data.length}
        emptyTitle="尚未授权团队"
        emptyDescription="可直接添加成员，或授权团队统一提供项目成员身份。"
      >
        <ul className="divide-y divide-border-subtle">
          {list.data?.data.map((team) => (
            <li key={team.id} className="flex items-center gap-3 px-5 py-4">
              <UsersRound className="size-5 shrink-0 text-muted" />
              <div className="min-w-0 flex-1">
                <strong className="block break-all">{team.name}</strong>
                <small className="mono block break-all text-muted">
                  {team.code}
                </small>
                {team.summary && (
                  <p className="mt-1 text-xs break-all text-muted">
                    {team.summary}
                  </p>
                )}
              </div>
              {project.can_manage && (
                <RowActions label={team.name}>
                  <RowAction
                    icon={<Trash2 />}
                    variant="destructive"
                    onSelect={() => setRemove(team)}
                  >
                    撤销授权
                  </RowAction>
                </RowActions>
              )}
            </li>
          ))}
        </ul>
      </AsyncBoundary>
      {add && (
        <AuthorizeTeam
          project={project}
          etag={project.membership_etag}
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
              project.id,
              remove.id,
              project.membership_etag,
            );
            await refresh();
            setRemove(null);
          });
        }}
      >
        <ErrorNotice error={submission.error} />
        <p className="text-sm text-muted">
          只撤销该团队来源，直接成员与其他团队来源保留。
        </p>
      </ConfirmDialog>
    </section>
  );
}

function AuthorizeTeam({
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
  const [input, setInput] = useState("");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState("");
  const submission = useSubmission();
  const options = useApiQuery<TeamOption[]>(
    ["team-options", project.id, search],
    `/projects/${project.id}/team-options?q=${encodeURIComponent(search)}`,
  );
  return (
    <Modal
      open
      title="授权团队"
      description={project.name}
      onClose={onClose}
      pending={submission.pending}
      footer={
        <>
          <OverlayCancelButton />
          <Button
            disabled={!selected || submission.uncertain}
            pending={submission.pending}
            onClick={() =>
              void submission.run(async () => {
                await authorizeProjectTeam(project.id, selected, etag);
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
          setSelected("");
          setSearch(input.trim());
        }}
      >
        <StandaloneInput
          aria-label="搜索可授权团队"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="搜索团队名称、编码或摘要"
        />
        <Button type="submit" variant="outline">
          搜索
        </Button>
      </form>
      <AsyncBoundary
        loading={options.isPending}
        error={options.error}
        onRetry={() => void options.refetch()}
        empty={!options.data?.data.length}
        emptyTitle="没有可授权团队"
      >
        <div className="max-h-72 overflow-y-auto rounded-lg border">
          {options.data?.data.map((team) => (
            <label
              key={team.id}
              className="flex cursor-pointer items-center gap-3 border-b border-b-border-subtle p-3 last:border-0"
            >
              <input
                type="radio"
                name="team_id"
                checked={selected === team.id}
                onChange={() => setSelected(team.id)}
              />
              <span className="min-w-0 flex-1">
                <strong className="block break-all">{team.name}</strong>
                <small className="mono block break-all text-muted">
                  {team.code}
                </small>
              </span>
            </label>
          ))}
        </div>
      </AsyncBoundary>
    </Modal>
  );
}
