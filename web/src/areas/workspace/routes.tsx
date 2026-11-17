import { RemovedProjectPage } from "@/features/collaboration/removed-project-page";
import { NotFound } from "@/app/not-found";
import { RegionError, RegionLoader } from "@/app/region-loader";
import { lazy } from "react";
import { Navigate, type RouteObject } from "react-router";
const HomePage = lazy(() =>
  import("@/areas/workspace/pages/home-page").then((m) => ({
    default: m.HomePage,
  })),
);
const PersonalCloudComputerPage = lazy(() =>
  import("@/areas/workspace/pages/personal-cloud-computer").then((m) => ({
    default: m.PersonalCloudComputerPage,
  })),
);
const AgentSessionPage = lazy(() =>
  import("@/areas/workspace/pages/session-page").then((m) => ({
    default: m.AgentSessionPage,
  })),
);
const WorkspaceProjectList = lazy(() =>
  import("@/areas/workspace/pages/workspace-resource-list").then((m) => ({
    default: m.WorkspaceProjectList,
  })),
);
const WorkspaceTeamList = lazy(() =>
  import("@/areas/workspace/pages/workspace-resource-list").then((m) => ({
    default: m.WorkspaceTeamList,
  })),
);
const ResourceDescriptionEditor = lazy(() =>
  import("@/features/collaboration/resource-description-editor").then((m) => ({
    default: m.ResourceDescriptionEditor,
  })),
);
const WorkspaceProjectDetail = lazy(() =>
  import("@/areas/workspace/pages/workspace-project-detail").then((m) => ({
    default: m.WorkspaceProjectDetail,
  })),
);
const WorkspaceTeamDetail = lazy(() =>
  import("@/areas/workspace/pages/workspace-team-detail").then((m) => ({
    default: m.WorkspaceTeamDetail,
  })),
);
const IntegrationsPage = lazy(() =>
  import("@/areas/workspace/pages/integrations").then((m) => ({
    default: m.IntegrationsPage,
  })),
);
const RemoteHostsPage = lazy(() =>
  import("@/areas/workspace/pages/remote-hosts").then((m) => ({
    default: m.RemoteHostsPage,
  })),
);
const Root = lazy(() => import("./root"));
const ProjectEventsPage = lazy(() =>
  import("./pages/events").then((m) => ({ default: m.ProjectEventsPage })),
);
const ProjectJobsPage = lazy(() =>
  import("./pages/jobs").then((m) => ({ default: m.ProjectJobsPage })),
);
const ConversationsPage = lazy(() =>
  import("./pages/conversations-page").then((m) => ({
    default: m.ConversationsPage,
  })),
);
const AgentDirectory = lazy(() =>
  import("./pages/conversations-page").then((m) => ({
    default: m.AgentDirectory,
  })),
);
export const workspaceRoutes: RouteObject[] = [
  {
    element: (
      <RegionLoader label="工作区">
        <Root />
      </RegionLoader>
    ),
    errorElement: <RegionError label="工作区" />,
    children: [
      { index: true, element: <Navigate to="/home" replace /> },
      { path: "home", element: <HomePage /> },
      { path: "computer", element: <PersonalCloudComputerPage /> },
      { path: "agents", element: <ConversationsPage /> },
      { path: "agent-catalog", element: <AgentDirectory /> },
      { path: "agents/sessions/:sessionId", element: <AgentSessionPage /> },
      { path: "projects", element: <WorkspaceProjectList /> },
      { path: "teams", element: <WorkspaceTeamList /> },
      {
        path: "projects/:projectId/description/edit",
        element: (
          <ResourceDescriptionEditor
            kind="projects"
            returnTo={(project) => `/projects/${project.id}?tab=description`}
          />
        ),
      },
      {
        path: "teams/:teamId/description/edit",
        element: (
          <ResourceDescriptionEditor
            kind="teams"
            returnTo={(team) => `/teams/${team.id}`}
          />
        ),
      },
      { path: "projects/:projectId", element: <WorkspaceProjectDetail /> },
      { path: "projects/:projectId/events", element: <ProjectEventsPage /> },
      {
        path: "projects/:projectId/jobs/:jobId?",
        element: <ProjectJobsPage />,
      },
      {
        path: "projects/:projectId/jobs/:jobId/runs/:runId",
        element: <ProjectJobsPage />,
      },
      {
        path: "projects/:projectId/dingtalk/:robotId?",
        element: <ProjectJobsPage robots />,
      },
      { path: "teams/:teamId", element: <WorkspaceTeamDetail /> },
      { path: "projects/:projectId/variants", element: <RemovedProjectPage /> },
      {
        path: "projects/:projectId/variants/*",
        element: <RemovedProjectPage />,
      },
      {
        path: "projects/:projectId/integrations/:connectionId?",
        element: <IntegrationsPage />,
      },
      {
        path: "projects/:projectId/remote-hosts/:hostId?",
        element: <RemoteHostsPage />,
      },
      { path: "*", element: <NotFound /> },
    ],
  },
];
