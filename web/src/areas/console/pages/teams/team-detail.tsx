import { useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  FileText,
  FolderGit2,
  Pencil,
  Trash2,
  Users,
} from "lucide-react";
import { useSession } from "@/app/auth";
import { AsyncBoundary, StatusBadge } from "@/components/feedback";
import {
  Panel,
  ResourceDetailShell,
  ResourceHeader,
  Tabs,
} from "@/components/layout";
import { OverlayPresence } from "@/components/overlay-presence";
import { ResourceIcon } from "@/components/resource-icon";
import {
  RowAction,
  RowActions,
  RowActionSeparator,
} from "@/components/row-actions";
import { MembersPanel } from "@/areas/console/pages/teams/team-members";
import { TeamProfileEditor } from "@/areas/console/pages/teams/team-profile-editor";
import { useApiQuery } from "@/hooks/use-api";
import type { Resource } from "@/types/collaboration";
import {
  ResourceDocument,
  ResourceMetadata,
} from "@/features/collaboration/resource-detail";
import { TeamDissolveDialog } from "@/areas/console/pages/teams/team-dissolve-dialog";

export function AdminTeamDetail() {
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
        <TeamContent key={query.data.data.id} team={query.data.data} />
      )}
    </AsyncBoundary>
  );
}

function TeamContent({ team }: { team: Resource }) {
  const session = useSession();
  const [params, setParams] = useSearchParams();
  const queryClient = useQueryClient();
  const [edit, setEdit] = useState(false);
  const [dissolve, setDissolve] = useState(false);
  const requestedTab = params.get("tab");
  const normalizedTab = requestedTab === "settings" ? "overview" : requestedTab;
  const tabs = [
    {
      value: "overview",
      label: (
        <span className="inline-flex items-center gap-2">
          <FileText className="size-4" />
          团队介绍
        </span>
      ),
    },
    {
      value: "members",
      label: (
        <span className="inline-flex items-center gap-2">
          <Users className="size-4" />
          成员管理
        </span>
      ),
    },
    {
      value: "projects",
      label: (
        <span className="inline-flex items-center gap-2">
          <FolderGit2 className="size-4" />
          关联项目
        </span>
      ),
    },
  ];
  const tab = tabs.some((item) => item.value === normalizedTab)
    ? normalizedTab!
    : "overview";

  function changeTab(value: string) {
    setParams((current) => {
      const next = new URLSearchParams(current);
      if (value === "overview") next.delete("tab");
      else next.set("tab", value);
      next.delete("release");
      return next;
    });
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
            session.user.role === "admin" && (
              <RowActions label={team.name}>
                <RowAction
                  icon={<Pencil />}
                  disabled={!team.can_manage}
                  onSelect={() => setEdit(true)}
                >
                  编辑资料
                </RowAction>
                <RowAction
                  icon={<FileText />}
                  disabled={!team.can_manage}
                  to={
                    team.can_manage
                      ? `/admin/teams/${team.id}/description/edit`
                      : undefined
                  }
                >
                  编辑介绍
                </RowAction>
                <RowActionSeparator />
                <RowAction
                  icon={<Trash2 />}
                  variant="destructive"
                  disabled={team.status === "dissolved"}
                  onSelect={() => setDissolve(true)}
                >
                  解散团队
                </RowAction>
              </RowActions>
            )
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
      <div className="min-w-0">
        {tab === "overview" && (
          <ResourceDocument source={team.description} kind="teams" />
        )}
        {tab === "members" && <MembersPanel team={team} />}
        {tab === "projects" && <TeamProjects team={team} />}
      </div>
      <OverlayPresence>
        {edit && (
          <TeamProfileEditor
            team={team}
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
      {dissolve && (
        <TeamDissolveDialog team={team} onClose={() => setDissolve(false)} />
      )}
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
      >
        <ul className="divide-y divide-border-subtle">
          {query.data?.data.map((project) => (
            <li key={project.id}>
              <Link
                to={`/admin/projects/${project.id}`}
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
