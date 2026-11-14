import { useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowRight, FileText, FolderGit2, Users } from "lucide-react";
import { request } from "@/api/client";
import { useSession } from "@/app/auth";
import { AsyncBoundary, ErrorNotice, StatusBadge } from "@/components/feedback";
import {
  Panel,
  ResourceDetailShell,
  ResourceHeader,
  Tabs,
} from "@/components/layout";
import { ConfirmDialog } from "@/components/overlays";
import { OverlayPresence } from "@/components/overlay-presence";
import { ResourceIcon } from "@/components/resource-icon";
import { useApiQuery } from "@/hooks/use-api";
import { useSubmission } from "@/hooks/use-form";
import { recordRecent } from "@/lib/recent";
import type { Resource } from "@/types/collaboration";
import {
  ResourceDocument,
  ResourceMetadata,
} from "@/features/collaboration/resource-detail";
import { MembersPanel } from "@/areas/workspace/pages/member-panels";
import { WorkspaceResourceProfileEditor } from "@/areas/workspace/pages/resource-profile-editor";
import { useWorkspaceShortcut } from "@/areas/workspace/pages/use-workspace-shortcut";
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
  const [params, setParams] = useSearchParams();
  const queryClient = useQueryClient();
  const [edit, setEdit] = useState(false);
  const [leave, setLeave] = useState(false);
  const submission = useSubmission();
  const shortcut = useWorkspaceShortcut("teams");
  const tab = normalizeWorkspaceTeamTab(params.get("tab"));
  const tabs = [
    {
      value: "overview",
      label: (
        <span className="inline-flex items-center gap-2">
          <FileText />
          团队介绍
        </span>
      ),
    },
    {
      value: "members",
      label: (
        <span className="inline-flex items-center gap-2">
          <Users />
          成员管理
        </span>
      ),
    },
    {
      value: "projects",
      label: (
        <span className="inline-flex items-center gap-2">
          <FolderGit2 />
          关联项目
        </span>
      ),
    },
  ];

  useEffect(() => {
    recordRecent(session.user.id, {
      id: team.id,
      name: team.name,
      kind: "team",
      to: `/teams/${team.id}`,
    });
  }, [session.user.id, team.id, team.name]);

  function changeTab(value: string) {
    setParams((current) => {
      const next = new URLSearchParams(current);
      if (value === "overview") next.delete("tab");
      else next.set("tab", value);
      return next;
    });
  }

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
        <ResourceHeader
          icon={<ResourceIcon resource={team} className="size-11" />}
          title={team.name}
          badge={
            <StatusBadge
              tone={team.status === "active" ? "success" : "neutral"}
            >
              {team.status === "active" ? "正常" : "已解散"}
            </StatusBadge>
          }
          meta={<ResourceMetadata resource={team} kind="teams" />}
          summary={team.summary}
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
      navigation={
        <Tabs
          label={`${team.name}功能`}
          items={tabs}
          value={tab}
          onChange={changeTab}
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
        <ul className="divide-y divide-border-subtle">
          {query.data?.data.map((project) => (
            <li key={project.id}>
              <Link
                to={`/projects/${project.id}`}
                className="flex items-center gap-3 px-5 py-4 hover:bg-surface-hover"
              >
                <ResourceIcon resource={project} />
                <div className="min-w-0 flex-1">
                  <strong>{project.name}</strong>
                  <small className="mono block text-muted">
                    {project.code}
                  </small>
                </div>
                <StatusBadge
                  tone={project.status === "active" ? "success" : "neutral"}
                >
                  {project.status === "active" ? "正常" : "已归档"}
                </StatusBadge>
                <ArrowRight className="size-4 text-faint" />
              </Link>
            </li>
          ))}
        </ul>
      </AsyncBoundary>
    </Panel>
  );
}
