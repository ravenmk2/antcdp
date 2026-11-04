import * as React from "react";
import { cn } from "@/lib/utils";

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex field-sizing-content min-h-24 w-full rounded-md border border-control-border bg-card px-3 py-2 text-base transition-[border-color] placeholder:text-muted-foreground focus-visible:border-field-focus disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:focus-visible:border-destructive md:text-sm",
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
