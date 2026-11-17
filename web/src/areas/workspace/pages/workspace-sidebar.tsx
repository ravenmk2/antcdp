import { NavLink } from "react-router";
import {
  Folder,
  Home,
  Users,
  MessagesSquare,
  Monitor,
  Bot,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const workspaceItems = [
  { to: "/home", label: "工作台", icon: Home },
  { to: "/agents", label: "对话", icon: MessagesSquare },
  { to: "/agent-catalog", label: "智能体", icon: Bot },
  { to: "/projects", label: "项目", icon: Folder },
  { to: "/teams", label: "团队", icon: Users },
  { to: "/computer", label: "云电脑", icon: Monitor },
];

export function WorkspaceSidebar({
  compact,
  close,
}: {
  compact: boolean;
  close?: () => void;
}) {
  return (
    <TooltipProvider delay={250}>
      <nav aria-label="主导航" className="workspace-primary-navigation">
        {workspaceItems.map((item) => (
          <Tooltip key={item.to}>
            <TooltipTrigger
              render={
                <NavLink
                  to={item.to}
                  aria-label={item.label}
                  className="nav-link"
                  onClick={close}
                >
                  <item.icon className="size-5 shrink-0" />
                  <span className={compact ? "sr-only" : "sidebar-label"}>
                    {item.label}
                  </span>
                </NavLink>
              }
            />
            {compact && (
              <TooltipContent side="right">{item.label}</TooltipContent>
            )}
          </Tooltip>
        ))}
      </nav>
    </TooltipProvider>
  );
}
