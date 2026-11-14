import { FileText, Pencil, RotateCw, Star, UserMinus } from "lucide-react";
import {
  RowAction,
  RowActionSeparator,
  RowActions,
} from "@/components/row-actions";
import type { Resource, ResourceKind } from "@/types/collaboration";
import type { useWorkspaceShortcut } from "@/areas/workspace/pages/use-workspace-shortcut";

type ShortcutState = ReturnType<typeof useWorkspaceShortcut>;

export function WorkspaceResourceActions({
  kind,
  resource,
  shortcut,
  onEdit,
  editDescriptionTo,
  onRefresh,
  onLeave,
}: {
  kind: ResourceKind;
  resource: Resource;
  shortcut: ShortcutState;
  onEdit: () => void;
  editDescriptionTo?: string;
  onRefresh: () => void;
  onLeave: () => void;
}) {
  const project = kind === "projects";
  const selected = shortcut.selected(resource.id);
  const label = project
    ? selected
      ? "取消关注"
      : "关注项目"
    : selected
      ? "取消固定"
      : "固定团队";
  return (
    <RowActions label={resource.name}>
      <RowAction
        icon={<Star className={selected ? "star-active" : undefined} />}
        disabled={
          !shortcut.shortcuts.data || shortcut.pending || shortcut.uncertain
        }
        onSelect={() => void shortcut.toggle(resource)}
      >
        {label}
      </RowAction>
      <RowAction icon={<RotateCw />} onSelect={onRefresh}>
        刷新
      </RowAction>
      {resource.can_manage && (
        <RowAction icon={<Pencil />} onSelect={onEdit}>
          编辑资料
        </RowAction>
      )}
      {resource.can_manage && editDescriptionTo && (
        <RowAction icon={<FileText />} to={editDescriptionTo}>
          编辑介绍
        </RowAction>
      )}
      {resource.direct_role && (
        <>
          <RowActionSeparator />
          <RowAction
            icon={<UserMinus />}
            variant="destructive"
            onSelect={onLeave}
          >
            退出{project ? "项目" : "团队"}
          </RowAction>
        </>
      )}
    </RowActions>
  );
}
