import { usePortalContainer } from "@/components/platform/surface-context";
// Adapted from shadcn/ui; see dropdown-menu.LICENSE.
import { Menu } from "@base-ui/react/menu";
import { Check, ChevronRight, Circle } from "lucide-react";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";
import { withBaseClass } from "./class-name";

export const DropdownMenu = Menu.Root;
export const DropdownMenuTrigger = Menu.Trigger;
export const DropdownMenuGroup = Menu.Group;
export const DropdownMenuRadioGroup = Menu.RadioGroup;
export const DropdownMenuSub = Menu.SubmenuRoot;

export function DropdownMenuPortal(props: Menu.Portal.Props) {
  const container = usePortalContainer();
  return <Menu.Portal container={container} {...props} />;
}

type ContentProps = Menu.Popup.Props &
  Pick<
    Menu.Positioner.Props,
    "align" | "side" | "sideOffset" | "alignOffset" | "collisionPadding"
  > & { positionerProps?: Menu.Positioner.Props };

export function DropdownMenuContent({
  className,
  side = "bottom",
  align = "start",
  sideOffset = 4,
  alignOffset,
  collisionPadding = 8,
  positionerProps,
  ...props
}: ContentProps) {
  return (
    <DropdownMenuPortal>
      <Menu.Positioner
        className="z-[80]"
        side={side}
        align={align}
        sideOffset={sideOffset}
        alignOffset={alignOffset}
        collisionPadding={collisionPadding}
        {...positionerProps}
      >
        <Menu.Popup
          data-slot="dropdown-menu-content"
          className={withBaseClass(
            "max-h-(--available-height) min-w-32 origin-(--transform-origin) overflow-x-hidden overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-(--floating-shadow) outline-none transition-[opacity,transform] duration-150 data-[starting-style]:scale-95 data-[starting-style]:opacity-0 data-[ending-style]:scale-95 data-[ending-style]:opacity-0",
            className,
          )}
          {...props}
        />
      </Menu.Positioner>
    </DropdownMenuPortal>
  );
}

const itemClass =
  "relative flex cursor-pointer items-center gap-2 rounded-sm px-2 py-2 text-sm outline-none select-none data-[highlighted]:bg-surface-hover data-[highlighted]:text-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[inset]:pl-8 data-[variant=destructive]:text-destructive data-[variant=destructive]:data-[highlighted]:bg-destructive/10 data-[variant=destructive]:data-[highlighted]:text-destructive [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4";

export function DropdownMenuItem({
  className,
  inset,
  variant = "default",
  ...props
}: Menu.Item.Props & { inset?: boolean; variant?: "default" | "destructive" }) {
  return (
    <Menu.Item
      data-slot="dropdown-menu-item"
      data-inset={inset}
      data-variant={variant}
      className={withBaseClass(itemClass, className)}
      {...props}
    />
  );
}
export function DropdownMenuCheckboxItem({
  className,
  children,
  ...props
}: Menu.CheckboxItem.Props) {
  return (
    <Menu.CheckboxItem
      data-slot="dropdown-menu-checkbox-item"
      className={withBaseClass(cn(itemClass, "pl-8"), className)}
      {...props}
    >
      <Menu.CheckboxItemIndicator className="absolute left-2">
        <Check className="size-4" />
      </Menu.CheckboxItemIndicator>
      {children}
    </Menu.CheckboxItem>
  );
}
export function DropdownMenuRadioItem({
  className,
  children,
  ...props
}: Menu.RadioItem.Props) {
  return (
    <Menu.RadioItem
      data-slot="dropdown-menu-radio-item"
      className={withBaseClass(cn(itemClass, "pl-8"), className)}
      {...props}
    >
      <Menu.RadioItemIndicator className="absolute left-2">
        <Circle className="size-2 fill-current" />
      </Menu.RadioItemIndicator>
      {children}
    </Menu.RadioItem>
  );
}
export function DropdownMenuLabel({
  className,
  inset,
  ...props
}: Menu.GroupLabel.Props & { inset?: boolean }) {
  return (
    <Menu.GroupLabel
      data-slot="dropdown-menu-label"
      data-inset={inset}
      className={withBaseClass(
        "px-2 py-2 text-sm font-medium data-[inset]:pl-8",
        className,
      )}
      {...props}
    />
  );
}
export function DropdownMenuSeparator({
  className,
  ...props
}: Menu.Separator.Props) {
  return (
    <Menu.Separator
      data-slot="dropdown-menu-separator"
      className={withBaseClass("-mx-1 my-1 h-px bg-border-subtle", className)}
      {...props}
    />
  );
}
export function DropdownMenuShortcut({
  className,
  ...props
}: ComponentProps<"span">) {
  return (
    <span
      data-slot="dropdown-menu-shortcut"
      className={cn("ml-auto text-xs tracking-widest text-muted", className)}
      {...props}
    />
  );
}
export function DropdownMenuSubTrigger({
  className,
  children,
  inset,
  ...props
}: Menu.SubmenuTrigger.Props & { inset?: boolean }) {
  return (
    <Menu.SubmenuTrigger
      data-slot="dropdown-menu-sub-trigger"
      data-inset={inset}
      className={withBaseClass(
        cn(itemClass, "data-[open]:bg-surface-hover"),
        className,
      )}
      {...props}
    >
      {children}
      <ChevronRight className="ml-auto size-4" />
    </Menu.SubmenuTrigger>
  );
}
export function DropdownMenuSubContent(props: ContentProps) {
  return <DropdownMenuContent side="right" align="start" {...props} />;
}
