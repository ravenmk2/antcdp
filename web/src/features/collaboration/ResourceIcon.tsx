import { Folder, Code, Box, Globe, Zap, Layers, Users } from "lucide-react";
import { cn } from "@/lib/utils";
export function ResourceIcon({
  iconKey,
  fileId,
  team = false,
  large = false,
}: {
  iconKey?: string | null;
  fileId?: string | null;
  team?: boolean;
  large?: boolean;
}) {
  const icons: Record<string, typeof Folder> = {
    folder: Folder,
    code: Code,
    box: Box,
    globe: Globe,
    bolt: Zap,
    layers: Layers,
    team: Users,
  };
  const Icon = icons[iconKey || (team ? "team" : "folder")] || Folder;
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted text-muted-foreground",
        large ? "size-12" : "size-8",
      )}
      aria-hidden="true"
    >
      {fileId ? (
        <img
          src={`/api/v1/icons/${fileId}`}
          alt=""
          className="size-full object-cover"
        />
      ) : (
        <Icon className={large ? "size-6" : "size-4"} />
      )}
    </span>
  );
}
