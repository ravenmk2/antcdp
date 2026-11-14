import { usePortalContainer } from "@/components/platform/surface-context";
// Adapted from shadcn/ui; see tooltip.LICENSE.
import { Tooltip as Primitive } from "@base-ui/react/tooltip";
import { withBaseClass } from "./class-name";
import { createContext, useContext, useId, useState } from "react";

const TooltipDescription = createContext<{ id: string; open: boolean } | null>(
  null,
);

export function Tooltip({
  open,
  defaultOpen = false,
  onOpenChange,
  ...props
}: Primitive.Root.Props) {
  const id = useId();
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  return (
    <TooltipDescription value={{ id, open: open ?? internalOpen }}>
      <Primitive.Root
        {...props}
        open={open ?? internalOpen}
        onOpenChange={(next, details) => {
          onOpenChange?.(next, details);
          if (!details.isCanceled) setInternalOpen(next);
        }}
      />
    </TooltipDescription>
  );
}

export function TooltipTrigger({
  "aria-describedby": describedBy,
  ...props
}: Primitive.Trigger.Props) {
  const description = useContext(TooltipDescription);
  return (
    <Primitive.Trigger
      {...props}
      aria-describedby={
        [describedBy, description?.open && description.id]
          .filter(Boolean)
          .join(" ") || undefined
      }
    />
  );
}
export const TooltipProvider = Primitive.Provider;

export function TooltipContent({
  className,
  align = "center",
  side = "bottom",
  sideOffset = 6,
  alignOffset,
  collisionPadding = 8,
  positionerProps,
  ...props
}: Primitive.Popup.Props &
  Pick<
    Primitive.Positioner.Props,
    "align" | "side" | "sideOffset" | "alignOffset" | "collisionPadding"
  > & { positionerProps?: Primitive.Positioner.Props }) {
  const portalContainer = usePortalContainer();
  const description = useContext(TooltipDescription);
  return (
    <Primitive.Portal container={portalContainer}>
      <Primitive.Positioner
        className="z-[80]"
        align={align}
        side={side}
        sideOffset={sideOffset}
        alignOffset={alignOffset}
        collisionPadding={collisionPadding}
        {...positionerProps}
      >
        <Primitive.Popup
          id={description?.id}
          role="tooltip"
          data-slot="tooltip-content"
          className={withBaseClass(
            "w-fit rounded-md border bg-surface px-3 py-2 text-xs text-foreground shadow-(--floating-shadow) origin-(--transform-origin) transition-[opacity,transform] duration-150 data-[starting-style]:scale-95 data-[starting-style]:opacity-0 data-[ending-style]:scale-95 data-[ending-style]:opacity-0",
            className,
          )}
          {...props}
        />
      </Primitive.Positioner>
    </Primitive.Portal>
  );
}
