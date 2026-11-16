import { IntegrationPage } from "@/features/integrations/page";
export function IntegrationsPage({ project = false }: { project?: boolean }) {
  return (
    <IntegrationPage context={{ kind: project ? "project" : "platform" }} />
  );
}
