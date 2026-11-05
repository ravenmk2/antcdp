import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button, IconButton } from "./button";
import { StandaloneSelect } from "./fields";

export function Pagination({
  page,
  size,
  total,
  pageItems,
  hasNext,
  pending,
  onChange,
}: {
  page: number;
  size: number;
  total?: number;
  pageItems?: number;
  hasNext?: boolean;
  pending?: boolean;
  onChange: (page: number, size: number) => void;
}) {
  const cursor = total === undefined;
  const pages = Math.max(1, Math.ceil((total ?? 0) / size));
  const current = Math.max(1, Math.min(page, pages));
  return (
    <div className="flex min-h-14 flex-wrap items-center justify-between gap-3 border-t bg-surface-subtle px-4 py-2 text-xs text-muted">
      <div className="flex items-center gap-3">
        {!cursor && <span>共 {total} 条</span>}
        {cursor && <span>本页 {pageItems ?? 0} 条</span>}
        <label className="flex items-center gap-2">
          每页
          <StandaloneSelect
            aria-label="每页条数"
            className="min-h-8 min-w-18 py-1"
            value={size}
            disabled={pending}
            onChange={(event) => onChange(1, Number(event.target.value))}
          >
            {[10, 20, 50, 100].map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </StandaloneSelect>
        </label>
      </div>
      <div className="flex items-center gap-2">
        <IconButton
          size="iconSm"
          label="上一页"
          disabled={pending || current <= 1}
          onClick={() => onChange(current - 1, size)}
        >
          <ChevronLeft />
        </IconButton>
        <span className="min-w-16 text-center tabular-nums">
          {cursor ? `第 ${page} 页` : `${current} / ${pages}`}
        </span>
        <IconButton
          size="iconSm"
          label="下一页"
          disabled={pending || (cursor ? !hasNext : current >= pages)}
          onClick={() => onChange(current + 1, size)}
        >
          <ChevronRight />
        </IconButton>
        {!cursor && pages <= 7 && (
          <div className="ml-2 flex gap-1">
            {Array.from({ length: pages }, (_, index) => index + 1).map(
              (value) => (
                <Button
                  key={value}
                  size="iconSm"
                  variant={value === current ? "default" : "outline"}
                  aria-label={`第 ${value} 页`}
                  aria-current={value === current ? "page" : undefined}
                  disabled={pending}
                  onClick={() => onChange(value, size)}
                >
                  {value}
                </Button>
              ),
            )}
          </div>
        )}
      </div>
    </div>
  );
}
