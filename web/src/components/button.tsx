import { forwardRef, type ReactNode } from "react";
import { Button as Primitive } from "@base-ui/react/button";
import { withBaseClass } from "./ui/class-name";
import { LoaderCircle } from "lucide-react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "relative inline-flex shrink-0 items-center justify-center gap-2 rounded-(--control-radius) text-sm font-medium whitespace-nowrap transition-colors disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "border border-primary bg-primary text-primary-foreground shadow-(--control-shadow) hover:bg-[var(--accent-hover)]",
        outline:
          "border border-border-strong bg-surface text-text-soft shadow-(--control-shadow) hover:bg-surface-hover hover:text-foreground",
        secondary:
          "border border-transparent bg-secondary text-secondary-foreground hover:bg-surface-hover",
        ghost:
          "border border-transparent bg-transparent text-muted hover:bg-surface-hover hover:text-foreground",
        danger:
          "border border-danger bg-danger text-[var(--on-danger)] hover:brightness-95",
        dangerSoft:
          "border border-danger/30 bg-danger-soft text-danger hover:border-danger",
        link: "h-auto min-h-0 rounded-none p-0 text-primary hover:underline",
      },
      size: {
        default: "min-h-[38px] px-3.5 py-2",
        sm: "min-h-8 rounded-(--compact-control-radius) px-3 py-1.5 text-xs",
        lg: "min-h-11 px-5",
        icon: "size-9 p-0",
        iconSm: "size-8 rounded-(--compact-control-radius) p-0",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export interface ButtonProps
  extends Primitive.Props, VariantProps<typeof buttonVariants> {
  pending?: boolean;
  children?: ReactNode;
  contentClassName?: string;
}

export const Button = forwardRef<HTMLElement, ButtonProps>(function Button(
  {
    className,
    variant,
    size,
    render,
    nativeButton = true,
    pending = false,
    disabled,
    children,
    contentClassName,
    type,
    ...props
  },
  ref,
) {
  return (
    <Primitive
      ref={ref}
      data-slot="button"
      className={withBaseClass(buttonVariants({ variant, size }), className)}
      disabled={disabled || pending}
      aria-busy={pending || undefined}
      type={nativeButton ? (type ?? "button") : undefined}
      nativeButton={nativeButton}
      render={render}
      {...props}
    >
      {children === undefined ? undefined : (
        <>
          {pending && (
            <LoaderCircle
              className="absolute animate-spin"
              aria-hidden
              data-slot="button-pending"
            />
          )}
          <span
            data-slot="button-content"
            className={cn(
              "inline-flex items-center justify-center gap-2",
              pending && "opacity-0",
              contentClassName,
            )}
          >
            {children}
          </span>
        </>
      )}
    </Primitive>
  );
});

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
