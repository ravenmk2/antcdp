import type { ReactNode } from "react";
import { ResourceDetailShell } from "@/components/layout";
import type { Resource } from "@/types/collaboration";
import { WorkspaceResourceHeader } from "./workspace-resource-header";

export function WorkspaceProjectFrame({
  project,
  actions,
  children,
  wide = false,
}: {
  project: Resource;
  actions?: ReactNode;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <ResourceDetailShell
      wide={wide}
      header={
        <WorkspaceResourceHeader
          resource={project}
          kind="projects"
          actions={actions}
        />
      }
    >
      {children}
    </ResourceDetailShell>
  );
}
