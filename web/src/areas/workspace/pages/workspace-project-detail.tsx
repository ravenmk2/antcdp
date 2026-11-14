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
import {
  ArrowRight,
  Cable,
  FileText,
  Server,
  Users,
  UsersRound,
} from "lucide-react";
import { request } from "@/api/client";
import { useAuth, useSession } from "@/app/auth";
import { Button } from "@/components/button";
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
import { MembersPanel } from "@/areas/workspace/pages/member-panels";
import { WorkspaceResourceProfileEditor } from "@/areas/workspace/pages/resource-profile-editor";
import { ProjectDescription } from "@/areas/workspace/pages/project-description";
import { ProjectOverview } from "@/areas/workspace/pages/project-overview";
import { useWorkspaceShortcut } from "@/areas/workspace/pages/use-workspace-shortcut";
import { WorkspaceResourceActions } from "@/areas/workspace/pages/workspace-resource-actions";
import { WorkspaceShortcutFeedback } from "@/areas/workspace/pages/workspace-shortcut-feedback";
import { WorkspaceProjectFrame } from "@/areas/workspace/pages/workspace-project-frame";
import {
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
    <WorkspaceProjectFrame
      project={project}
      active={view.page}
      actions={actions}
    >
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
  const [, setParams] = useSearchParams();
  const links = [
    { key: "profile", label: "基本资料", icon: FileText },
    { key: "members", label: "成员管理", icon: Users },
    { key: "teams", label: "团队授权", icon: UsersRound },

    { key: "integrations", label: "服务凭证", icon: Cable },
    { key: "hosts", label: "SSH 凭证", icon: Server },
  ] as const;

  function select(key: WorkspaceProjectSettingSection) {
    setParams((current) => {
      const next = new URLSearchParams(current);
      next.set("tab", "settings");
      next.set("section", key);
      next.delete("release");
      return next;
    });
  }

  return (
    <div className="settings-layout workspace-project-settings">
      <nav className="settings-nav" aria-label="项目设置分类">
        {links.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            type="button"
            aria-pressed={section === key}
            onClick={() => select(key)}
          >
            <Icon />
            {label}
          </button>
        ))}
      </nav>
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
        {section === "teams" && <ProjectTeams resource={project} />}

        {section === "integrations" && (
          <CredentialLinkPanel
            title="项目服务凭证"
            description="维护当前项目归属的访问凭证；连接配置与系统秘密仍由系统管理员管理。"
            to={`/projects/${project.id}/integrations`}
            label="管理服务凭证"
          />
        )}
        {section === "hosts" && (
          <CredentialLinkPanel
            title="项目 SSH 凭证"
            description="主机地址与公钥信任由系统管理员维护；此处只维护项目归属凭证。"
            to={`/projects/${project.id}/remote-hosts`}
            label="管理 SSH 凭证"
          />
        )}
      </div>
    </div>
  );
}

function CredentialLinkPanel({
  title,
  description,
  to,
  label,
}: {
  title: string;
  description: string;
  to: string;
  label: string;
}) {
  return (
    <Panel
      title={title}
      action={
        <Button
          render={
            <Link to={to}>
              {label} <ArrowRight />
            </Link>
          }
          nativeButton={false}
          role="link"
          size="sm"
        />
      }
    >
      <p className="text-sm text-muted">{description}</p>
    </Panel>
  );
}
