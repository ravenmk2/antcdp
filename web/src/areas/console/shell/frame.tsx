import { IconButton } from "@/components/button";
import { Breadcrumbs, type Crumb } from "@/components/layout";
import { Menu } from "lucide-react";
import type { ReactNode } from "react";

export function Frame({
  collapsed,
  navigation,
  crumbs,
  actions,
  onOpenNavigation,
  children,
  overlays,
}: {
  collapsed: boolean;
  navigation: ReactNode;
  crumbs: Crumb[];
  actions: ReactNode;
  onOpenNavigation: () => void;
  children: ReactNode;
  overlays: ReactNode;
}) {
  return (
    <div className="app-layout" data-collapsed={collapsed}>
      <a
        href="#main-content"
        className="sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[100] focus:not-sr-only focus:rounded-lg focus:bg-surface focus:p-3"
      >
        跳至正文
      </a>
      <aside className="sidebar">{navigation}</aside>
      <div className="min-w-0">
        <header className="topbar">
          <div className="flex min-w-0 items-center gap-2">
            <IconButton
              className="min-[821px]:hidden"
              label="打开导航"
              onClick={onOpenNavigation}
            >
              <Menu />
            </IconButton>
            <Breadcrumbs items={crumbs} />
          </div>
          <div className="flex shrink-0 items-center gap-1">{actions}</div>
        </header>
        <main id="main-content" tabIndex={-1}>
          {children}
        </main>
      </div>
      {overlays}
    </div>
  );
}
