import { Link } from "react-router";
import { Panel } from "@/components/layout";
import type { Resource } from "@/types/collaboration";
import { ProjectResourceSummary } from "@/features/collaboration/project-resource-summary";

export function ProjectOverview({ project }: { project: Resource }) {
  return (
    <div className="workspace-project-overview">
      <ProjectResourceSummary project={project} />
      <Panel
        className="project-overview-introduction"
        title="项目介绍"
        action={
          <Link className="link" to={`/projects/${project.id}?tab=description`}>
            查看完整介绍
          </Link>
        }
      >
        <p className="whitespace-pre-wrap text-sm text-muted">
          {project.summary || "尚未填写项目摘要。"}
        </p>
      </Panel>
      <Panel
        title="Git 仓库"
        action={
          <Link
            className="link"
            to={`/projects/${project.id}?tab=repositories`}
          >
            查看仓库与标签
          </Link>
        }
      >
        <p className="text-sm text-muted">
          通过关联仓库组织项目资源，使用标签区分仓库用途。
        </p>
      </Panel>
      <Panel title="项目协作">
        <div className="flex gap-6">
          <Link
            className="link"
            to={`/projects/${project.id}?tab=settings&section=members`}
          >
            成员管理
          </Link>
          <Link
            className="link"
            to={`/projects/${project.id}?tab=settings&section=teams`}
          >
            团队授权
          </Link>
        </div>
      </Panel>
    </div>
  );
}
