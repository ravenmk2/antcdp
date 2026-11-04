import { OperationToastProvider } from "./components/platform/operation-toast";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import {
  createBrowserRouter,
  redirect,
  RouterProvider,
  useRouteError,
  isRouteErrorResponse,
} from "react-router";
import { identityLoader } from "./lib/loaders";
import { Shell, HomePage } from "./app/Shell";
import { authHref, appHref, businessRoute } from "./lib/navigation";
import { ApiError, errorMessage, onAuthFailure } from "./lib/api";
import { ErrorBox } from "./components/platform/feedback";
import "./styles/app.css";

function Failure() {
  const error = useRouteError();
  const routeError = isRouteErrorResponse(error);
  const missing = routeError
    ? error.status === 404
    : error instanceof ApiError &&
      (error.code === "NOT_FOUND" || error.code.endsWith("_NOT_FOUND"));
  const forbidden = routeError
    ? error.status === 403
    : error instanceof ApiError && error.code === "FORBIDDEN";
  const message =
    routeError && typeof error.data === "string"
      ? error.data
      : errorMessage(error);
  const path = location.pathname.replace(/\/$/, "");
  const parent = path.slice(0, path.lastIndexOf("/"));
  const list =
    businessRoute.test(parent) && parent && parent !== "/admin" ? parent : "";
  return (
    <main className="mx-auto max-w-lg space-y-5 p-8">
      <h1 className="text-2xl font-semibold">
        {missing
          ? "页面或资源不存在"
          : forbidden
            ? "无权访问"
            : "暂时无法打开页面"}
      </h1>
      <ErrorBox>{message}</ErrorBox>
      {missing && list && (
        <a className="underline" href={appHref(list)}>
          返回上一级
        </a>
      )}
      {!missing && !forbidden && (
        <button className="underline" onClick={() => window.location.reload()}>
          重新加载
        </button>
      )}
      <a className="ml-5 underline" href={appHref("/home")}>
        返回工作区
      </a>
    </main>
  );
}
const router = createBrowserRouter([
  ...["login", "register", "required-password"].map((path) => ({
    path,
    lazy: () => import("./features/access/CredentialsPage"),
    ErrorBoundary: Failure,
  })),
  {
    path: "setup",
    lazy: () => import("./features/access/SetupPage"),
    ErrorBoundary: Failure,
  },
  {
    path: "connection-error",
    lazy: () => import("./features/access/ConnectionPage"),
  },
  {
    path: "/",
    loader: identityLoader,
    shouldRevalidate: () => true,
    element: (
      <OperationToastProvider>
        <Shell />
      </OperationToastProvider>
    ),
    ErrorBoundary: Failure,
    children: [
      { index: true, loader: () => redirect("/home") },
      { path: "home", loader: identityLoader, Component: HomePage },
      {
        path: "account",
        lazy: () => import("./features/account/AccountPage"),
      },
      {
        path: "account/security",
        lazy: () => import("./features/account/AccountPage"),
      },
      { path: "admin", lazy: () => import("./features/admin/OverviewPage") },
      {
        path: "admin/settings",
        lazy: () => import("./features/admin/SettingsPage"),
      },
      {
        path: "admin/audit",
        lazy: () => import("./features/admin/AuditPage"),
      },
      {
        path: "admin/users",
        lazy: () => import("./features/users/UsersPage"),
      },
      {
        path: "projects",
        lazy: () => import("./features/collaboration/ListPage"),
      },
      {
        path: "admin/projects",
        lazy: () => import("./features/collaboration/ListPage"),
      },
      {
        path: "teams",
        lazy: () => import("./features/collaboration/ListPage"),
      },
      {
        path: "admin/teams",
        lazy: () => import("./features/collaboration/ListPage"),
      },
      {
        path: "projects/:id",
        lazy: () => import("./features/collaboration/DetailPage"),
      },
      {
        path: "admin/projects/:id",
        lazy: () => import("./features/collaboration/DetailPage"),
      },
      {
        path: "teams/:id",
        lazy: () => import("./features/collaboration/DetailPage"),
      },
      {
        path: "admin/teams/:id",
        lazy: () => import("./features/collaboration/DetailPage"),
      },
      {
        path: "projects/:projectId/variants",
        lazy: () => import("./features/delivery/VariantsPage"),
      },
      {
        path: "admin/projects/:projectId/variants",
        lazy: () => import("./features/delivery/VariantsPage"),
      },
      ...[
        "admin/integrations/:connectionId?",
        "account/integrations/:connectionId?",
        "projects/:projectId/integrations/:connectionId?",
      ].map((path) => ({
        path,
        lazy: () => import("./features/integrations/Page"),
      })),
      ...[
        "admin/remote-hosts/:hostId?",
        "account/remote-hosts/:hostId?",
        "projects/:projectId/remote-hosts/:hostId?",
      ].map((path) => ({
        path,
        lazy: () => import("./features/remote-hosts/Page"),
      })),
      {
        path: "admin/email/:section?/:id?",
        lazy: () => import("./features/email/Page"),
      },
      {
        path: "admin/sms/:section?/:id?",
        lazy: () => import("./features/sms/Page"),
      },
      {
        path: "admin/dingtalk/:id?",
        lazy: () => import("./features/dingtalk/Page"),
      },
      ...(import.meta.env.DEV
        ? [
            {
              path: "components",
              lazy: () => import("./app/ComponentStates"),
            },
          ]
        : []),
      {
        path: "*",
        element: (
          <div className="py-16">
            <h1 className="text-2xl font-semibold">页面未找到</h1>
            <p className="mt-3 text-muted-foreground">
              请检查访问地址，或从导航重新进入。
            </p>
          </div>
        ),
      },
    ],
  },
]);
onAuthFailure((code) =>
  window.location.replace(
    authHref(
      code === "PASSWORD_CHANGE_REQUIRED" ? "/required-password" : "/login",
    ),
  ),
);
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
