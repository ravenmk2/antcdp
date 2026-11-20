import { useParams } from "react-router";
import { ConsoleListPage } from "@/areas/console/components/list-page";
import { IntegrationPage } from "@/features/integrations/page";
export function IntegrationsPage({ project = false }: { project?: boolean }) {
  const { connectionId } = useParams();
  const view = (
    <IntegrationPage context={{ kind: project ? "project" : "platform" }} />
  );
  return connectionId ? view : <ConsoleListPage nested>{view}</ConsoleListPage>;
}
