import { NavLink } from "react-router";
import {
  Folder,
  Home,
  Users,
  MessagesSquare,
  Monitor,
  Bot,
} from "lucide-react";

const workspaceItems = [
  { to: "/home", label: "工作台", icon: Home },
  { to: "/chats", label: "对话", icon: MessagesSquare },
  { to: "/agents/catalog", label: "智能体", icon: Bot },
  { to: "/projects", label: "项目", icon: Folder },
  { to: "/teams", label: "团队", icon: Users },
  { to: "/computer", label: "云电脑", icon: Monitor },
];

export function WorkspaceSidebar({ close }: { close?: () => void }) {
  return (
    <nav aria-label="主导航" className="workspace-primary-navigation">
      {workspaceItems.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          className="nav-link"
          onClick={close}
        >
          <item.icon className="size-5 shrink-0" aria-hidden />
          <span>{item.label}</span>
        </NavLink>
      ))}
    </nav>
  );
}
