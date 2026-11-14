import { accountRoutes } from "@/areas/account/routes";
import { consoleRoutes } from "@/areas/console/routes";
import { workspaceRoutes } from "@/areas/workspace/routes";
import { Button } from "@/components/button";
import { NavigationGuardProvider } from "@/components/navigation-guard";
import { Surface } from "@/components/platform/surface";
import { AuthPage } from "@/features/access/auth-page";
import { SetupPage } from "@/features/access/setup-page";
import { AgentRuntimeProvider } from "@/features/agents/data/runtime-context";
import publicStyles from "@/styles/public.module.css";
import { Link, Outlet, useMatches } from "react-router";
import { AppRoot, RequireAdmin, RequireAuth } from "./auth";
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
        <Button
          render={<Link to="/home">返回工作区</Link>}
          nativeButton={false}
          role="link"
          variant="link"
          className="ml-4"
        />
      </section>
    </main>
  );
}

function Root() {
  const matches = useMatches();
  const business = matches.some(
    (m) => (m.handle as { business?: boolean } | undefined)?.business,
  );
  return business ? (
    <AppRoot />
  ) : (
    <Surface area="public" className={publicStyles.scope}>
      <AppRoot />
    </Surface>
  );
}
function BusinessServices() {
  return (
    <NavigationGuardProvider host={false}>
      <AgentRuntimeProvider>
        <Outlet />
      </AgentRuntimeProvider>
    </NavigationGuardProvider>
  );
}
export const appRoutes = [
  {
    path: "/",
    element: <Root />,
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
            element: <BusinessServices />,
            handle: { business: true },
            children: [
              {
                path: "admin",
                element: <RequireAdmin />,
                children: consoleRoutes,
              },
              { path: "account", children: accountRoutes },
              ...workspaceRoutes,
            ],
          },
        ],
      },
    ],
  },
];
