import { useId, useState, type ReactNode } from "react";
import { CircleAlert } from "lucide-react";
import { Tooltip } from "@base-ui/react/tooltip";
import { usePortalContainer } from "@/components/platform/surface-context";
import styles from "./status-hint.module.css";

/** Chat owns the appearance; the primitive supplies focus, dismissal and placement. */
export function StatusHint({
  label,
  children,
  icon = <CircleAlert aria-hidden="true" />,
  danger = false,
}: {
  label: string;
  children: ReactNode;
  icon?: ReactNode;
  danger?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const container = usePortalContainer();
  return (
    <Tooltip.Root open={open} onOpenChange={setOpen}>
      <Tooltip.Trigger
        className={styles.trigger}
        data-danger={danger}
        aria-label={label}
        aria-describedby={open ? id : undefined}
        delay={200}
        closeOnClick={false}
        onClick={(event) => {
          event.stopPropagation();
          setOpen(true);
        }}
      >
        {icon}
      </Tooltip.Trigger>
      <Tooltip.Portal container={container}>
        <Tooltip.Positioner
          side="top"
          align="start"
          sideOffset={6}
          collisionPadding={12}
          className={styles.positioner}
        >
          <Tooltip.Popup id={id} role="tooltip" className={styles.popup}>
            {children}
          </Tooltip.Popup>
        </Tooltip.Positioner>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

export function StatusNote({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <span className={styles.note}>
      {label}
      <StatusHint label={`${label}说明`}>{children}</StatusHint>
    </span>
  );
}
