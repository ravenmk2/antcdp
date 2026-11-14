import { useState } from "react";
import { Link, NavLink, useLocation } from "react-router";
import { Folder, Home, Users, Search, SquarePen, Box } from "lucide-react";
import { Button } from "@/components/button";
import type { Resource } from "@/types/collaboration";
import {
  SessionSearch,
  SidebarConversations,
} from "@/features/agents/chat/session-list";
import { ProjectSwitcher } from "@/areas/workspace/pages/project-switcher";

const workspaceItems = [
  { to: "/home", label: "工作台", icon: Home, end: true },
  { to: "/projects", label: "我的项目", icon: Folder, end: true },
  { to: "/teams", label: "我的团队", icon: Users, end: true },
  { to: "/cloud-computer", label: "我的云电脑", icon: Box, end: true },
];
export function WorkspaceSidebar({
  projectId,
  project,
  compact,
  close,
}: {
  projectId?: string;
  project?: Resource;
  compact: boolean;
  close?: () => void;
}) {
  const location = useLocation(),
    [search, setSearch] = useState(false);
  const conversationArea =
    location.pathname === "/home" || location.pathname.startsWith("/agents");
  return (
    <>
      <div className="workspace-sidebar-primary" data-compact={compact}>
        <div className="workspace-sidebar-compose">
          <Button
            render={
              <Link
                to="/home"
                title="新建对话"
                aria-label="新建对话"
                onClick={close}
              >
                <SquarePen className="size-4" />
                {!compact && "新建对话"}
              </Link>
            }
            nativeButton={false}
            role="link"
            variant="outline"
            className={
              compact
                ? "px-2 text-navigation hover:text-navigation"
                : "min-w-0 flex-1 justify-start text-navigation hover:text-navigation"
            }
          />
          <Button
            variant="ghost"
            size="icon"
            aria-label="搜索会话"
            title="搜索会话"
            onClick={() => setSearch(true)}
          >
            <Search className="size-4" />
          </Button>
        </div>
        <nav aria-label="主导航">
          {workspaceItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              title={item.label}
              aria-label={item.label}
              className="nav-link"
              data-section-active={
                (item.to !== "/home" &&
                  location.pathname.startsWith(`${item.to}/`)) ||
                undefined
              }
              onClick={close}
            >
              <item.icon className="size-[18px] shrink-0" />
              <span className="sidebar-label" aria-hidden={compact}>
                {item.label}
              </span>
            </NavLink>
          ))}
        </nav>
      </div>
      {projectId && project && (
        <ProjectSwitcher project={project} compact={compact} close={close} />
      )}
      {!projectId && conversationArea && (
        <SidebarConversations compact={compact} close={close} />
      )}
      {search && <SessionSearch onClose={() => setSearch(false)} />}
    </>
  );
}
