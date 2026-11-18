import { useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { SimpleTable } from "@/components/table";
import { request } from "@/api/client";
import { useSession } from "@/app/auth";
import { AsyncBoundary, ErrorNotice, StatusBadge } from "@/components/feedback";
import { Panel, ResourceDetailShell } from "@/components/layout";
import { ConfirmDialog } from "@/components/overlays";
import { OverlayPresence } from "@/components/overlay-presence";
import { ResourceIcon } from "@/components/resource-icon";
import { useApiQuery } from "@/hooks/use-api";
import { useSubmission } from "@/hooks/use-form";
import { recordRecent } from "@/lib/recent";
import type { Resource } from "@/types/collaboration";
import { ResourceDocument } from "@/features/collaboration/resource-detail";
import { MembersPanel } from "@/areas/workspace/pages/member-panels";
import { WorkspaceResourceProfileEditor } from "@/areas/workspace/pages/resource-profile-editor";
import { useWorkspaceShortcut } from "@/areas/workspace/pages/use-workspace-shortcut";
import { WorkspaceResourceHeader } from "./workspace-resource-header";
import { WorkspaceResourceActions } from "@/areas/workspace/pages/workspace-resource-actions";
import { WorkspaceShortcutFeedback } from "@/areas/workspace/pages/workspace-shortcut-feedback";
import { normalizeWorkspaceTeamTab } from "@/areas/workspace/pages/workspace-navigation";

export function WorkspaceTeamDetail() {
  const { teamId } = useParams();
  const query = useApiQuery<Resource>(
    ["team", teamId],
    `/teams/${teamId ?? ""}`,
    { enabled: Boolean(teamId && /^[1-9]\d*$/.test(teamId)) },
  );
  return (
    <AsyncBoundary
      loading={query.isPending}
      error={query.error}
      onRetry={() => void query.refetch()}
    >
      {query.data && (
        <TeamContent
          key={query.data.data.id}
          team={query.data.data}
          onRefresh={() => void query.refetch()}
        />
      )}
    </AsyncBoundary>
  );
}

function TeamContent({
  team,
  onRefresh,
}: {
  team: Resource;
  onRefresh: () => void;
}) {
  const session = useSession();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const queryClient = useQueryClient();
  const [edit, setEdit] = useState(false);
  const [leave, setLeave] = useState(false);
  const submission = useSubmission();
  const shortcut = useWorkspaceShortcut("teams");
  const tab = normalizeWorkspaceTeamTab(params.get("tab"));
  useEffect(() => {
    recordRecent(session.user.id, {
      id: team.id,
      name: team.name,
      kind: "team",
      to: `/teams/${team.id}`,
    });
  }, [session.user.id, team.id, team.name]);

  async function leaveTeam() {
    const ok = await submission.run(async () => {
      await request(`/teams/${team.id}/leave`, { method: "POST", body: {} });
      await queryClient.invalidateQueries();
    });
    if (ok) navigate("/teams");
  }

  return (
    <ResourceDetailShell
      header={
        <WorkspaceResourceHeader
          resource={team}
          kind="teams"
          actions={
            <WorkspaceResourceActions
              kind="teams"
              resource={team}
              shortcut={shortcut}
              onEdit={() => setEdit(true)}
              editDescriptionTo={`/teams/${team.id}/description/edit`}
              onRefresh={onRefresh}
              onLeave={() => setLeave(true)}
            />
          }
        />
      }
    >
      {Boolean(shortcut.error) && (
        <WorkspaceShortcutFeedback
          error={shortcut.error}
          pending={shortcut.shortcuts.isFetching}
          onReload={() => void shortcut.reload()}
        />
      )}
      <div className="min-w-0">
        {tab === "overview" && (
          <ResourceDocument source={team.description} kind="teams" />
        )}
        {tab === "members" && <MembersPanel kind="teams" resource={team} />}
        {tab === "projects" && <TeamProjects team={team} />}
      </div>
      <OverlayPresence>
        {edit && (
          <WorkspaceResourceProfileEditor
            kind="teams"
            resource={team}
            onClose={() => setEdit(false)}
            onSaved={() => {
              setEdit(false);
              void queryClient.invalidateQueries({
                queryKey: ["team", team.id],
              });
            }}
          />
        )}
      </OverlayPresence>
      <ConfirmDialog
        open={leave}
        danger
        title="退出团队"
        description={team.name}
        confirmLabel="确认退出"
        pending={submission.pending}
        confirmDisabled={submission.uncertain}
        onClose={() => setLeave(false)}
        onConfirm={() => void leaveTeam()}
      >
        <ErrorNotice error={submission.error} />
        <p className="text-sm leading-6 text-muted">
          退出将移除你的直接团队关系，并影响通过本团队获得的项目权限；其他直接成员关系或团队来源不受影响。若退出最后一位管理员，之后需由系统管理员接管。
        </p>
      </ConfirmDialog>
    </ResourceDetailShell>
  );
}

function TeamProjects({ team }: { team: Resource }) {
  const query = useApiQuery<Resource[]>(
    ["team-projects", team.id],
    `/teams/${team.id}/projects`,
  );
  return (
    <Panel title="关联项目" bodyClassName="p-0">
      <AsyncBoundary
        loading={query.isPending}
        error={query.error}
        onRetry={() => void query.refetch()}
        empty={!query.data?.data.length}
        emptyTitle="尚未加入项目"
        emptyDescription="团队被授权加入项目后，会在这里显示你可见的项目。"
      >
        <SimpleTable
          label="关联项目"
          headers={["项目名称", "摘要", "成员", "状态"]}
        >
          {query.data?.data.map((project) => (
            <tr key={project.id}>
              <td>
                <Link
                  to={"/projects/" + project.id}
                  className="inline-flex max-w-full items-center gap-3 rounded-md text-foreground hover:text-primary"
                >
                  <ResourceIcon resource={project} projectId={project.id} />
                  <span className="min-w-0">
                    <strong className="block truncate">{project.name}</strong>
                    <small className="mono block truncate text-muted">
                      {project.code}
                    </small>
                  </span>
                </Link>
              </td>
              <td>{project.summary || "—"}</td>
              <td>{project.member_count} 人</td>
              <td>
                <StatusBadge
                  tone={project.status === "active" ? "success" : "neutral"}
                >
                  {project.status === "active" ? "正常" : "已归档"}
                </StatusBadge>
              </td>
            </tr>
          ))}
        </SimpleTable>
      </AsyncBoundary>
    </Panel>
  );
}
