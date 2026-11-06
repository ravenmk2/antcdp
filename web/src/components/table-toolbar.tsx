import {
  createContext,
  useContext,
  useId,
  useState,
  type ReactNode,
} from "react";
import { ChevronDown, FunnelX, SlidersHorizontal } from "lucide-react";
import { Collapsible } from "radix-ui";
import { Button, IconButton } from "./button";
import { ErrorNotice, RefreshButton } from "./feedback";

const ResetContext = createContext<number | null>(null);
export function useFilterReset() {
  return useContext(ResetContext);
}

export function TableToolbar({
  children,
  actions,
  onReset,
  onRefresh,
  refreshing,
  advanced,
  advancedCount = 0,
}: {
  children?: ReactNode;
  actions?: ReactNode;
  onReset?: () => void;
  onRefresh?: () => void | Promise<unknown>;
  refreshing?: boolean;
  advanced?: ReactNode;
  advancedCount?: number;
}) {
  const [revision, setRevision] = useState(0);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const id = useId();
  return (
    <ResetContext value={revision}>
      <Collapsible.Root
        open={open}
        onOpenChange={setOpen}
        className="table-toolbar"
      >
        <div className="toolbar">
          <div className="toolbar-filters">
            {children}
            {advanced && (
              <Collapsible.Trigger asChild>
                <Button variant="outline" aria-controls={id}>
                  <SlidersHorizontal />
                  高级搜索
                  {advancedCount > 0 && (
                    <span className="rounded bg-primary/10 px-1.5 text-xs text-primary">
                      {advancedCount}
                    </span>
                  )}
                  <ChevronDown
                    className={
                      open
                        ? "rotate-180 transition-transform"
                        : "transition-transform"
                    }
                  />
                </Button>
              </Collapsible.Trigger>
            )}
            {onReset && (
              <IconButton
                label="重置筛选"
                variant="outline"
                className="size-10"
                onClick={() => {
                  onReset();
                  setRevision((value) => value + 1);
                }}
              >
                <FunnelX />
              </IconButton>
            )}
            {onRefresh && (
              <RefreshButton
                loading={refreshing || busy}
                onClick={() => {
                  setBusy(true);
                  setError(undefined);
                  void Promise.resolve()
                    .then(onRefresh)
                    .catch(setError)
                    .finally(() => setBusy(false));
                }}
              />
            )}
          </div>
          {actions && <div className="toolbar-actions">{actions}</div>}
        </div>
        {advanced && (
          <Collapsible.Content
            id={id}
            className="toolbar-advanced overflow-hidden data-[state=open]:animate-in data-[state=open]:fade-in data-[state=closed]:animate-out data-[state=closed]:fade-out"
          >
            <div className="flex flex-wrap items-end gap-4 border-t bg-surface-subtle px-4 py-4">
              {advanced}
            </div>
          </Collapsible.Content>
        )}
        {Boolean(error) && (
          <div className="px-4 pb-3">
            <ErrorNotice error={error} />
          </div>
        )}
      </Collapsible.Root>
    </ResetContext>
  );
}
