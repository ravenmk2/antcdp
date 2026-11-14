import { IconButton } from "@/components/button";
import { Menu, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { Link } from "react-router";

export function SidebarBrand({
  brand,
  compact,
  collapsed,
  close,
  onToggleCollapsed,
}: {
  brand: string;
  compact: boolean;
  collapsed: boolean;
  close?: () => void;
  onToggleCollapsed: () => void;
}) {
  return (
    <div className="flex h-16 shrink-0 items-center gap-2 px-4">
      <Link
        to="/home"
        className="sidebar-brand flex min-w-0 items-center gap-2"
        aria-hidden={compact}
        tabIndex={compact ? -1 : undefined}
        title={brand}
        onClick={close}
      >
        <img src="/logo.svg" alt="" className="size-6 dark:hidden" />
        <img
          src="/logo-inverse.svg"
          alt=""
          className="hidden size-6 dark:block"
        />
        <strong className="min-w-0 truncate text-[17px] leading-6">
          {brand}
        </strong>
      </Link>
      {!close && (
        <IconButton
          size="iconSm"
          className="ml-auto"
          label={collapsed ? "展开侧栏" : "收起侧栏"}
          onClick={onToggleCollapsed}
        >
          {collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
        </IconButton>
      )}
      {close && (
        <IconButton label="关闭导航" onClick={close}>
          <Menu />
        </IconButton>
      )}
    </div>
  );
}
