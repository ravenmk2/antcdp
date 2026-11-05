import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Slot } from "radix-ui";
import { LoaderCircle } from "lucide-react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "border border-primary bg-primary text-primary-foreground shadow-sm hover:bg-[var(--accent-hover)]",
        outline:
          "border border-border-strong bg-surface text-text-soft shadow-sm hover:border-[var(--accent)] hover:bg-surface-hover hover:text-foreground",
        secondary:
          "border border-transparent bg-secondary text-secondary-foreground hover:bg-surface-hover",
        ghost:
          "border border-transparent bg-transparent text-muted hover:bg-surface-hover hover:text-foreground",
        danger: "border border-danger bg-danger text-white hover:brightness-95",
        dangerSoft:
          "border border-danger/30 bg-danger-soft text-danger hover:border-danger",
        link: "h-auto min-h-0 rounded-none p-0 text-primary hover:underline",
      },
      size: {
        default: "min-h-[38px] px-3.5 py-2",
        sm: "min-h-8 rounded-md px-3 py-1.5 text-xs",
        lg: "min-h-11 px-5",
        icon: "size-9 p-0",
        iconSm: "size-8 rounded-md p-0",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export interface ButtonProps
  extends
    ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  pending?: boolean;
  children?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    {
      className,
      variant,
      size,
      asChild = false,
      pending = false,
      disabled,
      children,
      type,
      ...props
    },
    ref,
  ) {
    const Component = asChild ? Slot.Root : "button";
    return (
      <Component
        ref={ref}
        data-slot="button"
        className={cn(buttonVariants({ variant, size }), className)}
        disabled={disabled || pending}
        aria-busy={pending || undefined}
        type={asChild ? undefined : (type ?? "button")}
        {...props}
      >
        {asChild ? (
          children
        ) : (
          <>
            {pending && <LoaderCircle className="animate-spin" aria-hidden />}
            {children}
          </>
        )}
      </Component>
    );
  },
);

export function IconButton({
  label,
  children,
  ...props
}: ButtonProps & { label: string }) {
  return (
    <Button
      size="icon"
      variant="ghost"
      aria-label={label}
      title={label}
      {...props}
    >
      {children}
    </Button>
  );
}

export { buttonVariants };
