import {
  Box,
  Code2,
  Folder,
  Globe,
  Layers,
  Users,
  Zap,
  UserRound,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { ShortcutItem } from "@/types/collaboration";

const icons = {
  folder: Folder,
  code: Code2,
  box: Box,
  globe: Globe,
  bolt: Zap,
  layers: Layers,
  team: Users,
};
export const iconLabels = {
  folder: "文件夹",
  code: "代码",
  box: "立方体",
  globe: "地球",
  bolt: "闪电",
  layers: "图层",
  team: "团队",
};

export function ResourceIcon({
  resource,
  className,
}: {
  resource: Pick<ShortcutItem, "icon_key" | "icon_file_id" | "name">;
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
  const Icon = icons[resource.icon_key as keyof typeof icons] ?? Folder;
  return (
    <span className={cn("resource-icon", className)} title={resource.name}>
      <Icon className="size-4" aria-hidden />
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
