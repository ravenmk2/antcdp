import { useState } from "react";
import { Link } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Plus, Star, Users } from "lucide-react";
import { useSession } from "@/app/auth";
import { request } from "@/api/client";
import { Button, IconButton } from "@/components/button";
import { AsyncBoundary, EmptyState } from "@/components/feedback";
import { PageHeader, Panel } from "@/components/layout";
import { ResourceIcon } from "@/components/resource-icon";
import { useApiQuery } from "@/hooks/use-api";
import { useSubmission } from "@/hooks/use-form";
import { recentResources } from "@/lib/recent";
import type { Page, Resource, Shortcuts } from "@/types/collaboration";
import { ShortcutEditor } from "./shortcuts";
import { HomeAttentionPanel, HomeReleasePanel } from "./project-overview";

export function HomePage() {
  const session = useSession();
  const [manage, setManage] = useState<"projects" | "teams" | null>(null);
  const shortcuts = useApiQuery<Shortcuts>(
    ["shortcuts", session.user.id],
    "/me/sidebar-shortcuts",
  );
  const projects = useApiQuery<Page<Resource>>(
    ["home-projects", session.user.id],
    "/projects?scope=mine&status=active&page=1&page_size=100",
  );
  const teams = useApiQuery<Page<Resource>>(
    ["home-teams", session.user.id],
    "/teams?scope=mine&status=active&page=1&page_size=100",
  );
  const queryClient = useQueryClient();
  const submission = useSubmission();
  const recent = recentResources(session.user.id);
  const followedIds =
    shortcuts.data?.data.projects.items.map((item) => item.id) ?? [];
  const recentProject = recent.find((item) => item.kind === "project");
  const currentId =
    (recentProject && followedIds.includes(recentProject.id)
      ? recentProject.id
      : followedIds[0]) ?? recentProject?.id;
  const currentProject =
    projects.data?.data.items.find((item) => item.id === currentId) ??
    projects.data?.data.items[0];
  const projectById = new Map(
    (projects.data?.data.items ?? []).map((item) => [item.id, item]),
  );
  const teamById = new Map(
    (teams.data?.data.items ?? []).map((item) => [item.id, item]),
  );
  const error = shortcuts.error ?? projects.error ?? teams.error;

  async function toggleProject(project: Resource) {
    const group = shortcuts.data?.data.projects;
    if (!group) return;
    await submission.run(async () => {
      await request("/me/sidebar-shortcuts/projects", {
        method: "PUT",
        etag: group.etag,
        body: {
          ids: group.items
            .map((item) => item.id)
            .filter((id) => id !== project.id),
        },
      });
      await queryClient.invalidateQueries({ queryKey: ["shortcuts"] });
    });
  }

  return (
    <div className="page">
      <PageHeader
        title="我的工作区"
        description="查看本人参与的项目、团队，以及当前项目需要继续处理的交付事项。"
        actions={
          <>
            <Button variant="outline" onClick={() => setManage("projects")}>
              <Star />
              管理关注
            </Button>
            {currentProject?.can_manage ? (
              <Button asChild>
                <Link
                  to={`/projects/${currentProject.id}?tab=releases&create=1`}
                >
                  <Plus />
                  创建发布
                </Link>
              </Button>
            ) : (
              <Button disabled title="选择可管理的项目后创建发布">
                <Plus />
                创建发布
              </Button>
            )}
          </>
        }
      />
      <AsyncBoundary
        loading={shortcuts.isPending || projects.isPending || teams.isPending}
        error={error}
        onRetry={() => {
          void shortcuts.refetch();
          void projects.refetch();
          void teams.refetch();
        }}
      >
        {shortcuts.data && projects.data && teams.data && (
          <>
            <div className="workspace-home-grid">
              <Panel
                title={
                  <>
                    关注项目
                    <span className="panel-count">
                      {shortcuts.data.data.projects.items.length}
                    </span>
                  </>
                }
                action={
                  <Link className="link text-xs" to="/projects">
                    我的全部项目 <ArrowRight className="inline size-3" />
                  </Link>
                }
                bodyClassName="p-0"
              >
                {shortcuts.data.data.projects.items.length ? (
                  <div className="project-card-grid">
                    {shortcuts.data.data.projects.items.map((item) => {
                      const project = projectById.get(item.id);
                      if (!project) return null;
                      return (
                        <article className="project-card" key={project.id}>
                          <div className="project-card-top">
                            <ResourceIcon resource={project} />
                            <Link
                              className="project-card-title"
                              to={`/projects/${project.id}`}
                            >
                              <strong>{project.name}</strong>
                              <small>{project.code}</small>
                            </Link>
                            <IconButton
                              size="iconSm"
                              className="star-active -mt-1 -mr-1"
                              label={`取消关注 ${project.name}`}
                              disabled={submission.pending}
                              onClick={() => void toggleProject(project)}
                            >
                              <Star />
                            </IconButton>
                          </div>
                          <p>{project.summary || "尚未填写项目摘要。"}</p>
                          <div className="project-card-footer">
                            <span>
                              {project.member_count} 位成员 ·{" "}
                              {project.direct_role === "admin"
                                ? "项目管理员"
                                : project.direct_role === "member"
                                  ? "项目成员"
                                  : "团队继承成员"}
                            </span>
                            <Link
                              className="link"
                              to={`/projects/${project.id}`}
                            >
                              进入项目 <ArrowRight className="inline size-3" />
                            </Link>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                ) : (
                  <EmptyState
                    title="还没有关注项目"
                    description="在我的项目中添加关注，让常用项目出现在工作台。"
                    action={
                      <Button asChild size="sm" variant="outline">
                        <Link to="/projects">浏览我的项目</Link>
                      </Button>
                    }
                  />
                )}
              </Panel>
              <Panel
                title={
                  <>
                    固定团队
                    <span className="panel-count">
                      {shortcuts.data.data.teams.items.length}
                    </span>
                  </>
                }
                action={
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setManage("teams")}
                  >
                    管理固定
                  </Button>
                }
                bodyClassName="p-0"
              >
                {shortcuts.data.data.teams.items.length ? (
                  <ul className="compact-list">
                    {shortcuts.data.data.teams.items.map((item) => {
                      const team = teamById.get(item.id);
                      if (!team) return null;
                      return (
                        <li key={team.id}>
                          <Link
                            className="compact-row"
                            to={`/teams/${team.id}`}
                          >
                            <ResourceIcon resource={team} />
                            <span className="compact-row-main">
                              <strong>{team.name}</strong>
                              <small>{team.summary || team.code}</small>
                            </span>
                            <ArrowRight />
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <EmptyState
                    title="还没有固定团队"
                    description="在我的团队中固定常用协作团队。"
                    action={
                      <Button asChild size="sm" variant="outline">
                        <Link to="/teams">
                          <Users />
                          浏览我的团队
                        </Link>
                      </Button>
                    }
                  />
                )}
              </Panel>
            </div>
            {currentProject ? (
              <div className="mt-5 grid gap-5">
                <HomeReleasePanel project={currentProject} />
                <HomeAttentionPanel project={currentProject} />
              </div>
            ) : (
              <Panel className="mt-5" title="项目交付">
                <p className="text-sm text-muted">
                  当前账号尚未参与项目。加入项目后，可在这里继续发布与核实操作。
                </p>
              </Panel>
            )}
          </>
        )}
      </AsyncBoundary>
      {manage && shortcuts.data && (
        <ShortcutEditor
          kind={manage}
          initial={shortcuts.data.data}
          onClose={() => setManage(null)}
        />
      )}
    </div>
  );
}
