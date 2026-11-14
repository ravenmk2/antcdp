import { Select as Primitive } from "@base-ui/react/select";
import { usePortalContainer } from "@/components/platform/surface-context";
// Adapted from shadcn/ui; see select.LICENSE.
import { Check, ChevronDown, ChevronUp } from "lucide-react";
import { withBaseClass } from "./class-name";

export const Select = Primitive.Root;
export const SelectGroup = Primitive.Group;
export const SelectValue = Primitive.Value;

export function SelectTrigger({
  className,
  size = "default",
  children,
  ...props
}: Primitive.Trigger.Props & { size?: "sm" | "default" }) {
  return (
    <Primitive.Trigger
      data-slot="select-trigger"
      data-size={size}
      className={withBaseClass(
        "flex w-fit items-center justify-between gap-2 rounded-(--control-radius) border border-input bg-surface px-3 py-2 text-sm whitespace-nowrap transition-colors enabled:hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:bg-surface-subtle disabled:opacity-50 aria-invalid:border-danger data-[placeholder]:text-muted data-[size=default]:h-9 data-[size=sm]:h-8 data-[size=sm]:rounded-(--compact-control-radius) [&_svg]:pointer-events-none [&_svg]:shrink-0",
        className,
      )}
      {...props}
    >
      {children}
      <Primitive.Icon render={<ChevronDown className="size-4 opacity-50" />} />
    </Primitive.Trigger>
  );
}
export function SelectContent({
  className,
  children,
  align = "start",
  side = "bottom",
  sideOffset = 4,
  alignOffset,
  collisionPadding = 8,
  alignItemWithTrigger = false,
  positionerProps,
  listProps,
  ...props
}: Primitive.Popup.Props &
  Pick<
    Primitive.Positioner.Props,
    | "align"
    | "side"
    | "sideOffset"
    | "alignOffset"
    | "collisionPadding"
    | "alignItemWithTrigger"
  > & {
    positionerProps?: Primitive.Positioner.Props;
    listProps?: Primitive.List.Props;
  }) {
  const container = usePortalContainer();
  return (
    <Primitive.Portal container={container}>
      <Primitive.Positioner
        className="z-[80]"
        align={align}
        side={side}
        sideOffset={sideOffset}
        alignOffset={alignOffset}
        collisionPadding={collisionPadding}
        alignItemWithTrigger={alignItemWithTrigger}
        {...positionerProps}
      >
        <Primitive.Popup
          data-slot="select-content"
          className={withBaseClass(
            "max-h-(--available-height) min-w-(--anchor-width) origin-(--transform-origin) overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-(--floating-shadow) outline-none transition-[opacity,transform] duration-150 data-[starting-style]:scale-95 data-[starting-style]:opacity-0 data-[ending-style]:scale-95 data-[ending-style]:opacity-0",
            className,
          )}
          {...props}
        >
          <SelectScrollUpButton />
          <Primitive.List
            {...listProps}
            className={withBaseClass(
              "max-h-[inherit] overflow-y-auto p-1",
              listProps?.className,
            )}
          >
            {children}
          </Primitive.List>
          <SelectScrollDownButton />
        </Primitive.Popup>
      </Primitive.Positioner>
    </Primitive.Portal>
  );
}
export function SelectItem({
  className,
  children,
  ...props
}: Primitive.Item.Props) {
  return (
    <Primitive.Item
      data-slot="select-item"
      className={withBaseClass(
        "relative flex w-full cursor-default items-center gap-2 rounded-sm py-1.5 pr-8 pl-2 text-sm outline-none select-none data-[highlighted]:bg-surface-hover data-[highlighted]:text-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        className,
      )}
      {...props}
    >
      <Primitive.ItemText>{children}</Primitive.ItemText>
      <Primitive.ItemIndicator className="absolute right-2 flex size-4 items-center justify-center">
        <Check className="size-4" />
      </Primitive.ItemIndicator>
    </Primitive.Item>
  );
}
export function SelectLabel({
  className,
  ...props
}: Primitive.GroupLabel.Props) {
  return (
    <Primitive.GroupLabel
      className={withBaseClass("px-2 py-1.5 text-xs text-muted", className)}
      {...props}
    />
  );
}
export function SelectSeparator({
  className,
  ...props
}: Primitive.Separator.Props) {
  return (
    <Primitive.Separator
      className={withBaseClass(
        "pointer-events-none -mx-1 my-1 h-px bg-border-subtle",
        className,
      )}
      {...props}
    />
  );
}
export function SelectScrollUpButton({
  className,
  ...props
}: Primitive.ScrollUpArrow.Props) {
  return (
    <Primitive.ScrollUpArrow
      className={withBaseClass(
        "flex cursor-default items-center justify-center py-1",
        className,
      )}
      {...props}
    >
      <ChevronUp className="size-4" />
    </Primitive.ScrollUpArrow>
  );
}
export function SelectScrollDownButton({
  className,
  ...props
}: Primitive.ScrollDownArrow.Props) {
  return (
    <Primitive.ScrollDownArrow
      className={withBaseClass(
        "flex cursor-default items-center justify-center py-1",
        className,
      )}
      {...props}
    >
      <ChevronDown className="size-4" />
    </Primitive.ScrollDownArrow>
  );
}
