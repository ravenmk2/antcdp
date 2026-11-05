import { Check, ChevronDown } from "lucide-react";
import { DropdownMenu } from "radix-ui";
import { Link } from "react-router";
import { ResourceIcon } from "@/components/resource-icon";
import { cn } from "@/lib/utils";
import type { Resource } from "@/types/collaboration";

export function ProjectSwitcher({
  project,
  directory,
  compact,
  close,
}: {
  project: Resource;
  directory?: Resource[];
  compact: boolean;
  close?: () => void;
}) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          className={cn(
            "project-switcher flex items-center gap-2 rounded-lg bg-surface-subtle text-left hover:border-border-strong hover:bg-surface-hover",
            compact ? "justify-center" : "w-[calc(100%-24px)]",
          )}
          aria-label={`切换项目，当前 ${project.name}`}
        >
          <ResourceIcon resource={project} className="size-8" />
          {!compact && (
            <>
              <span className="min-w-0 flex-1">
                <strong className="block truncate text-xs" title={project.name}>
                  {project.name}
                </strong>
                <small className="mt-0.5 block truncate text-[11px] text-muted">
                  {project.code}
                </small>
              </span>
              <ChevronDown className="size-4 text-muted" />
            </>
          )}
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          side="right"
          align="start"
          className="z-50 max-h-80 w-72 overflow-y-auto rounded-lg border bg-popover p-1 shadow-xl"
        >
          {directory?.map((item) => (
            <DropdownMenu.Item
              key={item.id}
              asChild
              className="rounded-md outline-none focus:bg-surface-hover"
            >
              <Link
                to={`/projects/${item.id}`}
                onClick={close}
                className="flex items-center gap-2 px-3 py-2"
              >
                <ResourceIcon resource={item} className="size-7" />
                <span className="min-w-0 flex-1 truncate">{item.name}</span>
                {item.id === project.id && (
                  <Check className="size-4 text-primary" />
                )}
              </Link>
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
