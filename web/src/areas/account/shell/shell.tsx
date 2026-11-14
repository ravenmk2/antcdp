import { useAuth } from "@/app/auth";
import { LogoutDialog, ShellActions, useLogout } from "@/app/session-actions";
import { IconButton } from "@/components/button";
import { LoadingState } from "@/components/feedback";
import { Drawer } from "@/components/overlays";
import { SidebarBrand } from "@/components/platform/sidebar-brand";
import { UserMenu } from "@/components/platform/user-menu";
import { useSidebarPreference } from "@/hooks/use-sidebar-preference";
import { resolveSiteName } from "@/lib/site-name";
import { Home } from "lucide-react";
import { Suspense, useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router";
import { Frame } from "./frame";
import { AccountNavigation, accountBreadcrumbs } from "./navigation";
export function Shell() {
  const location = useLocation();
  const navigate = useNavigate();
  const { collapsed, toggleCollapsed } = useSidebarPreference("account");
  const [mobile, setMobile] = useState(false);
  const logout = useLogout();
  const { settings } = useAuth();
  const brand = resolveSiteName(settings.site_name);

  const navigation = (compact: boolean, close?: () => void) => (
    <div
      className="sidebar-navigation"
      data-compact={compact}
      data-mode="account"
    >
      <SidebarBrand
        brand={brand}
        compact={compact}
        collapsed={collapsed}
        close={close}
        onToggleCollapsed={toggleCollapsed}
      />
      <div className="sidebar-scroll">
        <AccountNavigation compact={compact} close={close} />
      </div>
      <UserMenu compact={compact} onLogout={logout.open} area="account" />
    </div>
  );
  return (
    <Frame
      collapsed={collapsed}
      navigation={navigation(collapsed)}
      crumbs={accountBreadcrumbs(location.pathname, location.search)}
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
