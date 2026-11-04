import { useId, useState, type ComponentProps } from "react";
import { X } from "lucide-react";
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
  disclosureLabel,
  searchPlaceholder = "按名称或编码搜索",
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
  disclosureLabel?: string;
  searchPlaceholder?: string;
}) {
  const [q, setQ] = useState("");
  const [expanded, setExpanded] = useState(false);
  const resultsId = useId();
  const open = !disclosureLabel || expanded || !!controlProps?.["aria-invalid"];
  const query = useQuery<Option[]>(
    open ? `${path}?q=${encodeURIComponent(q)}` : null,
  );
  const name = (o: Option) => o.display_name || o.name || o.id;
  return (
    <div className="space-y-3">
      {disclosureLabel && (
        <div className="flex items-center justify-between gap-3">
          <span className="text-[13px] text-muted-foreground">
            已选 {selected.length} 人
          </span>
          <Button
            {...(!open ? controlProps : {})}
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled}
            aria-expanded={open}
            aria-controls={resultsId}
            aria-label={open ? "收起候选" : disclosureLabel}
            onClick={() => setExpanded(!open)}
          >
            {open ? "收起候选" : disclosureLabel}
          </Button>
        </div>
      )}
      {!disclosureLabel && (
        <Input
          {...controlProps}
          type="search"
          aria-label="搜索候选"
          placeholder={searchPlaceholder}
          value={q}
          disabled={disabled}
          onChange={(e) => setQ(e.target.value)}
        />
      )}
      {!!selected.length && (
        <div className="flex flex-wrap gap-2" aria-label="已选对象">
          {selected.map((o) => (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className={
                disclosureLabel
                  ? "h-auto min-h-8 max-w-full whitespace-normal"
                  : undefined
              }
              disabled={disabled}
              key={o.id}
              onClick={() =>
                onChange(selected.filter((item) => item.id !== o.id))
              }
              aria-label={`取消选择${name(o)}`}
            >
              <span className="min-w-0 break-all text-left">
                {name(o)}
                {disclosureLabel && o.username && (
                  <span className="ml-2 font-normal text-muted-foreground">
                    @{o.username}
                  </span>
                )}
              </span>
              <X className="size-3.5 shrink-0" aria-hidden="true" />
            </Button>
          ))}
        </div>
      )}
      {open && (
        <div id={resultsId} className="space-y-3">
          {disclosureLabel && (
            <Input
              {...controlProps}
              type="search"
              aria-label={searchPlaceholder}
              placeholder={searchPlaceholder}
              value={q}
              disabled={disabled}
              onChange={(e) => setQ(e.target.value)}
            />
          )}
          <p className="text-[13px] text-muted-foreground">
            最多展示 50
            个匹配候选，可继续输入缩小范围。已选对象不会因搜索而丢失。
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
                    onCheckedChange={(checked) => {
                      setExpanded(true);
                      onChange(
                        checked
                          ? multiple
                            ? [...selected, o]
                            : [o]
                          : selected.filter((v) => v.id !== o.id),
                      );
                    }}
                  />
                  <span>
                    {name(o)}
                    <span className="ml-2 text-[13px] text-muted-foreground">
                      {o.username ? `@${o.username}` : o.code}
                    </span>
                  </span>
                </label>
              ))}
            </AsyncState>
          </div>
        </div>
      )}
    </div>
  );
}
