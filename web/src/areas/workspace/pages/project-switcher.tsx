import { useState } from "react";
import { Check, ChevronDown, RotateCw } from "lucide-react";
import { Link } from "react-router";
import { useSession } from "@/app/auth";
import { Button } from "@/components/button";
import { StandaloneInput } from "@/components/fields";
import { ResourceIcon } from "@/components/resource-icon";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useApiQuery } from "@/hooks/use-api";
import { useDebouncedSearch } from "@/hooks/use-search";
import { cn } from "@/lib/utils";
import type { Page, Resource } from "@/types/collaboration";

export function ProjectSwitcher({
  project,
  compact,
  close,
}: {
  project: Resource;
  compact: boolean;
  close?: () => void;
}) {
  const session = useSession();
  const [open, setOpen] = useState(false);
  const [submitted, setSubmitted] = useState("");
  const search = useDebouncedSearch("", setSubmitted, 300);
  const directory = useApiQuery<Page<Resource>>(
    ["project-switcher", session.user.id, submitted],
    `/projects?${new URLSearchParams({
      scope: "mine",
      status: "all",
      page: "1",
      page_size: "100",
      q: submitted,
    })}`,
    { enabled: open },
  );

  function changeOpen(value: boolean) {
    setOpen(value);
    if (!value) {
      setSubmitted("");
      search.setValue("");
    }
  }

  return (
    <DropdownMenu open={open} onOpenChange={changeOpen}>
      <DropdownMenuTrigger
        render={
          <button
            className={cn(
              "project-switcher flex items-center gap-2 rounded-lg bg-surface-subtle text-left text-navigation hover:border-border-strong hover:bg-surface-hover",
              "w-[calc(100%-24px)]",
            )}
            aria-label={`切换项目，当前 ${project.name}`}
          >
            <ResourceIcon resource={project} className="size-8" />
            <span
              className="sidebar-label min-w-0 flex-1"
              aria-hidden={compact}
            >
              <strong className="block truncate text-xs" title={project.name}>
                {project.name}
              </strong>
              <small className="mt-0.5 block truncate text-[11px] text-muted">
                {project.code}
                {project.status === "archived" ? " · 已归档" : ""}
              </small>
            </span>
            <ChevronDown className="sidebar-label size-4 text-muted" />
          </button>
        }
      />
      <DropdownMenuContent
        side="right"
        align="start"
        className="w-80 overflow-hidden p-0"
      >
        <div className="border-b border-b-border-subtle p-2">
          <StandaloneInput
            aria-label="搜索我的项目"
            placeholder="搜索名称、编码或摘要"
            value={search.value}
            onChange={(event) => search.setValue(event.target.value)}
            onCompositionStart={() => {
              search.composing.current = true;
            }}
            onCompositionEnd={search.compositionEnd}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                search.submit();
              }
              if (!["Escape", "ArrowDown", "ArrowUp"].includes(event.key))
                event.stopPropagation();
            }}
          />
        </div>
        <div className="max-h-72 overflow-y-auto p-1">
          {directory.isPending ? (
            <p className="p-4 text-center text-xs text-muted" role="status">
              正在加载项目…
            </p>
          ) : directory.isError ? (
            <div className="grid justify-items-center gap-2 p-4 text-xs text-muted">
              <p>项目列表加载失败。</p>
              <Button
                size="sm"
                variant="outline"
                onClick={() => void directory.refetch()}
              >
                <RotateCw />
                重新加载
              </Button>
            </div>
          ) : directory.data?.data.items.length ? (
            directory.data.data.items.map((item) => (
              <DropdownMenuItem
                key={item.id}
                render={
                  <Link
                    to={`/projects/${item.id}`}
                    onClick={close}
                    className="flex items-center gap-2"
                  >
                    <ResourceIcon resource={item} className="size-7" />
                    <span className="min-w-0 flex-1">
                      <strong className="block truncate text-sm">
                        {item.name}
                      </strong>
                      <small className="mono block truncate text-[11px] text-muted">
                        {item.code}
                      </small>
                    </span>
                    {item.status === "archived" && (
                      <span className="text-[11px] text-muted">已归档</span>
                    )}
                    {item.id === project.id && (
                      <Check className="size-4 text-primary" />
                    )}
                  </Link>
                }
              />
            ))
          ) : (
            <p className="p-4 text-center text-xs text-muted">
              {submitted ? "没有匹配的项目" : "暂无可切换项目"}
            </p>
          )}
        </div>
        {directory.data && directory.data.data.total > 100 && (
          <p className="border-t border-t-border-subtle px-3 py-2 text-[11px] text-muted">
            共 {directory.data.data.total} 个项目，请通过搜索缩小范围。
          </p>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
