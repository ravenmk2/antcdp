// Adapted from shadcn/ui's Combobox; see combobox.LICENSE.
// https://github.com/shadcn-ui/ui/blob/main/apps/v4/registry/new-york-v4/ui/combobox.tsx
import { Combobox as ComboboxPrimitive } from "@base-ui/react/combobox";
import { Check, ChevronDown, Search } from "lucide-react";
import { cn } from "@/lib/utils";

export const Combobox = ComboboxPrimitive.Root;

export function ComboboxValue(props: ComboboxPrimitive.Value.Props) {
  return <ComboboxPrimitive.Value data-slot="combobox-value" {...props} />;
}

export function ComboboxTrigger({
  className,
  children,
  ...props
}: ComboboxPrimitive.Trigger.Props) {
  return (
    <ComboboxPrimitive.Trigger
      data-slot="combobox-trigger"
      className={cn(
        "flex h-10 w-full items-center justify-between gap-3 rounded-lg border border-border-strong bg-surface px-3 text-left text-sm text-foreground disabled:cursor-not-allowed disabled:bg-surface-subtle disabled:opacity-60",
        className,
      )}
      {...props}
    >
      {children}
      <ChevronDown
        className="pointer-events-none size-3.5 shrink-0 text-muted/70"
        aria-hidden
      />
    </ComboboxPrimitive.Trigger>
  );
}

export function ComboboxInput({
  className,
  ...props
}: ComboboxPrimitive.Input.Props) {
  return (
    <div className="relative m-1 mb-0 shrink-0">
      <Search
        className="pointer-events-none absolute top-2.5 left-3 size-4 text-muted"
        aria-hidden
      />
      <ComboboxPrimitive.Input
        data-slot="combobox-input"
        className={cn(
          "h-9 w-full rounded-md border border-border bg-surface-subtle pr-3 pl-9 text-sm text-foreground placeholder:text-muted",
          className,
        )}
        {...props}
      />
    </div>
  );
}

export function ComboboxContent({
  className,
  side = "bottom",
  sideOffset = 5,
  align = "start",
  alignOffset = 0,
  anchor,
  ...props
}: ComboboxPrimitive.Popup.Props &
  Pick<
    ComboboxPrimitive.Positioner.Props,
    "side" | "sideOffset" | "align" | "alignOffset" | "anchor"
  >) {
  return (
    <ComboboxPrimitive.Portal>
      <ComboboxPrimitive.Positioner
        side={side}
        sideOffset={sideOffset}
        align={align}
        alignOffset={alignOffset}
        anchor={anchor}
        className="isolate z-60"
      >
        <ComboboxPrimitive.Popup
          data-slot="combobox-content"
          className={cn("combobox-content", className)}
          {...props}
        />
      </ComboboxPrimitive.Positioner>
    </ComboboxPrimitive.Portal>
  );
}

export function ComboboxList({
  className,
  ...props
}: ComboboxPrimitive.List.Props) {
  return (
    <ComboboxPrimitive.List
      data-slot="combobox-list"
      className={cn(
        "min-h-0 overflow-y-auto overscroll-contain scroll-py-1 p-1 empty:p-0",
        className,
      )}
      {...props}
    />
  );
}

export function ComboboxItem({
  className,
  children,
  ...props
}: ComboboxPrimitive.Item.Props) {
  return (
    <ComboboxPrimitive.Item
      data-slot="combobox-item"
      className={cn(
        "relative flex min-h-9 w-full cursor-default items-center rounded-md py-2 pr-8 pl-3 text-sm outline-none select-none data-highlighted:bg-surface-hover data-highlighted:text-foreground data-disabled:pointer-events-none data-disabled:opacity-50",
        className,
      )}
      {...props}
    >
      {children}
      <ComboboxPrimitive.ItemIndicator
        data-slot="combobox-item-indicator"
        className="pointer-events-none absolute right-2 text-primary"
      >
        <Check className="size-3.5" aria-hidden />
      </ComboboxPrimitive.ItemIndicator>
    </ComboboxPrimitive.Item>
  );
}

export function ComboboxEmpty({
  className,
  ...props
}: ComboboxPrimitive.Empty.Props) {
  return (
    <ComboboxPrimitive.Empty
      data-slot="combobox-empty"
      className={cn(
        "py-5 text-center text-sm text-muted empty:hidden",
        className,
      )}
      {...props}
    />
  );
}
