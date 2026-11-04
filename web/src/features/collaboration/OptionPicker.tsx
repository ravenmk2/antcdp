import { useState, type ComponentProps } from "react";
import type { Option } from "@/shared/collaboration";
import { useQuery } from "@/lib/use-query";
import { AsyncState } from "@/components/platform/feedback";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
export function OptionPicker({
  path,
  selected,
  onChange,
  multiple = false,
  disabled = false,
  controlProps,
}: {
  path: string;
  selected: Option[];
  onChange: (v: Option[]) => void;
  multiple?: boolean;
  disabled?: boolean;
  controlProps?: Pick<
    ComponentProps<"input">,
    "id" | "aria-describedby" | "aria-invalid"
  >;
}) {
  const [q, setQ] = useState("");
  const query = useQuery<Option[]>(`${path}?q=${encodeURIComponent(q)}`);
  const name = (o: Option) => o.display_name || o.name || o.id;
  return (
    <div className="space-y-3">
      <Input
        {...controlProps}
        type="search"
        aria-label="搜索候选"
        placeholder="按名称或编码搜索"
        value={q}
        disabled={disabled}
        onChange={(e) => setQ(e.target.value)}
      />
      {!!selected.length && (
        <div className="flex flex-wrap gap-2" aria-label="已选对象">
          {selected.map((o) => (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={disabled}
              key={o.id}
              onClick={() =>
                onChange(selected.filter((item) => item.id !== o.id))
              }
              aria-label={`取消选择${name(o)}`}
            >
              {name(o)} ×
            </Button>
          ))}
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        最多展示 50 个匹配候选，可继续输入缩小范围。已选对象不会因搜索而丢失。
      </p>
      <div className="max-h-56 overflow-y-auto rounded-lg border p-2">
        <AsyncState
          loading={query.loading}
          error={query.error}
          empty={!query.data?.length}
          onRetry={query.refresh}
        >
          {query.data?.map((o) => (
            <label
              key={o.id}
              className="flex cursor-pointer items-center gap-3 rounded-md p-2 text-sm hover:bg-muted"
            >
              <Checkbox
                checked={selected.some((v) => v.id === o.id)}
                disabled={
                  disabled ||
                  (multiple &&
                    selected.length >= 100 &&
                    !selected.some((v) => v.id === o.id))
                }
                onCheckedChange={(checked) =>
                  onChange(
                    checked
                      ? multiple
                        ? [...selected, o]
                        : [o]
                      : selected.filter((v) => v.id !== o.id),
                  )
                }
              />
              <span>
                {name(o)}
                <span className="ml-2 text-xs text-muted-foreground">
                  {o.username ? `@${o.username}` : o.code}
                </span>
              </span>
            </label>
          ))}
        </AsyncState>
      </div>
    </div>
  );
}
