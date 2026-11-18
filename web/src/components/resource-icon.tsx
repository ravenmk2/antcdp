import {
  Box,
  CodeXml,
  Folder,
  Globe,
  Layers,
  UserRound,
  Users,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { ShortcutItem } from "@/types/collaboration";

export const iconLabels = {
  folder: "文件夹",
  code: "代码",
  box: "立方体",
  globe: "地球",
  bolt: "闪电",
  layers: "图层",
  team: "团队",
};

const icons = {
  folder: Folder,
  code: CodeXml,
  box: Box,
  globe: Globe,
  bolt: Zap,
  layers: Layers,
  team: Users,
} satisfies Record<keyof typeof iconLabels, LucideIcon>;

const projectTones = ["slate-blue", "indigo", "teal", "graphite"] as const;

function projectIconTone(id: string) {
  let index = 0;
  for (const digit of id) {
    index = (index * 31 + digit.charCodeAt(0)) % projectTones.length;
  }
  return projectTones[index];
}

export function ResourceIcon({
  resource,
  projectId,
  className,
}: {
  resource: Pick<ShortcutItem, "icon_key" | "icon_file_id" | "name">;
  projectId?: string;
  className?: string;
}) {
  if (resource.icon_file_id)
    return (
      <img
        src={`/api/v1/icons/${resource.icon_file_id}`}
        alt=""
        className={cn("resource-icon object-cover", className)}
      />
    );
  const key = resource.icon_key as keyof typeof icons | null;
  const builtin = key && Object.hasOwn(icons, key) ? key : "folder";
  const Icon = icons[builtin];
  return (
    <span
      className={cn(
        "inline-grid size-9 shrink-0 place-items-center text-primary",
        className,
      )}
      data-builtin-icon={builtin}
      data-project-tone={projectId ? projectIconTone(projectId) : undefined}
      title={resource.name}
    >
      <Icon strokeWidth={1.7} className="size-[72.22%]" aria-hidden />
    </span>
  );
}

export function Avatar({
  url,
  name,
  className,
}: {
  url?: string | null;
  name: string;
  className?: string;
}) {
  return url ? (
    <img
      src={url}
      alt={`${name}的头像`}
      className={cn("size-9 shrink-0 rounded-full object-cover", className)}
    />
  ) : (
    <span
      className={cn(
        "grid size-9 shrink-0 place-items-center rounded-full bg-accent-soft text-primary",
        className,
      )}
      role="img"
      aria-label={`${name}的默认头像`}
    >
      <UserRound className="size-4" />
    </span>
  );
}
