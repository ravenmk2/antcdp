import { usePortalContainer } from "@/components/platform/surface-context";
import { cn } from "@/lib/utils";
import { X } from "lucide-react";
import { Dialog as Primitive } from "@base-ui/react/dialog";
import {
  createContext,
  useContext,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";
import { Button, IconButton, type ButtonProps } from "./button";
import { useOverlayPresence } from "./overlay-presence";
import { withBaseClass } from "./ui/class-name";

type OverlayBehavior = {
  open: boolean;
  onClose: () => void;
  pending?: boolean;
  dirty?: boolean;
  children: ReactNode;
};
const OverlayContext = createContext<{
  pending: boolean;
  requestClose: () => void;
} | null>(null);

function useOverlay() {
  const context = useContext(OverlayContext);
  if (!context) throw new Error("OverlayRoot is required");
  return context;
}

// Lifetime, pending and draft protection are independent of the popup's layout.
export function OverlayRoot({
  open,
  onClose,
  pending = false,
  dirty,
  children,
}: OverlayBehavior) {
  const presence = useOverlayPresence();
  const [discard, setDiscard] = useState(false);
  const requestClose = () => {
    if (pending) return;
    if (dirty) setDiscard(true);
    else onClose();
  };
  return (
    <>
      <Primitive.Root
        open={open && (presence?.open ?? true)}
        onOpenChange={(next, details) => {
          if (!next) {
            if (pending || dirty) details.cancel();
            requestClose();
          }
        }}
        onOpenChangeComplete={(next) => {
          if (!next) presence?.onExitComplete();
        }}
      >
        <OverlayContext value={{ pending, requestClose }}>
          {children}
        </OverlayContext>
      </Primitive.Root>
      {discard && (
        <ConfirmDialog
          open
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

export function OverlayCancelButton({
  variant = "outline",
  disabled,
  onClick,
  children = "取消",
  ...props
}: ButtonProps) {
  const close = useOverlay();
  return (
    <Button
      variant={variant}
      disabled={disabled || close.pending}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) close.requestClose();
      }}
      {...props}
    >
      {children}
    </Button>
  );
}

export function OverlayClose({ disabled, ...props }: Primitive.Close.Props) {
  const { pending } = useOverlay();
  return <Primitive.Close disabled={disabled || pending} {...props} />;
}
export function OverlayTitle({ className, ...props }: Primitive.Title.Props) {
  return (
    <Primitive.Title
      className={withBaseClass("text-lg font-semibold", className)}
      {...props}
    />
  );
}
export function OverlayDescription({
  className,
  ...props
}: Primitive.Description.Props) {
  return (
    <Primitive.Description
      className={withBaseClass("mt-1 text-xs leading-5 text-muted", className)}
      {...props}
    />
  );
}
export function OverlayHeader({
  className,
  ...props
}: ComponentProps<"header">) {
  return (
    <header
      className={cn(
        "flex items-start justify-between gap-4 border-b border-b-border-subtle px-6 py-5",
        className,
      )}
      {...props}
    />
  );
}
export function OverlayBody({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "min-h-0 flex-1 overflow-y-auto px-6 py-5 empty:hidden",
        className,
      )}
      {...props}
    />
  );
}
export function OverlayFooter({
  className,
  ...props
}: ComponentProps<"footer">) {
  return (
    <footer
      className={cn(
        "flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-t-border-subtle bg-surface-subtle px-6 py-4",
        className,
      )}
      {...props}
    />
  );
}

