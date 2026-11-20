import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { request } from "@/api/client";
import { Button } from "@/components/button";
import { StandaloneInput } from "@/components/fields";
import { AsyncBoundary, EmptyState } from "@/components/feedback";
import { AgentDialog, AgentDialogCancel } from "./dialog";
import styles from "./management.module.css";
import { Pagination } from "@/components/pagination";
import { useDebouncedSearch } from "@/hooks/use-search";

type PickerProps<T> = {
  title: string;
  path?: string;
  options?: T[];
  identify: (item: T) => string;
  label: (item: T) => string;
  description?: (item: T) => string;
  disabled?: (item: T) => boolean;
  onChoose: (item: T) => void;
  onClose: () => void;
  searchable?: boolean;
};
export function ResourcePicker<T>(props: PickerProps<T>) {
  return (
    <AgentDialog
      wide
      title={props.title}
      onClose={props.onClose}
      bodyClassName={styles.pickerBody}
      footer={<AgentDialogCancel>关闭</AgentDialogCancel>}
    >
      <PickerResults {...props} />
    </AgentDialog>
  );
}

export function PickerResults<T>({
  title,
  path,
  options,
  identify,
  label,
  description,
  disabled,
  onChoose,
  searchable = true,
}: Omit<PickerProps<T>, "onClose">) {
  const [q, setQ] = useState(""),
    [page, setPage] = useState(1),
    [size, setSize] = useState(20);
  const search = useDebouncedSearch(q, (value) => {
    setQ(value);
    setPage(1);
  });
  const params = new URLSearchParams({
    page: String(page),
    page_size: String(size),
  });
  if (searchable && q) params.set("q", q);
  const url = path ? `${path}${path.includes("?") ? "&" : "?"}${params}` : "";
  const query = useQuery({
    queryKey: ["agent-resource-picker", url],
    queryFn: ({ signal }) =>
      request<T[] | { items: T[]; total: number }>(url, { signal }),
    enabled: Boolean(path),
    retry: false,
  });
  const items = query.data
    ? Array.isArray(query.data.data)
      ? query.data.data
      : query.data.data.items
    : (options ?? []).filter((item) =>
        label(item).toLocaleLowerCase().includes(q.trim().toLocaleLowerCase()),
      );
  const total =
    query.data && !Array.isArray(query.data.data)
      ? query.data.data.total
      : query.data?.pagination?.total;
  return (
    <div className={styles.picker}>
      {searchable && (
        <StandaloneInput
          aria-label={`搜索${title}`}
          placeholder="输入名称搜索"
          autoFocus
          value={search.value}
          onChange={(event) => search.setValue(event.target.value)}
        />
      )}
      <div className={styles.pickerScroll}>
        <AsyncBoundary
          loading={Boolean(path) && query.isPending}
          error={query.error}
          onRetry={() => query.refetch()}
        >
          {items.length ? (
            <div className="divide-y divide-border-subtle rounded-lg border">
              {items.map((item) => (
                <div
                  key={identify(item)}
                  className="flex items-center gap-4 p-4"
                >
                  <div className="min-w-0 flex-1">
                    <p className="break-words text-sm font-medium">
                      {label(item)}
                    </p>
                    {description && (
                      <p className="mt-1 line-clamp-2 break-all text-xs text-muted">
                        {description(item)}
                      </p>
                    )}
                  </div>
                  <Button
                    variant="outline"
                    disabled={disabled?.(item)}
                    onClick={() => onChoose(item)}
                  >
                    选择
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState title="暂无匹配结果" />
          )}
        </AsyncBoundary>
      </div>
      {path && (
        <Pagination
          page={page}
          size={size}
          total={total}
          pending={query.isFetching}
          onChange={(next, count) => {
            setPage(next);
            setSize(count);
          }}
        />
      )}
    </div>
  );
}
