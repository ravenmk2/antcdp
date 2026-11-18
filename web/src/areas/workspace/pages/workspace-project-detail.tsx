import { isRemovedProjectView } from "@/features/collaboration/project-navigation";
import { useEffect, useState } from "react";
import {
  Link,
  Navigate,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";
import { request } from "@/api/client";
import { useAuth, useSession } from "@/app/auth";
import { CopyButton } from "@/components/copy-button";
import { AsyncBoundary, ErrorNotice } from "@/components/feedback";
import { DescriptionList, PageHeader, Panel } from "@/components/layout";
import { ConfirmDialog } from "@/components/overlays";
import { OverlayPresence } from "@/components/overlay-presence";
import { useApiQuery } from "@/hooks/use-api";
import { useSubmission } from "@/hooks/use-form";
import { formatDate } from "@/lib/utils";
import { recordRecent } from "@/lib/recent";
import type { Resource } from "@/types/collaboration";
import { ProjectRepositories } from "@/features/repositories/repositories";
import { ProjectTeams } from "@/features/collaboration/members";
import { ProjectRoles } from "@/features/collaboration/project-roles";
import { MembersPanel } from "@/areas/workspace/pages/member-panels";
import { WorkspaceResourceProfileEditor } from "@/areas/workspace/pages/resource-profile-editor";
import { ProjectDescription } from "@/areas/workspace/pages/project-description";
import { ProjectOverview } from "@/areas/workspace/pages/project-overview";
import { useWorkspaceShortcut } from "@/areas/workspace/pages/use-workspace-shortcut";
import { WorkspaceResourceActions } from "@/areas/workspace/pages/workspace-resource-actions";
import { WorkspaceShortcutFeedback } from "@/areas/workspace/pages/workspace-shortcut-feedback";
import { WorkspaceProjectFrame } from "@/areas/workspace/pages/workspace-project-frame";
import {
  projectSectionRoutes,
  resolveWorkspaceProjectView,
  type WorkspaceProjectSettingSection,
} from "@/areas/workspace/pages/workspace-navigation";

export function WorkspaceProjectDetail() {
  const { projectId } = useParams();
  const query = useApiQuery<Resource>(
    ["project", projectId],
    `/projects/${projectId ?? ""}`,
    { enabled: Boolean(projectId && /^[1-9]\d*$/.test(projectId)) },
  );
  return (
    <AsyncBoundary
      loading={query.isPending}
      error={query.error}
      onRetry={() => void query.refetch()}
    >
      {query.data && (
        <ProjectContent
          key={query.data.data.id}
          project={query.data.data}
          onRefresh={() => void query.refetch()}
        />
      )}
    </AsyncBoundary>
  );
}

function ProjectContent({
  project,
  onRefresh,
}: {
  project: Resource;
  onRefresh: () => void;
}) {
  const session = useSession();
  const auth = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const queryClient = useQueryClient();
  const [edit, setEdit] = useState(false);
  const [leave, setLeave] = useState(false);
  const submission = useSubmission();
  const shortcut = useWorkspaceShortcut("projects");
  const view = resolveWorkspaceProjectView(
    `/projects/${project.id}`,
    params.toString(),
  )!;

  useEffect(() => {
    recordRecent(session.user.id, {
      id: project.id,
      name: project.name,
      kind: "project",
      to: `/projects/${project.id}`,
    });
  }, [project.id, project.name, session.user.id]);

  async function leaveProject() {
    const ok = await submission.run(async () => {
      await request(`/projects/${project.id}/leave`, {
        method: "POST",
        body: {},
      });
      await queryClient.invalidateQueries();
    });
    if (ok) navigate("/projects");
  }

  if (isRemovedProjectView(params))
    return <Navigate replace to={`/projects/${project.id}`} />;
  if (view.page === "events")
    return <Navigate replace to={`/projects/${project.id}/events`} />;
  if (view.page === "jobs")
    return <Navigate replace to={`/projects/${project.id}/jobs`} />;

  const destination =
    view.page === "settings" && projectSectionRoutes[view.section];
  if (destination) {
    const next = new URLSearchParams(params);
    next.delete("tab");
    next.delete("section");
    return (
      <Navigate
        replace
        to={{
          pathname: "/projects/" + project.id + "/" + destination,
          search: next.toString(),
        }}
      />
    );
  }

  const actions = (
    <WorkspaceResourceActions
      kind="projects"
      resource={project}
      shortcut={shortcut}
      onEdit={() => setEdit(true)}
      editDescriptionTo={`/projects/${project.id}/description/edit`}
      onRefresh={onRefresh}
      onLeave={() => setLeave(true)}
    />
  );

  return (
    <WorkspaceProjectFrame project={project} actions={actions}>
      {Boolean(shortcut.error) && (
        <WorkspaceShortcutFeedback
          error={shortcut.error}
          pending={shortcut.shortcuts.isFetching}
          onReload={() => void shortcut.reload()}
        />
      )}

      {view.page === "overview" && <ProjectOverview project={project} />}

      {view.page === "repositories" && (
        <>
          <PageHeader
            title="Git 仓库"
            description="查看本地快照、默认分支与同步结果，不代表远端实时健康。"
          />
          <ProjectRepositories project={project} />
        </>
      )}
      {view.page === "description" && <ProjectDescription project={project} />}
      {view.page === "settings" && (
        <WorkspaceProjectSettings
          project={project}
          section={view.section}
          timezone={auth.settings.timezone}
        />
      )}

      <OverlayPresence>
        {edit && (
          <WorkspaceResourceProfileEditor
            kind="projects"
            resource={project}
            onClose={() => setEdit(false)}
            onSaved={() => {
              setEdit(false);
              void queryClient.invalidateQueries({
                queryKey: ["project", project.id],
              });
            }}
          />
        )}
      </OverlayPresence>
      <ConfirmDialog
        open={leave}
        danger
        title="退出项目"
        description={project.name}
        confirmLabel="确认退出"
        pending={submission.pending}
        confirmDisabled={submission.uncertain}
        onClose={() => setLeave(false)}
        onConfirm={() => void leaveProject()}
      >
        <ErrorNotice error={submission.error} />
        <p className="text-sm leading-6 text-muted">
          只移除你的直接关系；团队继承来源可能仍然保留。若退出最后一位管理员，之后需由系统管理员接管。
        </p>
      </ConfirmDialog>
    </WorkspaceProjectFrame>
  );
}

function WorkspaceProjectSettings({
  project,
  section,
  timezone,
}: {
  project: Resource;
  section: WorkspaceProjectSettingSection;
  timezone: string;
}) {
  return (
    <div className="min-w-0">
      {section === "profile" && (
        <Panel title="项目资料">
          <DescriptionList
            items={[
              { label: "项目名称", value: project.name },
              {
                label: "项目编码",
                value: (
                  <span className="inline-flex items-center gap-1">
                    <span className="mono">{project.code}</span>
                    <CopyButton value={project.code} label="复制项目编码" />
                  </span>
                ),
              },
              {
                label: "项目状态",
                value: project.status === "active" ? "正常" : "已归档",
              },
              { label: "成员数量", value: `${project.member_count} 人` },
              {
                label: "创建时间",
                value: formatDate(project.created_at, timezone),
              },
              {
                label: "最近更新",
                value: formatDate(project.updated_at, timezone),
              },
              {
                label: "摘要",
                value: project.summary || "—",
                full: true,
              },
            ]}
          />
          <div className="mt-5 border-t border-t-border-subtle pt-4">
            <Link
              className="link inline-flex items-center gap-2"
              to={`/projects/${project.id}?tab=description`}
            >
              阅读项目介绍 <ArrowRight />
            </Link>
          </div>
        </Panel>
      )}
      {section === "members" && (
        <MembersPanel kind="projects" resource={project} />
      )}
      {section === "roles" && <ProjectRoles project={project} />}
      {section === "teams" && <ProjectTeams resource={project} />}
    </div>
  );
}
