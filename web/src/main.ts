import { createApp } from "vue";
import { createPinia } from "pinia";
import { createRouter, createWebHistory } from "vue-router";
import "element-plus/dist/index.css";
import "element-plus/theme-chalk/dark/css-vars.css";
import "./shared/tokens.css";
import "./shared/app.css";
import App from "./app/App.vue";
const InstallationPage = () =>
  import("./features/install/InstallationPage.vue");
const HomePage = () => import("./features/home/HomePage.vue");
const LoginPage = () => import("./features/identity/LoginPage.vue");
const AccountPage = () => import("./features/identity/AccountPage.vue");
const OverviewPage = () => import("./features/admin/OverviewPage.vue");
const UsersPage = () => import("./features/admin/UsersPage.vue");
const AuditPage = () => import("./features/admin/AuditPage.vue");
const SettingsPage = () => import("./features/admin/SettingsPage.vue");
const CollaborationPage = () =>
  import("./features/collaboration/CollaborationPage.vue");
import { useIdentity } from "./features/identity/store";
import { onAuthFailure } from "./shared/api";

const RemoteHostsPage = () => import("./features/remote-hosts/RemoteHostsPage.vue");
const IntegrationsPage = () =>
  import("./features/integrations/IntegrationsPage.vue");
const pinia = createPinia();

const router = createRouter({
  history: createWebHistory(),
  scrollBehavior: (_to, _from, savedPosition) => savedPosition ?? { top: 0 },
  routes: [
    {
      path: "/admin/remote-hosts/:integrationID?",
      component: RemoteHostsPage,
      meta: { title: "远程主机", admin: true },
    },
    {
      path: "/account/remote-hosts/:integrationID?",
      component: RemoteHostsPage,
      meta: { title: "个人 SSH 凭证" },
    },
    {
      path: "/projects/:projectID/remote-hosts/:integrationID?",
      component: RemoteHostsPage,
      meta: { title: "项目 SSH 凭证" },
    },
    {
      path: "/admin/integrations/:integrationID?",
      component: IntegrationsPage,
      meta: { title: "服务集成", admin: true },
    },
    {
      path: "/account/integrations/:integrationID?",
      component: IntegrationsPage,
      meta: { title: "个人集成凭证" },
    },
    {
      path: "/projects/:projectID/integrations/:integrationID?",
      component: IntegrationsPage,
      meta: { title: "项目集成凭证" },
    },
    ...(["projects", "teams"] as const).flatMap((kind) => [
      {
        path: `/${kind}/:id?`,
        component: CollaborationPage,
        meta: { title: kind === "projects" ? "项目" : "团队" },
      },
      {
        path: `/admin/${kind}/:id?`,
        component: CollaborationPage,
        meta: {
          title: kind === "projects" ? "项目管理" : "团队管理",
          admin: true,
        },
      },
    ]),
    { path: "/", redirect: "/home" },
    {
      path: "/home",
      name: "home",
      component: HomePage,
      meta: { title: "首页" },
    },
    {
      path: "/setup",
      component: InstallationPage,
      meta: { title: "系统安装" },
    },
    {
      path: "/login",
      component: LoginPage,
      meta: { title: "登录", public: true },
    },
    {
      path: "/register",
      component: LoginPage,
      meta: { title: "注册", public: true },
    },
    { path: "/account", component: AccountPage, meta: { title: "个人设置" } },
    {
      path: "/account/security",
      component: AccountPage,
      meta: { title: "个人设置" },
    },
    {
      path: "/admin",
      component: OverviewPage,
      meta: { title: "系统概览", admin: true },
    },
    {
      path: "/admin/users",
      component: UsersPage,
      meta: { title: "用户管理", admin: true },
    },
    {
      path: "/admin/audit",
      component: AuditPage,
      meta: { title: "审计日志", admin: true },
    },
    {
      path: "/admin/settings",
      component: SettingsPage,
      meta: { title: "系统设置", admin: true },
    },
    { path: "/:pathMatch(.*)*", redirect: "/home" },
  ],
});

router.beforeEach(async (to) => {
  const identity = useIdentity(pinia);
  try {
    await identity.refresh();
  } catch {
    return to.path === "/setup" ? true : { path: "/setup", replace: true };
  }
  if (identity.setup?.state !== "ready")
    return to.path === "/setup" ? true : { path: "/setup", replace: true };
  if (to.path === "/setup")
    return {
      path: identity.session
        ? identity.session.require_password_change
          ? "/account/security"
          : "/home"
        : "/login",
      replace: true,
    };
  if (to.meta.public)
    return identity.session
      ? {
          path: identity.session.require_password_change
            ? "/account/security"
            : "/home",
          replace: true,
        }
      : true;
  if (!identity.session) return { path: "/login", replace: true };
  if (
    identity.session.require_password_change &&
    to.path !== "/account/security"
  )
    return { path: "/account/security", replace: true };
  if (to.meta.admin && !identity.isAdmin)
    return { path: "/home", replace: true };
  return true;
});

onAuthFailure((code) => {
  const identity = useIdentity(pinia);
  if (code === "UNAUTHENTICATED") identity.session = null;
  void router.replace(
    code === "PASSWORD_CHANGE_REQUIRED" ? "/account/security" : "/login",
  );
});

router.afterEach((to) => {
  document.title = `AntCDP · ${to.meta.title ?? "首页"}`;
});

createApp(App).use(pinia).use(router).mount("#app");
