import { useParams } from "react-router";
import { AsyncBoundary } from "@/components/feedback";
import { ResourceDetailShell } from "@/components/layout";
import { useApiQuery } from "@/hooks/use-api";
import type { Resource } from "@/types/collaboration";
import { EventsPage } from "@/features/events/page";

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
        <ResourceDetailShell wide>
          <EventsPage project={query.data.data} />
        </ResourceDetailShell>
      )}
    </AsyncBoundary>
  );
}
