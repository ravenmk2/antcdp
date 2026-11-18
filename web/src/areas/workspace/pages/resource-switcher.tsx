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
import type { Page, Resource, ResourceKind } from "@/types/collaboration";

export function ResourceSwitcher({
  kind,
  resource,
}: {
  kind: ResourceKind;
  resource: Resource;
}) {
  const session = useSession();
  const [open, setOpen] = useState(false);
  const [submitted, setSubmitted] = useState("");
  const search = useDebouncedSearch("", setSubmitted, 300);
  const project = kind === "projects";
  const label = project ? "项目" : "团队";
  const ended = project ? "archived" : "dissolved";
  const endedLabel = project ? "已归档" : "已解散";
  const directory = useApiQuery<Page<Resource>>(
    [
      project ? "project-switcher" : "team-switcher",
      session.user.id,
      submitted,
    ],
    `/${kind}?${new URLSearchParams({
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
            className="workspace-sidebar-switcher"
            aria-label={`切换${label}，当前 ${resource.name}`}
          >
            <ResourceIcon
              resource={resource}
              projectId={project ? resource.id : undefined}
              className="size-8"
            />
            <span className="min-w-0 flex-1">
              <strong className="block truncate text-sm" title={resource.name}>
                {resource.name}
              </strong>
              <small className="mt-0.5 block truncate text-[11px] text-muted">
                {resource.code}
                {resource.status === ended ? ` · ${endedLabel}` : ""}
              </small>
            </span>
            <ChevronDown className="sidebar-label size-4 text-muted" />
          </button>
        }
      />
      <DropdownMenuContent
        side="bottom"
        align="start"
        className="w-80 overflow-hidden p-0"
      >
        <div className="border-b border-b-border-subtle p-2">
          <StandaloneInput
            aria-label={`搜索我的${label}`}
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
              正在加载{label}…
            </p>
          ) : directory.isError ? (
            <div className="grid justify-items-center gap-2 p-4 text-xs text-muted">
              <p>{label}列表加载失败。</p>
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
                    to={`/${kind}/${item.id}`}
                    aria-current={item.id === resource.id ? "true" : undefined}
                    className="flex items-center gap-2"
                  >
                    <ResourceIcon
                      resource={item}
                      projectId={project ? item.id : undefined}
                      className="size-7"
                    />
                    <span className="min-w-0 flex-1">
                      <strong className="block truncate text-sm">
                        {item.name}
                      </strong>
                      <small className="mono block truncate text-[11px] text-muted">
                        {item.code}
                      </small>
                    </span>
                    {item.status === ended && (
                      <span className="text-[11px] text-muted">
                        {endedLabel}
                      </span>
                    )}
                    {item.id === resource.id && (
                      <Check aria-hidden className="size-4 text-primary" />
                    )}
                  </Link>
                }
              />
            ))
          ) : (
            <p className="p-4 text-center text-xs text-muted">
              {submitted ? `没有匹配的${label}` : `暂无可切换${label}`}
            </p>
          )}
        </div>
        {directory.data && directory.data.data.total > 100 && (
          <p className="border-t border-t-border-subtle px-3 py-2 text-[11px] text-muted">
            共 {directory.data.data.total} 个{label}，请通过搜索缩小范围。
          </p>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
