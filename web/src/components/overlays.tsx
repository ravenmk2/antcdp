import { useRef, useState, type ReactNode } from "react";
import { Dialog as Primitive } from "radix-ui";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button, IconButton } from "./button";
import { useOverlayPresence } from "./overlay-presence";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "./ui/sheet";

interface OverlayProps {
  open: boolean;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
  pending?: boolean;
  dirty?: boolean;
  wide?: boolean;
  restoreFocusTo?: HTMLElement | null;
}

export function Modal({
  open,
  title,
  description,
  children,
  footer,
  onClose,
  pending,
  dirty,
  wide,
  restoreFocusTo,
}: OverlayProps) {
  const [discard, setDiscard] = useState(false);
  const returnFocus = useRef<HTMLElement | null>(null);
  const requestClose = () => {
    if (pending) return;
    if (dirty) setDiscard(true);
    else onClose();
  };
  return (
    <>
      <Primitive.Root
        open={open}
        onOpenChange={(next) => {
          if (!next) requestClose();
        }}
      >
        <Primitive.Portal>
          <Primitive.Overlay className="fixed inset-0 z-50 bg-[#09101a]/50 backdrop-blur-[2px] data-[state=open]:animate-in data-[state=open]:fade-in" />
          <Primitive.Content
            className={cn(
              "fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100dvh-48px)] w-[calc(100%-32px)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border bg-surface shadow-2xl outline-none data-[state=open]:animate-in data-[state=open]:fade-in data-[state=open]:zoom-in-95",
              wide ? "max-w-[680px]" : "max-w-[510px]",
            )}
            onOpenAutoFocus={() => {
              returnFocus.current =
                restoreFocusTo ??
                (document.activeElement instanceof HTMLElement
                  ? document.activeElement
                  : null);
            }}
            onCloseAutoFocus={(event) => {
              if (returnFocus.current?.isConnected) {
                event.preventDefault();
                returnFocus.current.focus();
              }
            }}
            onEscapeKeyDown={(event) => {
              if (pending) event.preventDefault();
            }}
          >
            <header className="flex items-start justify-between gap-4 border-b px-6 py-5">
              <div>
                <Primitive.Title className="text-lg font-semibold">
                  {title}
                </Primitive.Title>
                {description && (
                  <Primitive.Description className="mt-1 text-xs leading-5 text-muted">
                    {description}
                  </Primitive.Description>
                )}
              </div>
              <Primitive.Close asChild>
                <IconButton size="iconSm" label="关闭" disabled={pending}>
                  <X />
                </IconButton>
              </Primitive.Close>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
              {children}
            </div>
            {footer && (
              <footer className="flex flex-wrap items-center justify-end gap-2 border-t bg-surface-subtle px-6 py-4">
                {footer}
              </footer>
            )}
          </Primitive.Content>
        </Primitive.Portal>
      </Primitive.Root>
      {discard && (
        <ConfirmDialog
          open={discard}
          title="放弃未保存的修改？"
          description="关闭后，本次尚未保存的内容将丢失。"
          confirmLabel="放弃修改"
          danger
          onClose={() => setDiscard(false)}
          onConfirm={onClose}
        />
      )}
    </>
  );
}

// Keep the business-facing API while Sheet owns the panel and its animations.
export function Drawer({
  open,
  title,
  description,
  children,
  footer,
  onClose,
  pending,
  dirty,
  wide,
}: OverlayProps) {
  const [discard, setDiscard] = useState(false);
  const presence = useOverlayPresence();
  const returnFocus = useRef<HTMLElement | null>(null);
  const visible = open && (presence?.open ?? true);
  const requestClose = () => {
    if (pending) return;
    if (dirty) setDiscard(true);
    else onClose();
  };
  return (
    <>
      <Sheet
        open={visible}
        onOpenChange={(next) => {
          if (!next) requestClose();
        }}
      >
        <SheetContent
          side="right"
          showCloseButton={false}
          className={cn(
            "w-full gap-0 bg-surface shadow-2xl outline-none data-[state=closed]:pointer-events-none",
            wide
              ? "max-w-[720px] sm:max-w-[720px]"
              : "max-w-[540px] sm:max-w-[540px]",
          )}
          onOpenAutoFocus={() => {
            returnFocus.current =
              document.activeElement instanceof HTMLElement
                ? document.activeElement
                : null;
          }}
          onCloseAutoFocus={(event) => {
            presence?.onExitComplete();
            if (returnFocus.current?.isConnected) {
              event.preventDefault();
              returnFocus.current.focus();
            }
          }}
          onEscapeKeyDown={(event) => {
            if (pending) event.preventDefault();
          }}
        >
          <header className="flex items-start justify-between gap-4 border-b px-6 py-5">
            <div>
              <SheetTitle className="text-lg font-semibold">{title}</SheetTitle>
              {description && (
                <SheetDescription className="mt-1 text-xs leading-5 text-muted">
                  {description}
                </SheetDescription>
              )}
            </div>
            <SheetClose asChild>
              <IconButton size="iconSm" label="关闭" disabled={pending}>
                <X />
              </IconButton>
            </SheetClose>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
            {children}
          </div>
          {footer && (
            <footer className="flex flex-wrap items-center justify-end gap-2 border-t bg-surface-subtle px-6 py-4">
              {footer}
            </footer>
          )}
        </SheetContent>
      </Sheet>
      {discard && (
        <ConfirmDialog
          open={discard}
          title="放弃未保存的修改？"
          description="关闭后，本次尚未保存的内容将丢失。"
          confirmLabel="放弃修改"
          danger
          onClose={() => setDiscard(false)}
          onConfirm={() => {
            setDiscard(false);
            onClose();
          }}
        />
      )}
    </>
  );
}

export function ConfirmDialog({
  open,
  title,
  description,
  children,
  confirmLabel = "确认",
  danger,
  pending,
  onClose,
  onConfirm,
}: {
  open: boolean;
  title: string;
  description?: string;
  children?: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  pending?: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <Modal
      open={open}
      title={title}
      description={description}
      onClose={onClose}
      pending={pending}
      footer={
        <>
          <Button variant="outline" disabled={pending} onClick={onClose}>
            取消
          </Button>
          <Button
            variant={danger ? "danger" : "default"}
            pending={pending}
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      {children}
    </Modal>
  );
}
