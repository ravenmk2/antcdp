import { Dialog as Primitive } from "@base-ui/react/dialog";
import { TriangleAlert, X } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";
import { Button, IconButton } from "@/components/button";
import { useOverlayPresence } from "@/components/overlay-presence";
import { usePortalContainer } from "@/components/platform/surface-context";
import styles from "./dialog.module.css";
import management from "./management.module.css";

type DialogProps = {
  title: string;
  description?: ReactNode;
  icon?: ReactNode;
  tone?: "danger" | "warning";
  wide?: boolean;
  compact?: boolean;
  bodyClassName?: string;
  side?: "right";
  pending?: boolean;
  dirty?: boolean;
  restoreFocusTo?: HTMLElement | null;
  onClose: () => void;
  footer?: ReactNode;
  children?: ReactNode;
  open?: boolean;
};

export function AgentDialog({
  title,
  description,
  icon,
  tone,
  wide,
  compact,
  bodyClassName,
  side,
  pending,
  dirty,
  restoreFocusTo,
  onClose,
  footer,
  children,
  open = true,
}: DialogProps) {
  const container = usePortalContainer();
  const presence = useOverlayPresence();
  const popup = useRef<HTMLDivElement>(null);
  const [trigger] = useState(() =>
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null,
  );
  const [discard, setDiscard] = useState(false);
  return (
    <Primitive.Root
      open={open && (presence?.open ?? true)}
      onOpenChange={(next, details) => {
        if (next) return;
        if (pending || dirty) details.cancel();
        if (pending) return;
        if (dirty) setDiscard(true);
        else onClose();
      }}
      onOpenChangeComplete={(next) => {
        if (!next) presence?.onExitComplete();
      }}
    >
      <Primitive.Portal
        container={container}
        className={`${styles.scope} ${management.scope}`}
      >
        <Primitive.Backdrop className={styles.backdrop} />
        <Primitive.Popup
          ref={popup}
          className={styles.popup}
          data-slot={side ? "sheet-content" : "dialog-content"}
          data-wide={wide || undefined}
          data-compact={compact || undefined}
          data-side={side}
          data-tone={tone}
          initialFocus={() => {
            return (
              popup.current?.querySelector<HTMLElement>(
                "[data-console-initial-focus]",
              ) ?? true
            );
          }}
          finalFocus={() => {
            const target = restoreFocusTo ?? trigger;
            return target?.isConnected ? target : true;
          }}
        >
          <header className={styles.header}>
            {(icon || tone) && (
              <span className={styles.icon} aria-hidden>
                {icon ?? <TriangleAlert />}
              </span>
            )}
            <div className={styles.heading}>
              <Primitive.Title className={styles.title}>
                {title}
              </Primitive.Title>
              {description && (
                <Primitive.Description className={styles.description}>
                  {description}
                </Primitive.Description>
              )}
            </div>
            <Primitive.Close
              disabled={pending}
              render={
                <IconButton label="关闭" size="iconSm">
                  <X />
                </IconButton>
              }
            />
          </header>
          {children && (
            <div
              className={[styles.body, bodyClassName].filter(Boolean).join(" ")}
            >
              {children}
            </div>
          )}
          {footer && <footer className={styles.footer}>{footer}</footer>}
          {discard && (
            <AgentDialog
              compact
              title="放弃未保存的修改？"
              description="关闭后，本次尚未保存的内容将丢失。"
              tone="warning"
              onClose={() => setDiscard(false)}
              footer={
                <>
                  <AgentDialogCancel initialFocus>继续编辑</AgentDialogCancel>
                  <Button
                    variant="danger"
                    onClick={() => {
                      setDiscard(false);
                      onClose();
                    }}
                  >
                    放弃修改
                  </Button>
                </>
              }
            />
          )}
        </Primitive.Popup>
      </Primitive.Portal>
    </Primitive.Root>
  );
}

export function AgentDialogCancel({
  initialFocus,
  pending,
  children = "取消",
}: {
  initialFocus?: boolean;
  pending?: boolean;
  children?: ReactNode;
}) {
  return (
    <Primitive.Close
      disabled={pending}
      render={
        <Button
          variant="outline"
          data-console-initial-focus={initialFocus || undefined}
        >
          {children}
        </Button>
      }
    />
  );
}
