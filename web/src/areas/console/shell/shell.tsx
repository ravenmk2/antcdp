import { useAuth } from "@/app/auth";
import { LogoutDialog, useLogout } from "@/app/session-actions";
import { Button } from "@/components/button";
import { LoadingState } from "@/components/feedback";
import { Drawer } from "@/components/overlays";
import { UserMenu } from "@/components/platform/user-menu";
import { useApiQuery } from "@/hooks/use-api";
import { useSidebarPreference } from "@/hooks/use-sidebar-preference";
import { resolveSiteName } from "@/lib/site-name";
import type { Resource } from "@/types/collaboration";
import type { MCPServer } from "@/types/agent-resources";
import { ArrowUpRight } from "lucide-react";
import { Suspense, useState } from "react";
import { Link, Outlet, useLocation } from "react-router";
import { adminBreadcrumbs } from "../pages/admin-breadcrumbs";
import { AdminMenuSearch, AdminNavigation } from "../pages/admin-navigation";
import { Frame } from "./frame";
import { SidebarBrand } from "./sidebar-brand";
export function Shell() {
  const location = useLocation();
  const { collapsed, toggleCollapsed } = useSidebarPreference("console");
  const [mobile, setMobile] = useState(false);
  const closeNavigation = () => setMobile(false);
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
      <SidebarBrand brand={brand} onNavigate={close} />
      <div className="sidebar-scroll">
        <AdminNavigation compact={compact} close={close} />
      </div>
      <UserMenu
        compact={compact}
        onLogout={logout.open}
        onNavigate={close}
        area="console"
      />
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
      onToggleNavigation={toggleCollapsed}
      onOpenNavigation={() => setMobile(true)}
      actions={
        <>
          <AdminMenuSearch onNavigate={closeNavigation} />
          <Button
            variant="ghost"
            size="sm"
            className="text-text-soft max-[620px]:px-2"
            render={<Link to="/home" />}
            nativeButton={false}
            aria-label="返回工作区"
            title="返回工作区"
          >
            <span className="max-[620px]:hidden">返回工作区</span>
            <ArrowUpRight aria-hidden />
          </Button>
        </>
      }
      overlays={
        <>
          <Drawer
            open={mobile}
            title="页面导航"
            side="left"
            className="max-w-72"
            bodyClassName="flex flex-col p-0"
            onClose={closeNavigation}
          >
            {navigation(false, closeNavigation)}
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
