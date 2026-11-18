import type { ReactNode } from "react";
import { StatusBadge } from "@/components/feedback";
import { ResourceIcon } from "@/components/resource-icon";
import { ResourceMetadata } from "@/features/collaboration/resource-detail";
import type { Resource, ResourceKind } from "@/types/collaboration";

export function WorkspaceResourceHeader({
  resource,
  kind,
  actions,
}: {
  resource: Resource;
  kind: ResourceKind;
  actions?: ReactNode;
}) {
  const project = kind === "projects";
  const active = resource.status === "active";
  return (
    <header className="workspace-resource-header">
      <div className="flex items-start gap-4">
        <ResourceIcon
          resource={resource}
          projectId={project ? resource.id : undefined}
          className="size-12"
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="page-title m-0">{resource.name}</h1>
            <StatusBadge tone={active ? "success" : "neutral"}>
              {active ? "正常" : project ? "已归档" : "已解散"}
            </StatusBadge>
          </div>
          {resource.summary && (
            <p className="mt-2 whitespace-pre-wrap break-words text-sm text-text-soft">
              {resource.summary}
            </p>
          )}
        </div>
        {actions}
      </div>
      <div className="resource-meta">
        <ResourceMetadata resource={resource} kind={kind} />
      </div>
    </header>
  );
}
