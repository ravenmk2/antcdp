import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "./native-select";

type Counts =
  | { total: number; pageItems?: never; hasNext?: never }
  | { total?: never; pageItems: number; hasNext: boolean };
type Props = Counts & {
  page: number;
  size: number;
  pending?: boolean;
  onChange: (page: number, size: number) => void;
};
export function Pagination({
  page,
  size,
  total,
  pageItems,
  hasNext,
  pending,
  onChange,
}: Props) {
  const pages =
    total === undefined ? undefined : Math.max(1, Math.ceil(total / size));
  const arrow =
    "size-8 border border-transparent hover:border-muted-foreground hover:bg-accent";
  return (
    <nav
      aria-label="分页"
      className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t px-4 py-3 text-sm"
    >
      <div className="flex flex-wrap items-center gap-3">
        {total !== undefined && <span>共 {total} 条</span>}
        <label className="flex items-center gap-2 text-muted-foreground">
          每页
          <NativeSelect
            aria-label="每页条数"
            value={size}
            disabled={pending}
            onChange={(e) => onChange(1, Number(e.target.value))}
            className="h-8 w-auto py-0 pl-2 tabular-nums"
          >
            {[10, 20, 50, 100].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </NativeSelect>
        </label>
      </div>
      <div className="flex items-center gap-1">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={arrow}
          aria-label="上一页"
          title="上一页"
          disabled={pending || page <= 1}
          onClick={() => onChange(page - 1, size)}
        >
          <ChevronLeft />
        </Button>
        <span className="min-w-10 text-center tabular-nums" aria-live="polite">
          {pages === undefined ? `本页 ${pageItems} 条` : `${page}/${pages}`}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={arrow}
          aria-label="下一页"
          title="下一页"
          disabled={pending || (pages === undefined ? !hasNext : page >= pages)}
          onClick={() => onChange(page + 1, size)}
        >
          <ChevronRight />
        </Button>
      </div>
    </nav>
  );
}
