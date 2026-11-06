import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from "lucide-react";
import { IconButton } from "./button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";

export function Pagination({
  page,
  size,
  total,
  hasNext,
  pending,
  onChange,
}: {
  page: number;
  size: number;
  total?: number;
  hasNext?: boolean;
  pending?: boolean;
  onChange: (page: number, size: number) => void;
}) {
  const pages =
    total === undefined ? undefined : Math.max(1, Math.ceil(total / size));
  const current = Math.max(
    1,
    pages === undefined ? page : Math.min(page, pages),
  );
  const first = current <= 1;
  const last = pages === undefined ? !hasNext : current >= pages;
  return (
    <nav
      aria-label="分页导航"
      className="flex min-h-14 flex-wrap items-center justify-between gap-3 border-t bg-surface-subtle px-4 py-2 text-xs text-muted"
    >
      <span>{total === undefined ? "总数未知" : `共 ${total} 条`}</span>
      <div className="ml-auto flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <span>每页</span>
          <Select
            value={String(size)}
            disabled={pending}
            onValueChange={(value) => onChange(1, Number(value))}
          >
            <SelectTrigger
              aria-label="每页条数"
              size="sm"
              className="w-16 gap-1 bg-surface px-2 text-xs"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent
              position="popper"
              align="end"
              sideOffset={4}
              className="z-70 min-w-20"
            >
              {[10, 20, 50, 100].map((value) => (
                <SelectItem key={value} value={String(value)}>
                  {value}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span>条</span>
        </div>
        <span
          aria-label={`第 ${current} 页，共 ${pages ?? "未知"} 页`}
          className="whitespace-nowrap text-center tabular-nums"
        >
          {current}/{pages ?? "—"}
        </span>
        <div className="flex items-center gap-2">
          <IconButton
            variant="outline"
            size="iconSm"
            label="首页"
            disabled={pending || first}
            onClick={() => onChange(1, size)}
          >
            <ChevronsLeft />
          </IconButton>
          <IconButton
            variant="outline"
            size="iconSm"
            label="上一页"
            disabled={pending || first}
            onClick={() => onChange(current - 1, size)}
          >
            <ChevronLeft />
          </IconButton>
          <IconButton
            variant="outline"
            size="iconSm"
            label="下一页"
            disabled={pending || last}
            onClick={() => onChange(current + 1, size)}
          >
            <ChevronRight />
          </IconButton>
          <IconButton
            variant="outline"
            size="iconSm"
            label="末页"
            disabled={pending || pages === undefined || last}
            onClick={() => {
              if (pages !== undefined) onChange(pages, size);
            }}
          >
            <ChevronsRight />
          </IconButton>
        </div>
      </div>
    </nav>
  );
}
