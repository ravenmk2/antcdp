import { RemovedProjectPage } from "@/features/collaboration/removed-project-page";
import { NotFound } from "@/app/not-found";
import { RegionError, RegionLoader } from "@/app/region-loader";
import { lazy } from "react";
import { type RouteObject } from "react-router";
const OverviewPage = lazy(() =>
  import("@/areas/console/pages/overview-page").then((m) => ({
    default: m.OverviewPage,
  })),
);
const AgentsPage = lazy(() =>
  import("@/areas/console/pages/agents/agents-page").then((m) => ({
    default: m.AgentsPage,
  })),
);
const AgentUsagePage = lazy(() =>
  import("@/areas/console/pages/agents/usage-page").then((m) => ({
    default: m.AgentUsagePage,
  })),
);
const AgentCreatePage = lazy(() =>
  import("@/areas/console/pages/agents/agents-page").then((m) => ({
    default: m.AgentCreatePage,
  })),
);
const AgentDetailPage = lazy(() =>
  import("@/areas/console/pages/agents/agents-page").then((m) => ({
    default: m.AgentDetailPage,
  })),
);
const AgentPromptPage = lazy(() =>
  import("@/areas/console/pages/agents/agents-page").then((m) => ({
    default: m.AgentPromptPage,
  })),
);
const WebAccessPage = lazy(() =>
  import("@/areas/console/pages/agents/web-access-page").then((m) => ({
    default: m.WebAccessPage,
  })),
);
const WebAccessCreatePage = lazy(() =>
  import("@/areas/console/pages/agents/web-access-page").then((m) => ({
    default: m.WebAccessCreatePage,
  })),
);
const WebAccessSettingsPage = lazy(() =>
  import("@/areas/console/pages/agents/web-access-page").then((m) => ({
    default: m.WebAccessSettingsPage,
  })),
);
const WebAccessDetailPage = lazy(() =>
  import("@/areas/console/pages/agents/web-access-page").then((m) => ({
    default: m.WebAccessDetailPage,
  })),
);
const MCPServersPage = lazy(() =>
  import("@/areas/console/pages/agents/mcp-page").then((m) => ({
    default: m.MCPServersPage,
  })),
);
const MCPServerCreatePage = lazy(() =>
  import("@/areas/console/pages/agents/mcp-page").then((m) => ({
    default: m.MCPServerCreatePage,
  })),
);
const MCPServerDetailPage = lazy(() =>
  import("@/areas/console/pages/agents/mcp-page").then((m) => ({
    default: m.MCPServerDetailPage,
  })),
);
const SkillsPage = lazy(() =>
  import("@/areas/console/pages/agents/skills-page").then((m) => ({
    default: m.SkillsPage,
  })),
);
const SkillCreatePage = lazy(() =>
  import("@/areas/console/pages/agents/skills-page").then((m) => ({
    default: m.SkillCreatePage,
  })),
);
const SkillDetailPage = lazy(() =>
  import("@/areas/console/pages/agents/skills-page").then((m) => ({
    default: m.SkillDetailPage,
  })),
);
const SkillUploadPage = lazy(() =>
  import("@/areas/console/pages/agents/skills-page").then((m) => ({
    default: m.SkillUploadPage,
  })),
);
const SkillVersionPage = lazy(() =>
  import("@/areas/console/pages/agents/skills-page").then((m) => ({
    default: m.SkillVersionPage,
  })),
);
const UsersPage = lazy(() =>
  import("@/areas/console/pages/users-page").then((m) => ({
    default: m.UsersPage,
  })),
);
const ModelProvidersPage = lazy(() =>
  import("@/areas/console/pages/models-page").then((m) => ({
    default: m.ModelProvidersPage,
  })),
);
const ModelProviderDetailPage = lazy(() =>
  import("@/areas/console/pages/models-page").then((m) => ({
    default: m.ModelProviderDetailPage,
  })),
);
const ResourceList = lazy(() =>
  import("@/areas/console/pages/resource-list").then((m) => ({
    default: m.ResourceList,
  })),
);
const ProjectDescriptionEditor = lazy(() =>
  import("@/areas/console/pages/projects/project-description-editor").then(
    (m) => ({ default: m.ProjectDescriptionEditor }),
  ),
);
const IntegrationsPage = lazy(() =>
  import("@/areas/console/pages/integrations").then((m) => ({
    default: m.IntegrationsPage,
  })),
);
const RemoteHostsPage = lazy(() =>
  import("@/areas/console/pages/remote-hosts").then((m) => ({
    default: m.RemoteHostsPage,
  })),
);
const AdminProjectDetail = lazy(() =>
  import("@/areas/console/pages/project-detail").then((m) => ({
    default: m.AdminProjectDetail,
  })),
);
const AdminTeamDetail = lazy(() =>
  import("@/areas/console/pages/teams/team-detail").then((m) => ({
    default: m.AdminTeamDetail,
  })),
);
const TeamDescriptionEditor = lazy(() =>
  import("@/areas/console/pages/teams/team-description-editor").then((m) => ({
    default: m.TeamDescriptionEditor,
  })),
);
const SettingsPage = lazy(() =>
  import("@/areas/console/pages/settings-page").then((m) => ({
    default: m.SettingsPage,
  })),
);
const AuditPage = lazy(() =>
  import("@/areas/console/pages/audit-page").then((m) => ({
    default: m.AuditPage,
  })),
);
const EmailPage = lazy(() =>
  import("@/areas/console/pages/email-page").then((m) => ({
    default: m.EmailPage,
  })),
);
const SmsPage = lazy(() =>
  import("@/areas/console/pages/sms-page").then((m) => ({
    default: m.SmsPage,
  })),
);
const DingTalkPage = lazy(() =>
  import("@/areas/console/pages/dingtalk-page").then((m) => ({
    default: m.DingTalkPage,
  })),
);
const CloudComputersPage = lazy(() =>
  import("./pages/cloud-computers").then((m) => ({
    default: m.CloudComputersPage,
  })),
);
const CloudSettingsPage = lazy(() =>
  import("./pages/cloud-computers").then((m) => ({
    default: m.CloudSettingsPage,
  })),
);
const CloudComputerDetailPage = lazy(() =>
  import("./pages/cloud-computers").then((m) => ({
    default: m.CloudComputerDetailPage,
  })),
);
const RobotsPage = lazy(() =>
  import("./pages/robots-page").then((m) => ({ default: m.RobotsPage })),
);
const AgentDebugPage = lazy(() =>
  import("./pages/agents/debug-page").then((m) => ({
    default: m.AgentDebugPage,
  })),
);
const Root = lazy(() => import("./root"));
export const consoleRoutes: RouteObject[] = [
  {
    element: (
      <RegionLoader label="控制台">
        <Root />
      </RegionLoader>
    ),
    errorElement: <RegionError label="控制台" />,
    children: [
      { index: true, element: <OverviewPage /> },
      { path: "agents", element: <AgentsPage /> },
      { path: "agent-usage", element: <AgentUsagePage /> },
      { path: "robots", element: <RobotsPage /> },
      { path: "cloud-computers", element: <CloudComputersPage /> },
      { path: "cloud-computers/settings", element: <CloudSettingsPage /> },
      {
        path: "cloud-computers/:computerId",
        element: <CloudComputerDetailPage />,
      },
      {
        path: "agents/:agentId/debug/:sessionId?",
        element: <AgentDebugPage />,
      },
      { path: "agents/new", element: <AgentCreatePage /> },
      { path: "agents/:agentId", element: <AgentDetailPage /> },
      { path: "agents/:agentId/prompt", element: <AgentPromptPage /> },
      { path: "web-access", element: <WebAccessPage /> },
      { path: "web-access/new", element: <WebAccessCreatePage /> },
      { path: "web-access/settings", element: <WebAccessSettingsPage /> },
      { path: "web-access/:providerId", element: <WebAccessDetailPage /> },
      { path: "mcp-servers", element: <MCPServersPage /> },
      { path: "mcp-servers/new", element: <MCPServerCreatePage /> },
      { path: "mcp-servers/:serverId", element: <MCPServerDetailPage /> },
      { path: "skills", element: <SkillsPage /> },
      { path: "skills/new", element: <SkillCreatePage /> },
      { path: "skills/:skillId", element: <SkillDetailPage /> },
      { path: "skills/:skillId/upload", element: <SkillUploadPage /> },
      {
        path: "skills/:skillId/versions/:versionId",
        element: <SkillVersionPage />,
      },
      { path: "users", element: <UsersPage /> },
      { path: "models", element: <ModelProvidersPage /> },
      { path: "models/new", element: <ModelProvidersPage /> },
      { path: "models/:providerId", element: <ModelProviderDetailPage /> },
      { path: "projects", element: <ResourceList kind="projects" /> },
      { path: "teams", element: <ResourceList kind="teams" /> },
      {
        path: "projects/:projectId/description/edit",
        element: <ProjectDescriptionEditor />,
      },
      {
        path: "projects/:projectId/variants/:variantId/releases/:releaseId",
        element: <RemovedProjectPage />,
      },
      {
        path: "projects/:projectId/variants/*",
        element: <RemovedProjectPage />,
      },
      {
        path: "projects/:projectId/integrations/:connectionId?",
        element: <IntegrationsPage project />,
      },
      {
        path: "projects/:projectId/remote-hosts/:hostId?",
        element: <RemoteHostsPage project />,
      },
      { path: "projects/:projectId", element: <AdminProjectDetail /> },
      { path: "teams/:teamId", element: <AdminTeamDetail /> },
      {
        path: "teams/:teamId/description/edit",
        element: <TeamDescriptionEditor />,
      },
      { path: "settings", element: <SettingsPage /> },
      { path: "audit", element: <AuditPage /> },
      { path: "integrations/:connectionId?", element: <IntegrationsPage /> },
      { path: "remote-hosts/:hostId?", element: <RemoteHostsPage /> },
      { path: "email/:section?/:id?", element: <EmailPage /> },
      { path: "sms/:section?/:id?", element: <SmsPage /> },
      { path: "dingtalk/:id?", element: <DingTalkPage /> },
      { path: "*", element: <NotFound /> },
    ],
  },
];
