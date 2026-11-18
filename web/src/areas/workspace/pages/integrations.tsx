import { IntegrationPage } from "@/features/integrations/page";
export function IntegrationsPage({
  scope = "project",
}: {
  scope?: "account" | "project";
}) {
  return <IntegrationPage context={{ kind: scope }} divided />;
}
