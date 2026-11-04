import { useNavigationProtection } from "./navigation-guard";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ErrorBox } from "./feedback";
import { useFocusRestoration } from "./use-focus-restoration";
export function FormDialog({
  open,
  title,
  description,
  children,
  footer,
  compact = false,
  dirty = false,
  pending = false,
  onClose,
}: {
  open: boolean;
  title: string;
  description?: string;
  children: ReactNode;
  footer: ReactNode | ((close: () => void) => ReactNode);
  compact?: boolean;
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
  const content = useRef<HTMLDivElement>(null);
  const focus = useFocusRestoration(open);
  useNavigationProtection(
    open ? (pending ? "pending" : dirty ? "dirty" : undefined) : undefined,
  );
  const close = () => {
    if (pending) return;
    if (dirty) setConfirming(true);
    else onClose();
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
      }}
    >
      <DialogContent
        ref={content}
        aria-describedby={description ? descriptionId : undefined}
        className={
          "flex max-h-[90dvh] overflow-hidden flex-col gap-0 p-0 " +
          (compact ? "sm:max-w-md" : "sm:max-w-[var(--dialog-max-width)]")
        }
        onOpenAutoFocus={() => {
          focus.captureFocus();
          setConfirming(false);
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          focus.restoreFocus();
        }}
        onEscapeKeyDown={(event) => {
          event.preventDefault();
          close();
        }}
        onInteractOutside={(event) => {
          event.preventDefault();
          close();
        }}
      >
        <DialogHeader
          className={
            "shrink-0 bg-card px-5 pt-5 sm:px-6 " +
            (compact ? "" : "border-b pb-4")
          }
        >
          <DialogTitle>{title}</DialogTitle>
          {description && (
            <DialogDescription id={descriptionId}>
              {description}
            </DialogDescription>
          )}
        </DialogHeader>
        <div
          className={
            "min-h-0 space-y-5 overflow-y-auto bg-card px-5 sm:px-6 " +
            (compact ? "pt-2 pb-5" : "py-5")
          }
        >
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
                    onClose();
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
        <DialogFooter className="shrink-0 border-t bg-muted/60 px-5 py-3 sm:px-6">
          {typeof footer === "function" ? footer(close) : footer}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
