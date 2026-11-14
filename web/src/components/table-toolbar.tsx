import {
  createContext,
  useContext,
  useId,
  useState,
  type ReactNode,
} from "react";
import { ChevronDown, FunnelX, SlidersHorizontal } from "lucide-react";
import { Collapsible } from "@base-ui/react/collapsible";
import { cn } from "@/lib/utils";
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
  className,
  toolbarClassName,
  filtersClassName,
  actionsClassName,
  advancedClassName,
  renderToolbar,
}: {
  children?: ReactNode;
  actions?: ReactNode;
  onReset?: () => void;
  onRefresh?: () => void | Promise<unknown>;
  refreshing?: boolean;
  advanced?: ReactNode;
  advancedCount?: number;
  className?: string;
  toolbarClassName?: string;
  filtersClassName?: string;
  actionsClassName?: string;
  advancedClassName?: string;
  renderToolbar?: (parts: {
    filters: ReactNode;
    controls: ReactNode;
    actions: ReactNode;
  }) => ReactNode;
}) {
  const [revision, setRevision] = useState(0);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const id = useId();
  const controls = (
    <>
      {advanced && (
        <Collapsible.Trigger
          render={
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
          }
        />
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
    </>
  );
  return (
    <ResetContext value={revision}>
      <Collapsible.Root
        open={open}
        onOpenChange={setOpen}
        className={cn("table-toolbar", className)}
      >
        {renderToolbar ? (
          renderToolbar({ filters: children, controls, actions })
        ) : (
          <div className={cn("toolbar", toolbarClassName)}>
            <div className={cn("toolbar-filters", filtersClassName)}>
              {children}
              {controls}
            </div>
            {actions && (
              <div className={cn("toolbar-actions", actionsClassName)}>
                {actions}
              </div>
            )}
          </div>
        )}
        {advanced && (
          <Collapsible.Panel
            id={id}
            className="toolbar-advanced overflow-hidden data-[open]:animate-in data-[open]:fade-in data-[ending-style]:animate-out data-[ending-style]:fade-out"
          >
            <div
              className={cn(
                "flex flex-wrap items-end gap-4 border-t border-t-border-subtle bg-surface-subtle px-4 py-4",
                advancedClassName,
              )}
            >
              {advanced}
            </div>
          </Collapsible.Panel>
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
