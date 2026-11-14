import type { ComponentProps } from "react";
import { Switch as SwitchPrimitive } from "@base-ui/react/switch";
import { withBaseClass } from "./class-name";

function Switch({
  className,
  ...props
}: ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={withBaseClass(
        "inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border border-transparent bg-border-strong shadow-xs transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50 data-[checked]:bg-primary forced-colors:border-[ButtonText] forced-colors:bg-[ButtonFace] data-[checked]:forced-colors:bg-[Highlight]",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="pointer-events-none block size-4 rounded-full bg-surface shadow-sm transition-transform duration-150 data-[checked]:translate-x-4 data-[unchecked]:translate-x-0 forced-colors:bg-[ButtonText]"
      />
    </SwitchPrimitive.Root>
  );
}

export { Switch };
