import { useParams } from "react-router";
import { AsyncBoundary, Notice } from "@/components/feedback";
import { useApiQuery } from "@/hooks/use-api";
import type { Resource } from "@/types/collaboration";
import { JobsPage } from "@/features/jobs/page";
import { DingTalkPage } from "@/features/dingtalk/page";
import { WorkspaceProjectFrame } from "./workspace-project-frame";
export function ProjectJobsPage({ robots = false }: { robots?: boolean }) {
  const { projectId } = useParams();
  const q = useApiQuery<Resource>(
    ["project", projectId],
    `/projects/${projectId}`,
  );
  return (
    <AsyncBoundary
      loading={q.isPending}
      error={q.error}
      onRetry={() => void q.refetch()}
    >
      {q.data && (
        <WorkspaceProjectFrame
          project={q.data.data}
          active={robots ? "settings" : "jobs"}
          wide
        >
          {robots ? (
            q.data.data.can_manage ? (
              <DingTalkPage />
            ) : (
              <Notice tone="danger">只有项目管理员可以管理项目机器人。</Notice>
            )
          ) : (
            <JobsPage project={q.data.data} />
          )}
        </WorkspaceProjectFrame>
      )}
    </AsyncBoundary>
  );
}
