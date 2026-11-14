import { useId, type ReactNode } from "react";
import {
  DisclosureChevron,
  DisclosureContent,
  useDisclosureMotion,
} from "./disclosure-motion";

/** Keep content mounted so streamed replies and nested controls retain identity. */
export function ChatDisclosure({
  open,
  onToggle,
  label,
  icon,
  detail,
  children,
  active = false,
  locked = false,
}: {
  open: boolean;
  onToggle: () => void;
  label: string;
  icon?: ReactNode;
  detail?: ReactNode;
  children: ReactNode;
  active?: boolean;
  locked?: boolean;
}) {
  const id = useId();
  const motion = useDisclosureMotion();
  return (
    <div className="agent-disclosure" data-active={active}>
      <button
        type="button"
        className="agent-disclosure-trigger"
        aria-expanded={open}
        aria-controls={id}
        disabled={locked}
        onClick={(event) => motion.toggle(event, onToggle)}
      >
        {icon}
        <span className={active ? "agent-activity-label" : undefined}>
          {label}
        </span>
        {detail && <span className="agent-disclosure-preview">{detail}</span>}
        <span className="agent-disclosure-spacer" />
        <DisclosureChevron open={open} revision={motion.revision} />
      </button>
      <div id={id} inert={!open} aria-hidden={!open}>
        <DisclosureContent open={open} revision={motion.revision}>
          {children}
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