type Side = "top" | "right" | "bottom" | "left";
type PopupProps = Primitive.Popup.Props & {
  side?: Side;
  restoreFocusTo?: HTMLElement | null;
  backdropProps?: Primitive.Backdrop.Props;
};
export function OverlayPopup({
  className,
  side,
  restoreFocusTo,
  finalFocus,
  initialFocus,
  backdropProps,
  ...props
}: PopupProps) {
  const container = usePortalContainer();
  const returnFocus = useRef<HTMLElement | null>(null);
  return (
    <Primitive.Portal container={container}>
      <Primitive.Backdrop
        {...backdropProps}
        className={withBaseClass(
          "overlay-backdrop fixed inset-0 isolate z-50 bg-[#09101a]/50 backdrop-blur-[2px]",
          backdropProps?.className,
        )}
      />
      <Primitive.Popup
        data-slot={side ? "sheet-content" : "dialog-content"}
        data-side={side}
        className={withBaseClass(
          cn(
            "overlay-panel fixed z-50 flex flex-col overflow-hidden border bg-surface shadow-(--floating-shadow) outline-none data-[ending-style]:pointer-events-none",
            side
              ? "sheet-motion"
              : "dialog-motion top-1/2 left-1/2 max-h-[calc(100dvh-48px)] w-[calc(100%-32px)] max-w-[510px] -translate-x-1/2 -translate-y-1/2 rounded-(--dialog-radius)",
            side === "right" &&
              "inset-y-0 right-0 h-full w-full max-w-[540px] border-y-0 border-r-0",
            side === "left" &&
              "inset-y-0 left-0 h-full w-full max-w-[540px] border-y-0 border-l-0",
            side === "top" &&
              "inset-x-0 top-0 max-h-dvh w-full border-x-0 border-t-0",
            side === "bottom" &&
              "inset-x-0 bottom-0 max-h-dvh w-full border-x-0 border-b-0",
          ),
          className,
        )}
        initialFocus={
          initialFocus ??
          (() => {
            returnFocus.current =
              restoreFocusTo ??
              (document.activeElement instanceof HTMLElement
                ? document.activeElement
                : null);
            return true;
          })
        }
        finalFocus={
          finalFocus ??
          (() => {
            const target = restoreFocusTo ?? returnFocus.current;
            return target?.isConnected ? target : true;
          })
        }
        {...props}
      />
    </Primitive.Portal>
  );
}

interface OverlayProps extends OverlayBehavior {
  title: ReactNode;
  description?: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  restoreFocusTo?: HTMLElement | null;
  finalFocus?: Primitive.Popup.Props["finalFocus"];
  initialFocus?: Primitive.Popup.Props["initialFocus"];
  className?: string;
  headerClassName?: string;
  bodyClassName?: string;
  footerClassName?: string;
}

export function Modal(props: OverlayProps) {
  return <DialogFrame {...props} />;
}
export function Drawer({
  side = "right",
  ...props
}: OverlayProps & { side?: Side }) {
  return <DialogFrame side={side} {...props} />;
}

function DialogFrame({
  open,
  onClose,
  pending,
  dirty,
  title,
  description,
  children,
  footer,
  wide,
  restoreFocusTo,
  finalFocus,
  initialFocus,
  className,
  headerClassName,
  bodyClassName,
  footerClassName,
  confirmation = false,
  side,
}: OverlayProps & { confirmation?: boolean; side?: Side }) {
  return (
    <OverlayRoot open={open} onClose={onClose} pending={pending} dirty={dirty}>
      <OverlayPopup
        side={side}
        restoreFocusTo={restoreFocusTo}
        finalFocus={finalFocus}
        initialFocus={initialFocus}
        className={cn(
          wide &&
            (side === "left" || side === "right"
              ? "max-w-[720px]"
              : !side && "max-w-[680px]"),
          className,
        )}
      >
        <OverlayHeader
          className={cn(
            confirmation && "min-h-0 overflow-y-auto border-0",
            headerClassName,
          )}
        >
          <div>
            <OverlayTitle>{title}</OverlayTitle>
            {description && (
              <OverlayDescription>{description}</OverlayDescription>
            )}
          </div>
          <OverlayClose
            render={
              <IconButton size="iconSm" label="关闭">
                <X />
              </IconButton>
            }
          />
        </OverlayHeader>
        <OverlayBody className={cn(confirmation && "pt-0 pb-4", bodyClassName)}>
          {children}
        </OverlayBody>
        {footer && (
          <OverlayFooter
            className={cn(
              confirmation && "border-0 bg-transparent pt-1 pb-5",
              footerClassName,
            )}
          >
            {footer}
          </OverlayFooter>
        )}
      </OverlayPopup>
    </OverlayRoot>
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
  confirmDisabled,
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
  confirmDisabled?: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <DialogFrame
      confirmation
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
            disabled={confirmDisabled}
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      {children}
    </DialogFrame>
  );
}
