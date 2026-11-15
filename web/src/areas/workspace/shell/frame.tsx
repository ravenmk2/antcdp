import { IconButton } from "@/components/button";
import { Breadcrumbs, type Crumb } from "@/components/layout";
import { Menu, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Drawer } from "@/components/overlays";

export function Frame({
  navigation,
  crumbs,
  actions,
  onOpenNavigation,
  children,
  overlays,
  secondary,
}: {
  navigation: ReactNode;
  crumbs: Crumb[];
  actions: ReactNode;
  onOpenNavigation: () => void;
  children: ReactNode;
  overlays: ReactNode;
  secondary?: ReactNode;
}) {
  const [secondaryOpen, setSecondaryOpen] = useState(true);
  const [mobileSecondary, setMobileSecondary] = useState(false);
  return (
    <div className="app-layout" data-collapsed="true">
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
            {secondary && (
              <>
                <IconButton
                  className="max-[820px]:hidden"
                  label={secondaryOpen ? "收起对话侧栏" : "展开对话侧栏"}
                  onClick={() => setSecondaryOpen(!secondaryOpen)}
                >
                  {secondaryOpen ? <PanelLeftClose /> : <PanelLeftOpen />}
                </IconButton>
                <IconButton
                  className="min-[821px]:hidden"
                  label="打开对话列表"
                  onClick={() => setMobileSecondary(true)}
                >
                  <PanelLeftOpen />
                </IconButton>
              </>
            )}
            <Breadcrumbs items={crumbs} />
          </div>
          <div className="flex shrink-0 items-center gap-1">{actions}</div>
        </header>
        <div
          className="workspace-body"
          data-secondary={Boolean(secondary) && secondaryOpen}
        >
          {secondary && secondaryOpen && (
            <aside className="workspace-secondary" aria-label="对话导航">
              {secondary}
            </aside>
          )}
          <main id="main-content" tabIndex={-1} className="workspace-main">
            {children}
          </main>
        </div>
      </div>
      {overlays}
      <Drawer
        open={mobileSecondary && Boolean(secondary)}
        title="对话导航"
        onClose={() => setMobileSecondary(false)}
      >
        <div
          onClick={(event) => {
            if ((event.target as HTMLElement).closest("a"))
              setMobileSecondary(false);
          }}
        >
          {secondary}
        </div>
      </Drawer>
    </div>
  );
}
