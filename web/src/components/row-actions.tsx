import {
  createContext,
  useContext,
  useRef,
  type ComponentProps,
  type ReactNode,
} from "react";
import { Link } from "react-router";
import { Ellipsis } from "lucide-react";
import { Button } from "./button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";

const ActionSelection = createContext<((action: () => void) => void) | null>(
  null,
);

export function RowActions({
  label,
  children,
  disabled,
}: {
  label: string;
  children: ReactNode;
  disabled?: boolean;
}) {
  const trigger = useRef<HTMLButtonElement>(null);
  const selection = useRef<(() => void) | null>(null);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          ref={trigger}
          variant="ghost"
          size="iconSm"
          aria-label={`${label}的操作`}
          title="操作"
          disabled={disabled}
          onClick={(event) => event.stopPropagation()}
        >
          <Ellipsis aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        sideOffset={4}
        collisionPadding={8}
        className="min-w-44"
        onClick={(event) => event.stopPropagation()}
        onCloseAutoFocus={(event) => {
          // Finish menu dismissal before opening another focus trap.
          event.preventDefault();
          trigger.current?.focus();
          const action = selection.current;
          selection.current = null;
          action?.();
        }}
      >
        <ActionSelection.Provider
          value={(action) => {
            selection.current = action;
          }}
        >
          {children}
        </ActionSelection.Provider>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function RowAction({
  icon,
  children,
  to,
  href,
  onSelect,
  ...props
}: ComponentProps<typeof DropdownMenuItem> & {
  icon: ReactNode;
  to?: string;
  href?: string;
}) {
  const select = useContext(ActionSelection);
  const content = (
    <>
      {icon}
      {children}
    </>
  );
  return (
    <DropdownMenuItem
      {...props}
      asChild={Boolean(to || href)}
      onSelect={(event) => {
        if (onSelect && select) select(() => onSelect(event));
        else onSelect?.(event);
      }}
    >
      {to ? (
        <Link to={to}>{content}</Link>
      ) : href ? (
        <a href={href}>{content}</a>
      ) : (
        content
      )}
    </DropdownMenuItem>
  );
}

export const RowActionSeparator = DropdownMenuSeparator;
