import type { ComponentProps, ReactNode } from "react";
import { Field } from "./field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "./native-select";
type Control = {
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  value: string;
  onValue: (value: string) => void;
};
export function TextControl({
  label,
  hint,
  error,
  onValue,
  required,
  ...input
}: Control & Omit<ComponentProps<"input">, "onChange" | "value">) {
  return (
    <Field label={label} hint={hint} error={error} required={required}>
      {(props) => (
        <Input
          {...input}
          {...props}
          onChange={(e) => onValue(e.target.value)}
        />
      )}
    </Field>
  );
}
export function AreaControl({
  label,
  hint,
  error,
  onValue,
  required,
  ...input
}: Control & Omit<ComponentProps<"textarea">, "onChange" | "value">) {
  return (
    <Field label={label} hint={hint} error={error} required={required}>
      {(props) => (
        <Textarea
          {...input}
          {...props}
          onChange={(e) => onValue(e.target.value)}
        />
      )}
    </Field>
  );
}
export function ChoiceControl({
  label,
  hint,
  error,
  required,
  value,
  onValue,
  options,
  disabled,
}: Control & {
  options: readonly (readonly [string, string])[];
  disabled?: boolean;
}) {
  return (
    <Field label={label} hint={hint} error={error} required={required}>
      {(p) => (
        <NativeSelect
          {...p}
          disabled={disabled}
          value={value}
          onChange={(e) => onValue(e.target.value)}
        >
          {options.map(([v, name]) => (
            <option key={v} value={v}>
              {name}
            </option>
          ))}
        </NativeSelect>
      )}
    </Field>
  );
}
export function ValuesGrid({
  items,
}: {
  items: readonly (readonly [string, ReactNode])[];
}) {
  return (
    <dl className="grid gap-x-6 gap-y-4 text-sm sm:grid-cols-2">
      {items.map(([label, value]) => (
        <div key={label} className="min-w-0">
          <dt className="mb-1 text-[13px] text-muted-foreground">{label}</dt>
          <dd className="break-words">{value ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}
