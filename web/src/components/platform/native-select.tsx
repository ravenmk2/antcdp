import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";
export function NativeSelect({
  className,
  ...props
}: ComponentProps<"select">) {
  return (
    <select
      {...props}
      data-slot="native-select"
      className={cn(
        "h-[var(--control-height)] w-full min-w-0 rounded-md border border-control-border bg-card px-3 text-base transition-colors aria-invalid:border-destructive disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
        className,
      )}
    />
  );
}
