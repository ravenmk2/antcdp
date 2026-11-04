import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { ErrorBox } from "./feedback";
import { useNavigationProtection } from "./navigation-guard";
import { useFocusRestoration } from "./use-focus-restoration";
export function FormDrawer({
  size = "wide",
  title,
  description,
  children,
  footer,
  dirty = false,
  pending = false,
  onClose,
}: {
  size?: "compact" | "wide";
  title: string;
  description?: string;
  children: ReactNode;
  footer: (close: (after?: () => void) => void) => ReactNode;
  dirty?: boolean;
  pending?: boolean;
  onClose: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const descriptionId = useId();
  const confirmation = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (confirming) {
      confirmation.current?.focus({ preventScroll: true });
      confirmation.current?.scrollIntoView?.({ block: "end" });
    }
  }, [confirming]);
  const focus = useFocusRestoration();
  useNavigationProtection(pending ? "pending" : dirty ? "dirty" : undefined);
  const discardAction = useRef(onClose);
  function close(after = onClose) {
    if (pending) return;
    if (dirty) {
      discardAction.current = after;
      setConfirming(true);
    } else after();
  }
  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <SheetContent
        side="right"
        aria-describedby={description ? descriptionId : undefined}
        className={
          "flex w-full flex-col gap-0 " +
          (size === "compact"
            ? "sm:max-w-[var(--drawer-compact-width)]"
            : "sm:max-w-[var(--drawer-max-width)]")
        }
        onOpenAutoFocus={() => {
          focus.captureFocus();
        }}
        onCloseAutoFocus={(e) => {
          e.preventDefault();
          focus.restoreFocus();
        }}
        onEscapeKeyDown={(e) => {
          e.preventDefault();
          close();
        }}
        onInteractOutside={(e) => {
          e.preventDefault();
          close();
        }}
      >
        <SheetHeader className="border-b bg-card px-5 py-4 sm:px-7 sm:py-5">
          <SheetTitle>{title}</SheetTitle>
          {description && (
            <SheetDescription id={descriptionId}>
              {description}
            </SheetDescription>
          )}
        </SheetHeader>
        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto bg-card p-5 sm:p-7">
          {children}
          {confirming && (
            <div
              ref={confirmation}
              tabIndex={-1}
              aria-label="未保存修改确认"
              className="space-y-3 outline-none"
            >
              <ErrorBox>有未保存的修改，确定放弃？</ErrorBox>
              <div className="flex gap-2">
                <Button
                  variant="destructive"
                  onClick={() => {
                    setConfirming(false);
                    discardAction.current();
                  }}
                >
                  放弃修改
                </Button>
                <Button variant="outline" onClick={() => setConfirming(false)}>
                  继续编辑
                </Button>
              </div>
            </div>
          )}
        </div>
        <SheetFooter className="flex-row flex-wrap justify-end border-t bg-muted/60 px-5 py-3 sm:px-7">
          {footer(close)}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
