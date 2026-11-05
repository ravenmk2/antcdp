import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import {
  createBrowserRouter,
  Link,
  Navigate,
  RouterProvider,
} from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AppRoot, RequireAdmin, RequireAuth } from "./app/auth";
import { AppShell } from "./app/Shell";
import { NotFound } from "./app/not-found";
import { ThemeProvider } from "./app/theme";
import { ToastProvider } from "./components/toast";
import { NavigationGuardProvider } from "./components/navigation-guard";
import { Button } from "./components/button";
import { AuthPage } from "./features/access/auth-page";
import { SetupPage } from "./features/access/setup-page";
import { AccountPage } from "./features/account/account-page";
import { OverviewPage } from "./features/admin/overview-page";
import { UsersPage } from "./features/admin/users-page";
import { SettingsPage } from "./features/admin/settings-page";
import { AuditPage } from "./features/admin/audit-page";
import { MaintenancePage } from "./features/admin/maintenance-page";
import { HomePage } from "./features/workspace/home-page";
import { ResourceList } from "./features/workspace/resource-list";
import { ResourceDetail } from "./features/workspace/resource-detail";
import { VariantsPage, VariantDetailPage } from "./features/delivery/variants";
import { IntegrationsPage } from "./features/integrations/integrations-page";
import { RemoteHostsPage } from "./features/remote-hosts/hosts-page";
import { EmailPage } from "./features/email/email-page";
import { SmsPage } from "./features/sms/sms-page";
import { DingTalkPage } from "./features/dingtalk/dingtalk-page";
import "./styles/app.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { refetchOnWindowFocus: true, refetchOnReconnect: true },
    mutations: { retry: false },
  },
});

function ConnectionErrorPage() {
  return (
    <main className="auth-page">
      <section className="panel max-w-lg p-8 text-center">
        <img src="/logo.svg" alt="AntCDP" className="mx-auto mb-5 size-12" />
        <h1 className="text-2xl font-semibold">连接异常</h1>
        <p className="my-4 text-sm leading-6 text-muted">
          无法确认服务状态。请检查网络或联系维护者；不要进入安装流程。
        </p>
        <Button onClick={() => window.location.reload()}>重新加载</Button>
        <Button asChild variant="link" className="ml-4">
          <Link to="/home">返回工作区</Link>
        </Button>
      </section>
    </main>
  );
}

const router = createBrowserRouter([
  {
    path: "/",
    element: <AppRoot />,
    children: [
      { path: "setup", element: <SetupPage /> },
      { path: "login", element: <AuthPage mode="login" /> },
      { path: "register", element: <AuthPage mode="register" /> },
      { path: "connection-error", element: <ConnectionErrorPage /> },
      {
        element: <RequireAuth />,
        children: [
          {
            path: "required-password",
            element: <AuthPage mode="required-password" />,
          },
          {
            path: "/",
            element: (
              <NavigationGuardProvider>
                <AppShell />
              </NavigationGuardProvider>
            ),
            children: [
              { index: true, element: <Navigate to="/home" replace /> },
              { path: "home", element: <HomePage /> },
              { path: "account", element: <AccountPage /> },
              { path: "account/security", element: <AccountPage /> },
              {
                path: "account/integrations/:connectionId?",
                element: <IntegrationsPage />,
              },
              {
                path: "account/remote-hosts/:hostId?",
                element: <RemoteHostsPage />,
              },
              { path: "projects", element: <ResourceList kind="projects" /> },
              { path: "teams", element: <ResourceList kind="teams" /> },
              {
                path: "projects/:projectId",
                element: <ResourceDetail kind="projects" />,
              },
              {
                path: "teams/:teamId",
                element: <ResourceDetail kind="teams" />,
              },
              {
                path: "projects/:projectId/variants",
                element: <VariantsPage />,
              },
              {
                path: "projects/:projectId/variants/:variantId",
                element: <VariantDetailPage />,
              },
              {
                path: "projects/:projectId/integrations/:connectionId?",
                element: <IntegrationsPage />,
              },
              {
                path: "projects/:projectId/remote-hosts/:hostId?",
                element: <RemoteHostsPage />,
              },
              {
                element: <RequireAdmin />,
                children: [
                  { path: "admin", element: <OverviewPage /> },
                  { path: "admin/users", element: <UsersPage /> },
                  {
                    path: "admin/projects",
                    element: <ResourceList kind="projects" />,
                  },
                  {
                    path: "admin/teams",
                    element: <ResourceList kind="teams" />,
                  },
                  {
                    path: "admin/projects/:projectId",
                    element: <ResourceDetail kind="projects" />,
                  },
                  {
                    path: "admin/teams/:teamId",
                    element: <ResourceDetail kind="teams" />,
                  },
                  { path: "admin/settings", element: <SettingsPage /> },
                  { path: "admin/audit", element: <AuditPage /> },
                  { path: "admin/maintenance", element: <MaintenancePage /> },
                  {
                    path: "admin/integrations/:connectionId?",
                    element: <IntegrationsPage />,
                  },
                  {
                    path: "admin/remote-hosts/:hostId?",
                    element: <RemoteHostsPage />,
                  },
                  {
                    path: "admin/email/:section?/:id?",
                    element: <EmailPage />,
                  },
                  { path: "admin/sms/:section?/:id?", element: <SmsPage /> },
                  { path: "admin/dingtalk/:id?", element: <DingTalkPage /> },
                ],
              },
              { path: "*", element: <NotFound /> },
            ],
          },
        ],
      },
    ],
  },
]);

const root = document.getElementById("root");
if (!root) throw new Error("Missing application root");
createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <ToastProvider>
          <RouterProvider router={router} />
        </ToastProvider>
      </ThemeProvider>
    </QueryClientProvider>
  </StrictMode>,
);
