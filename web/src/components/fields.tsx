import {
  createContext,
  useContext,
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { cn } from "@/lib/utils";

interface FieldContextValue {
  id: string;
  descriptionId?: string;
  invalid: boolean;
}
const FieldContext = createContext<FieldContextValue | null>(null);

export function Field({
  label,
  hint,
  error,
  required,
  children,
  className,
}: {
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: ReactNode;
  className?: string;
}) {
  const id = useId();
  const descriptionId = hint || error ? `${id}-description` : undefined;
  return (
    <FieldContext value={{ id, descriptionId, invalid: Boolean(error) }}>
      <div className={cn("grid gap-1.5", className)}>
        <label htmlFor={id} className="text-xs font-medium text-text-soft">
          {label}
          {required && (
            <span className="ml-1 text-danger" aria-hidden>
              *
            </span>
          )}
        </label>
        {children}
        {(error || hint) && (
          <p
            id={descriptionId}
            role={error ? "alert" : undefined}
            className={cn(
              "text-[11px] leading-5",
              error ? "text-danger" : "text-muted",
            )}
          >
            {error || hint}
          </p>
        )}
      </div>
    </FieldContext>
  );
}

function useFieldProps() {
  const field = useContext(FieldContext);
  if (!field) throw new Error("Field is required");
  return {
    id: field.id,
    "aria-describedby": field.descriptionId,
    "aria-invalid": field.invalid || undefined,
  };
}

const controlClass =
  "min-h-10 w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm text-foreground placeholder:text-faint disabled:cursor-not-allowed disabled:bg-surface-subtle disabled:opacity-60 read-only:bg-surface-subtle";

export function Input({
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(controlClass, className)}
      {...useFieldProps()}
      {...props}
    />
  );
}

export function Textarea({
  className,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(controlClass, "min-h-24 resize-y leading-6", className)}
      {...useFieldProps()}
      {...props}
    />
  );
}

export function Select({
  className,
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(controlClass, "pr-8", className)}
      {...useFieldProps()}
      {...props}
    >
      {children}
    </select>
  );
}

export function StandaloneInput({
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(controlClass, className)} {...props} />;
}

export function StandaloneSelect({
  className,
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(controlClass, "w-auto min-w-32 pr-8", className)}
      {...props}
    >
      {children}
    </select>
  );
}

export function StandaloneTextarea({
  className,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(controlClass, "min-h-24 resize-y leading-6", className)}
      {...props}
    />
  );
}
