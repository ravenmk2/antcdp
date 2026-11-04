import { useId, type ReactNode } from "react";
export function Field({
  label,
  error,
  hint,
  required,
  children,
}: {
  label: string;
  error?: string;
  hint?: string;
  required?: boolean;
  children: (props: {
    id: string;
    "aria-describedby"?: string;
    "aria-invalid": boolean;
    required?: boolean;
  }) => ReactNode;
}) {
  const id = useId();
  return (
    <div className="min-w-0 space-y-2">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
        {required && (
          <span aria-hidden="true" className="ml-1 text-destructive">
            *
          </span>
        )}
      </label>
      {children({
        id,
        "aria-describedby": error || hint ? `${id}-help` : undefined,
        "aria-invalid": !!error,
        required,
      })}
      {(error || hint) && (
        <p
          id={`${id}-help`}
          className={`text-[13px] leading-relaxed ${error ? "text-destructive" : "text-muted-foreground"}`}
          role={error ? "alert" : undefined}
        >
          {error || hint}
        </p>
      )}
    </div>
  );
}
