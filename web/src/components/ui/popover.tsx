import { usePortalContainer } from "@/components/platform/surface-context";
// Adapted from shadcn/ui; see popover.LICENSE.
import { Popover as Primitive } from "@base-ui/react/popover";
import { withBaseClass } from "./class-name";

export const Popover = Primitive.Root;
export const PopoverTrigger = Primitive.Trigger;
export const PopoverClose = Primitive.Close;

export function PopoverContent({
  className,
  align = "center",
  side = "bottom",
  sideOffset = 4,
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
          data-slot="popover-content"
          className={withBaseClass(
            "w-72 rounded-md border bg-surface p-4 text-foreground shadow-(--floating-shadow) outline-none origin-(--transform-origin) transition-[opacity,transform] duration-150 data-[starting-style]:scale-95 data-[starting-style]:opacity-0 data-[ending-style]:scale-95 data-[ending-style]:opacity-0",
            className,
          )}
          {...props}
        />
      </Primitive.Positioner>
    </Primitive.Portal>
  );
}
