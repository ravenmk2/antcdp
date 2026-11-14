"use client";
import { usePortalContainer } from "@/components/platform/surface-context";
// Adapted from shadcn/ui; see sheet.LICENSE.

import { cn } from "@/lib/utils";
import { withBaseClass } from "./class-name";
import { XIcon } from "lucide-react";
import { Dialog as SheetPrimitive } from "@base-ui/react/dialog";
import * as React from "react";

function Sheet({ ...props }: React.ComponentProps<typeof SheetPrimitive.Root>) {
  return <SheetPrimitive.Root data-slot="sheet" {...props} />;
}

function SheetTrigger({
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Trigger>) {
  return <SheetPrimitive.Trigger data-slot="sheet-trigger" {...props} />;
}

function SheetClose({
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Close>) {
  return <SheetPrimitive.Close data-slot="sheet-close" {...props} />;
}

function SheetPortal({
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Portal>) {
  const portalContainer = usePortalContainer();
  return (
    <SheetPrimitive.Portal
      container={portalContainer}
      data-slot="sheet-portal"
      {...props}
    />
  );
}

function SheetOverlay({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Backdrop>) {
  return (
    <SheetPrimitive.Backdrop
      data-slot="sheet-overlay"
      className={withBaseClass(
        "overlay-backdrop fixed inset-0 z-50 bg-[#09101a]/50 backdrop-blur-[2px]",
        className,
      )}
      {...props}
    />
  );
}

function SheetContent({
  className,
  children,
  side = "right",
  showCloseButton = true,
  backdropProps,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Popup> & {
  side?: "top" | "right" | "bottom" | "left";
  showCloseButton?: boolean;
  backdropProps?: React.ComponentProps<typeof SheetPrimitive.Backdrop>;
}) {
  const portalContainer = usePortalContainer();
  return (
    <SheetPortal container={portalContainer}>
      <SheetOverlay {...backdropProps} />
      <SheetPrimitive.Popup
        data-slot="sheet-content"
        data-side={side}
        className={withBaseClass(
          cn(
            "overlay-panel sheet-motion fixed z-50 flex flex-col gap-4 bg-background shadow-(--floating-shadow)",
            side === "right" &&
              "inset-y-0 right-0 h-full w-3/4 max-w-sm border-l",
            side === "left" &&
              "inset-y-0 left-0 h-full w-3/4 max-w-sm border-r",
            side === "top" && "inset-x-0 top-0 h-auto border-b",
            side === "bottom" && "inset-x-0 bottom-0 h-auto border-t",
          ),
          className,
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <SheetPrimitive.Close className="absolute top-4 right-4 rounded-xs opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:outline-hidden disabled:pointer-events-none data-[open]:bg-secondary">
            <XIcon className="size-4" />
            <span className="sr-only">Close</span>
          </SheetPrimitive.Close>
        )}
      </SheetPrimitive.Popup>
    </SheetPortal>
  );
}

function SheetHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-header"
      className={cn("flex flex-col gap-1.5 p-4", className)}
      {...props}
    />
  );
}

function SheetFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-footer"
      className={cn("mt-auto flex flex-col gap-2 p-4", className)}
      {...props}
    />
  );
}

function SheetTitle({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Title>) {
  return (
    <SheetPrimitive.Title
      data-slot="sheet-title"
      className={withBaseClass("font-semibold text-foreground", className)}
      {...props}
    />
  );
}

function SheetDescription({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Description>) {
  return (
    <SheetPrimitive.Description
      data-slot="sheet-description"
      className={withBaseClass("text-sm text-muted", className)}
      {...props}
    />
  );
}

export {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
};
