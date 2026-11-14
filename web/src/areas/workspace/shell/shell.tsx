import { useAuth } from "@/app/auth";
import { LogoutDialog, ShellActions, useLogout } from "@/app/session-actions";
import { LoadingState } from "@/components/feedback";
import { Drawer } from "@/components/overlays";
import { SidebarBrand } from "@/components/platform/sidebar-brand";
import { UserMenu } from "@/components/platform/user-menu";
import { useApiQuery } from "@/hooks/use-api";
import { useSidebarPreference } from "@/hooks/use-sidebar-preference";
import { resolveSiteName } from "@/lib/site-name";
import type { Resource } from "@/types/collaboration";
import { Suspense, useState } from "react";
import { Outlet, useLocation } from "react-router";
import { workspaceBreadcrumbs } from "../pages/workspace-breadcrumbs";
import { WorkspaceSidebar } from "../pages/workspace-sidebar";
import { Frame } from "./frame";
export function Shell() {
  const location = useLocation();
  const { collapsed, toggleCollapsed } = useSidebarPreference("workspace");
  const [mobile, setMobile] = useState(false);
  const logout = useLogout();
  const { settings } = useAuth();
  const brand = resolveSiteName(settings.site_name);
  const projectId = location.pathname.match(/^\/projects\/([1-9]\d*)/)?.[1];
  const teamId = location.pathname.match(/^\/teams\/([1-9]\d*)(?:\/|$)/)?.[1];
  const project = useApiQuery<Resource>(
    ["project", projectId],
    `/projects/${projectId ?? ""}`,
    { enabled: Boolean(projectId) },
  );
  const team = useApiQuery<Resource>(
    ["team", teamId],
    `/teams/${teamId ?? ""}`,
    { enabled: Boolean(teamId) },
  );
  const navigation = (compact: boolean, close?: () => void) => (
    <div
      className="sidebar-navigation"
      data-compact={compact}
      data-mode="workspace"
    >
      <SidebarBrand
        brand={brand}
        compact={compact}
        collapsed={collapsed}
        close={close}
        onToggleCollapsed={toggleCollapsed}
      />
      <div className="sidebar-scroll">
        <WorkspaceSidebar
          projectId={projectId}
          project={project.data?.data}
          compact={compact}
          close={close}
        />
      </div>
      <UserMenu compact={compact} onLogout={logout.open} area="workspace" />
    </div>
  );
  return (
    <Frame
      conversation={/^\/agents\/sessions\/[1-9]\d*$/.test(location.pathname)}
      collapsed={collapsed}
      navigation={navigation(collapsed)}
      crumbs={workspaceBreadcrumbs(
        location.pathname,
        location.search,
        project.data?.data,
        team.data?.data.name,
      )}
      onOpenNavigation={() => setMobile(true)}
      actions={
        <>
          <ShellActions projectId={projectId} />
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
