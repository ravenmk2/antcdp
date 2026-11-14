import type { ReactNode } from "react";
import { useNavigate } from "react-router";
import { FileText, FolderGit2, LayoutDashboard, Settings } from "lucide-react";
import { StatusBadge } from "@/components/feedback";
import { ResourceDetailShell, ResourceHeader, Tabs } from "@/components/layout";
import { ResourceIcon } from "@/components/resource-icon";
import type { Resource } from "@/types/collaboration";
import { ResourceMetadata } from "@/features/collaboration/resource-detail";
import type { WorkspaceProjectPage } from "@/areas/workspace/pages/workspace-navigation";

export function WorkspaceProjectFrame({
  project,
  active,
  actions,
  children,
  wide = false,
}: {
  project: Resource;
  active: WorkspaceProjectPage;
  actions?: ReactNode;
  children: ReactNode;
  wide?: boolean;
}) {
  const navigate = useNavigate();
  const items = [
    { value: "overview", label: "项目总览", icon: LayoutDashboard },

    { value: "repositories", label: "Git 仓库", icon: FolderGit2 },
    { value: "description", label: "项目介绍", icon: FileText },
    { value: "settings", label: "项目设置", icon: Settings },
  ].map(({ value, label, icon: Icon }) => ({
    value,
    label: (
      <span className="inline-flex items-center gap-2">
        <Icon className="size-4" />
        {label}
      </span>
    ),
  }));

  function select(value: string) {
    const base = `/projects/${project.id}`;
    if (value === "overview") {
      navigate(base);
      return;
    }
    const section = value === "settings" ? "&section=profile" : "";
    navigate(`${base}?tab=${value}${section}`);
  }

  return (
    <ResourceDetailShell
      wide={wide}
      header={
        <ResourceHeader
          icon={<ResourceIcon resource={project} className="size-11" />}
          title={project.name}
          badge={
            <StatusBadge
              tone={project.status === "active" ? "success" : "neutral"}
            >
              {project.status === "active" ? "正常" : "已归档"}
            </StatusBadge>
          }
          meta={<ResourceMetadata resource={project} kind="projects" />}
          summary={
            project.summary ||
            `${project.member_count} 位成员 · ${project.can_manage ? "可管理项目" : "成员权限"}`
          }
          actions={actions}
        />
      }
      navigation={
        <Tabs
          label={`${project.name}功能`}
          items={items}
          value={active}
          onChange={select}
        />
      }
    >
      {children}
    </ResourceDetailShell>
  );
}
