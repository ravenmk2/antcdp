import {
  FieldDescription,
  FieldLabel,
  FieldRoot,
  Input,
} from "@/components/fields";
import { StatusBadge } from "@/components/feedback";
import { cn } from "@/lib/utils";

export function AccountEmailField({
  value,
  onChange,
  savedEmail,
  verified = false,
  disabled,
  error,
  className,
  autoComplete = "off",
}: {
  value: string;
  onChange: (value: string) => void;
  savedEmail?: string | null;
  verified?: boolean;
  disabled?: boolean;
  error?: string;
  className?: string;
  autoComplete?: string;
}) {
  const showStatus =
    Boolean(savedEmail) &&
    value.trim().toLowerCase() === savedEmail?.toLowerCase();
  const status = verified ? "已认证" : "未认证";
  return (
    <FieldRoot
      label="邮箱"
      hint={showStatus ? `邮箱${status}` : undefined}
      error={error}
      className={cn("grid min-w-0 content-start gap-1.5", className)}
    >
      <div className="flex h-4 items-center gap-2.5">
        <FieldLabel />
        {showStatus && (
          <span aria-hidden>
            <StatusBadge
              tone={verified ? "success" : "neutral"}
              className="min-h-4 px-1.5 py-0 text-[10px] leading-4"
            >
              {status}
            </StatusBadge>
          </span>
        )}
      </div>
      <Input
        name="email"
        type="email"
        autoComplete={autoComplete}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      />
      <FieldDescription className={error ? undefined : "sr-only"} />
    </FieldRoot>
  );
}
