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
    <DropdownMenu
      onOpenChangeComplete={(open) => {
        if (open) return;
        const action = selection.current;
        selection.current = null;
        if (action) {
          trigger.current?.focus();
          action();
        }
      }}
    >
      <DropdownMenuTrigger
        render={
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
        }
      />
      <DropdownMenuContent
        align="end"
        sideOffset={4}
        collisionPadding={8}
        className="min-w-44"
        onClick={(event) => event.stopPropagation()}
        finalFocus={trigger}
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
}: Omit<ComponentProps<typeof DropdownMenuItem>, "onSelect"> & {
  onSelect?: () => void;
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
      render={to ? <Link to={to} /> : href ? <a href={href} /> : undefined}
      onClick={() => {
        if (onSelect && select) select(onSelect);
        else onSelect?.();
      }}
    >
      {content}
    </DropdownMenuItem>
  );
}

export const RowActionSeparator = DropdownMenuSeparator;
