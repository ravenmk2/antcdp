import { useParams } from "react-router";
import { AsyncBoundary } from "@/components/feedback";
import { useApiQuery } from "@/hooks/use-api";
import type { Resource } from "@/types/collaboration";
import { EventsPage } from "@/features/events/page";
import { WorkspaceProjectFrame } from "./workspace-project-frame";

export function ProjectEventsPage() {
  const { projectId } = useParams();
  const query = useApiQuery<Resource>(
    ["project", projectId],
    `/projects/${projectId}`,
  );
  return (
    <AsyncBoundary
      loading={query.isPending}
      error={query.error}
      onRetry={() => query.refetch()}
    >
      {query.data && (
        <WorkspaceProjectFrame project={query.data.data} wide>
          <EventsPage project={query.data.data} />
        </WorkspaceProjectFrame>
      )}
    </AsyncBoundary>
  );
}
