import { useId, type ReactNode } from "react";
import { DisclosureScope, useDisclosureState } from "./disclosure-state";
import {
  DisclosureChevron,
  DisclosureContent,
  useDisclosureMotion,
} from "./disclosure-motion";

/** Keep content mounted so streamed replies and nested controls retain identity. */
export function ChatDisclosure({
  open: defaultOpen,
  onToggle,
  label,
  icon,
  detail,
  collapsedDetail,
  trailing,
  children,
  active = false,
  locked = false,
  headingHidden = false,
  automatic = false,
}: {
  open: boolean;
  onToggle?: () => void;
  label: string;
  icon?: ReactNode;
  detail?: ReactNode;
  collapsedDetail?: ReactNode;
  trailing?: ReactNode;
  children: ReactNode;
  active?: boolean;
  locked?: boolean;
  headingHidden?: boolean;
  automatic?: boolean;
}) {
  const id = useId();
  const intent = useDisclosureState();
  const open = automatic ? intent.expanded(id, defaultOpen) : defaultOpen;
  const motion = useDisclosureMotion();
  const preview = open ? detail : (collapsedDetail ?? detail);
  return (
    <div className="agent-disclosure" data-active={active}>
      {!headingHidden && (
        <div className="agent-disclosure-heading">
          <button
            type="button"
            className="agent-disclosure-trigger"
            aria-expanded={open}
            aria-controls={id}
            disabled={locked}
            onClick={(event) =>
              motion.toggle(event, () => {
                intent.change(id, !open);
                onToggle?.();
              })
            }
          >
            {icon}
            <span className={active ? "agent-activity-label" : undefined}>
              {label}
            </span>
            {preview && (
              <span className="agent-disclosure-preview">{preview}</span>
            )}
            <span className="agent-disclosure-spacer" />
            {trailing && <span className="agent-disclosure-trailing-space" />}
            <DisclosureChevron open={open} revision={motion.revision} />
          </button>
          {trailing && (
            <div className="agent-disclosure-trailing">{trailing}</div>
          )}
        </div>
      )}
      <div id={id} inert={!open} aria-hidden={!open}>
        <DisclosureContent open={open} revision={motion.revision}>
          <DisclosureScope id={id}>{children}</DisclosureScope>
        </DisclosureContent>
      </div>
    </div>
  );
}

export function ThinkingDots() {
  return (
    <svg
      className="agent-thinking-dots"
      viewBox="0 0 18 18"
      fill="currentColor"
      aria-hidden
    >
      <circle cx="3" cy="9" r="1.5" />
      <circle cx="9" cy="9" r="1.5" />
      <circle cx="15" cy="9" r="1.5" />
    </svg>
  );
}
