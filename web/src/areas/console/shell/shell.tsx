import { useAuth } from "@/app/auth";
import { LogoutDialog, ShellActions, useLogout } from "@/app/session-actions";
import { IconButton } from "@/components/button";
import { LoadingState } from "@/components/feedback";
import { Drawer } from "@/components/overlays";
import { SidebarBrand } from "@/components/platform/sidebar-brand";
import { UserMenu } from "@/components/platform/user-menu";
import { useApiQuery } from "@/hooks/use-api";
import { useSidebarPreference } from "@/hooks/use-sidebar-preference";
import { resolveSiteName } from "@/lib/site-name";
import type { Resource } from "@/types/collaboration";
import type { MCPServer } from "@/types/agent-resources";
import { Home } from "lucide-react";
import { Suspense, useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router";
import { adminBreadcrumbs } from "../pages/admin-breadcrumbs";
import { AdminNavigation } from "../pages/admin-navigation";
import { Frame } from "./frame";
export function Shell() {
  const location = useLocation();
  const navigate = useNavigate();
  const { collapsed, toggleCollapsed } = useSidebarPreference("console");
  const [mobile, setMobile] = useState(false);
  const logout = useLogout();
  const { settings } = useAuth();
  const brand = resolveSiteName(settings.site_name);
  const teamId = location.pathname.match(
    /^\/admin\/teams\/([1-9]\d*)(?:\/|$)/,
  )?.[1];
  const team = useApiQuery<Resource>(
    ["team", teamId],
    `/teams/${teamId ?? ""}`,
    { enabled: Boolean(teamId) },
  );
  const projectId = location.pathname.match(
    /^\/admin\/projects\/([1-9]\d*)(?:\/|$)/,
  )?.[1];
  const project = useApiQuery<Resource>(
    ["project", projectId],
    `/projects/${projectId ?? ""}`,
    { enabled: Boolean(projectId) },
  );
  const mcpServerId = location.pathname.match(
    /^\/admin\/mcp-servers\/([1-9]\d*)\/?$/,
  )?.[1];
  const mcpServer = useApiQuery<MCPServer>(
    ["agent-resources", "mcp", mcpServerId],
    `/admin/agents/mcp-servers/${mcpServerId ?? ""}`,
    { enabled: Boolean(mcpServerId) },
  );
  const navigation = (compact: boolean, close?: () => void) => (
    <div
      className="sidebar-navigation"
      data-compact={compact}
      data-mode="console"
    >
      <SidebarBrand
        brand={brand}
        compact={compact}
        collapsed={collapsed}
        close={close}
        onToggleCollapsed={toggleCollapsed}
      />
      <div className="sidebar-scroll">
        <AdminNavigation compact={compact} close={close} />
      </div>
      <UserMenu compact={compact} onLogout={logout.open} area="console" />
    </div>
  );
  return (
    <Frame
      collapsed={collapsed}
      navigation={navigation(collapsed)}
      crumbs={adminBreadcrumbs(
        location.pathname,
        team.data?.data.name,
        project.data?.data,
        mcpServer.data?.data.name,
      )}
      onOpenNavigation={() => setMobile(true)}
      actions={
        <>
          <IconButton label="返回工作区" onClick={() => navigate("/home")}>
            <Home />
          </IconButton>
          <ShellActions />
        </>
      }
      overlays={
        <>
          <Drawer
            open={mobile}
            title="页面导航"
            onClose={() => setMobile(false)}
          >
            {navigation(false, () => setMobile(false))}
          </Drawer>
          <LogoutDialog controller={logout} />
        </>
      }
    >
      <Suspense
        fallback={
          <div className="page">
            <LoadingState />
          </div>
        }
      >
        <Outlet />
      </Suspense>
    </Frame>
  );
}
