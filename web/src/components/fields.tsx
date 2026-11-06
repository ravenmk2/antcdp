import {
  createContext,
  Children,
  isValidElement,
  useEffect,
  useContext,
  useId,
  useState,
  type InputHTMLAttributes,
  type ReactNode,
  type ComponentProps,
  type TextareaHTMLAttributes,
} from "react";
import { Select as SelectPrimitive } from "radix-ui";
import { NumberField } from "@base-ui/react/number-field";
import { Check, ChevronDown, ChevronUp, Eye, EyeOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { useFilterReset } from "./table-toolbar";
import {
  Select as SelectRoot,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
  ComboboxValue,
} from "@/components/ui/combobox";

interface FieldContextValue {
  id: string;
  label: string;
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
    <FieldContext value={{ id, label, descriptionId, invalid: Boolean(error) }}>
      <div className={cn("grid content-start gap-1.5", className)}>
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

export function useFieldProps() {
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
  const field = useFieldProps();
  const context = useContext(FieldContext);
  if (props.type === "password") {
    return (
      <PasswordControl
        {...field}
        {...props}
        label={context?.label ?? "密码"}
        className={cn(controlClass, "h-10", className)}
      />
    );
  }
  return (
    <input
      className={cn(controlClass, "h-10", className)}
      {...field}
      {...props}
    />
  );
}

function PasswordControl({
  label,
  className,
  disabled,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  const [visible, setVisible] = useState(false);
  const inputId = useId();
  const id = props.id ?? inputId;
  const action = `${visible ? "隐藏" : "显示"}${label}`;
  return (
    <div
      className="relative min-w-0"
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null))
          setVisible(false);
      }}
    >
      <input
        {...props}
        id={id}
        disabled={disabled}
        type={visible ? "text" : "password"}
        className={cn(className, "password-input pr-11")}
      />
      <button
        type="button"
        disabled={disabled}
        aria-label={action}
        aria-controls={id}
        title={action}
        className="absolute inset-y-1 right-1 flex w-8 items-center justify-center rounded-md text-muted hover:bg-surface-hover hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => setVisible((current) => !current)}
      >
        {visible ? (
          <EyeOff className="size-4" aria-hidden />
        ) : (
          <Eye className="size-4" aria-hidden />
        )}
      </button>
    </div>
  );
}

export function NumberInput({
  name,
  value,
  onValueChange,
  label,
  min,
  max,
  disabled,
}: {
  name: string;
  value: string;
  onValueChange: (value: string) => void;
  label: string;
  min: number;
  max: number;
  disabled?: boolean;
}) {
  const field = useFieldProps();
  return (
    <NumberField.Root
      id={field.id}
      value={value === "" ? null : Number(value)}
      onValueChange={(next) => onValueChange(next === null ? "" : String(next))}
      min={min}
      max={max}
      step={1}
      smallStep={1}
      allowOutOfRange
      format={{ useGrouping: false, maximumFractionDigits: 0 }}
      disabled={disabled}
    >
      <NumberField.Group className="relative">
        <NumberField.Input
          {...field}
          name={name}
          inputMode="numeric"
          className={cn(controlClass, "h-10 pr-10")}
        />
        <div className="absolute inset-y-1 right-1 grid w-7 grid-rows-2">
          <NumberField.Increment
            className="number-step"
            aria-label={`增加${label}`}
          >
            <ChevronUp className="size-3" aria-hidden />
          </NumberField.Increment>
          <NumberField.Decrement
            className="number-step"
            aria-label={`减少${label}`}
          >
            <ChevronDown className="size-3" aria-hidden />
          </NumberField.Decrement>
        </div>
      </NumberField.Group>
    </NumberField.Root>
  );
}

export function PopupSelect({
  name,
  value,
  onValueChange,
  options,
  disabled,
}: {
  name: string;
  value: string;
  onValueChange: (value: string) => void;
  options: { value: string; label: string }[];
  disabled?: boolean;
}) {
  const field = useFieldProps();
  return (
    <SelectPrimitive.Root
      value={value}
      onValueChange={onValueChange}
      disabled={disabled}
    >
      <SelectPrimitive.Trigger
        {...field}
        name={name}
        className={cn(
          controlClass,
          "flex h-10 items-center justify-between gap-3 text-left",
        )}
      >
        <SelectPrimitive.Value />
        <SelectPrimitive.Icon asChild>
          <ChevronDown
            className="size-3.5 shrink-0 text-muted/70"
            aria-hidden
          />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          position="popper"
          sideOffset={5}
          className="setup-select-content"
        >
          <SelectPrimitive.ScrollUpButton className="flex h-6 items-center justify-center text-muted">
            <ChevronUp className="size-3.5" aria-hidden />
          </SelectPrimitive.ScrollUpButton>
          <SelectPrimitive.Viewport className="p-1">
            {options.map((option) => (
              <SelectPrimitive.Item
                key={option.value}
                value={option.value}
                className="relative flex min-h-9 cursor-default items-center rounded-md py-2 pr-8 pl-3 text-sm outline-none select-none data-[highlighted]:bg-surface-hover data-[highlighted]:text-foreground"
              >
                <SelectPrimitive.ItemText>
                  {option.label}
                </SelectPrimitive.ItemText>
                <SelectPrimitive.ItemIndicator className="absolute right-2 text-primary">
                  <Check className="size-3.5" aria-hidden />
                </SelectPrimitive.ItemIndicator>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
          <SelectPrimitive.ScrollDownButton className="flex h-6 items-center justify-center text-muted">
            <ChevronDown className="size-3.5" aria-hidden />
          </SelectPrimitive.ScrollDownButton>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}

export function SearchableSelect({
  name,
  value,
  onValueChange,
  options,
  searchLabel,
  emptyLabel = "没有匹配选项",
  disabled,
}: {
  name: string;
  value: string;
  onValueChange: (value: string) => void;
  options: string[];
  searchLabel: string;
  emptyLabel?: string;
  disabled?: boolean;
}) {
  const field = useFieldProps();
  const [search, setSearch] = useState("");
  return (
    <Combobox
      items={options}
      value={value}
      onValueChange={(next) => {
        if (next !== null) onValueChange(next);
      }}
      inputValue={search}
      onInputValueChange={setSearch}
      onOpenChange={() => setSearch("")}
      disabled={disabled}
      autoHighlight
    >
      <ComboboxTrigger {...field} name={name}>
        <ComboboxValue />
      </ComboboxTrigger>
      <ComboboxContent>
        <ComboboxInput aria-label={searchLabel} placeholder={searchLabel} />
        <ComboboxEmpty role="status">{emptyLabel}</ComboboxEmpty>
        <ComboboxList>
          {(option: string) => (
            <ComboboxItem key={option} value={option}>
              {option}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
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

export function Select({ ...props }: ChoiceProps) {
  return <Choice {...useFieldProps()} {...props} />;
}

export function StandaloneInput({
  className,
  defaultValue,
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  const [draft, setDraft] = useState(defaultValue ?? "");
  const reset = useFilterReset();
  useEffect(() => setDraft(defaultValue ?? ""), [defaultValue, reset]);
  if (props.type === "password")
    return (
      <PasswordControl
        {...props}
        defaultValue={defaultValue}
        label={props["aria-label"] ?? "密码"}
        className={cn(controlClass, className)}
      />
    );
  return (
    <input
      className={cn(controlClass, reset !== null && "w-60 shrink-0", className)}
      {...props}
      {...(defaultValue !== undefined && props.value === undefined
        ? {
            value: draft,
            onChange: (event: React.ChangeEvent<HTMLInputElement>) => {
              setDraft(event.target.value);
              props.onChange?.(event);
            },
          }
        : {})}
    />
  );
}

type ChoiceProps = Omit<
  ComponentProps<typeof SelectTrigger>,
  "onChange" | "defaultValue" | "value" | "name"
> & {
  value?: string | number;
  defaultValue?: string | number;
  onValueChange?: (value: string) => void;
  name?: string;
  required?: boolean;
};

// Keep declarative option content while rendering every visible choice through shadcn/ui.
function Choice({
  className,
  children,
  value,
  defaultValue,
  onValueChange,
  name,
  required,
  disabled,
  ...props
}: ChoiceProps) {
  const [internal, setInternal] = useState(String(defaultValue ?? ""));
  useEffect(() => setInternal(String(defaultValue ?? "")), [defaultValue]);
  const options = Children.toArray(children).filter(
    isValidElement<{
      value?: string | number;
      children?: ReactNode;
      disabled?: boolean;
    }>,
  );
  const empty = "__antcdp_empty_choice__";
  const selected = String(value ?? internal);
  return (
    <SelectRoot
      value={selected || empty}
      disabled={disabled}
      onValueChange={(next) => {
        const result = next === empty ? "" : next;
        setInternal(result);
        onValueChange?.(result);
      }}
    >
      {name && (
        <input type="hidden" name={name} value={selected} disabled={disabled} />
      )}
      <SelectTrigger
        {...props}
        data-field-name={name}
        aria-required={required || undefined}
        disabled={disabled}
        className={cn(
          controlClass,
          "h-10 w-full min-w-0 shadow-none data-[size=default]:h-10",
          className,
        )}
      >
        <SelectValue placeholder="请选择" />
      </SelectTrigger>
      <SelectContent
        position="popper"
        align="start"
        className="z-[80] max-h-72 max-w-[min(36rem,calc(100vw-32px))]"
      >
        {options.map((option, index) => {
          const optionValue = String(
            option.props.value ?? option.props.children ?? "",
          );
          return (
            <SelectItem
              key={`${optionValue}-${index}`}
              value={optionValue || empty}
              disabled={option.props.disabled}
              className="min-h-9 whitespace-normal break-words"
            >
              {option.props.children}
            </SelectItem>
          );
        })}
      </SelectContent>
    </SelectRoot>
  );
}

export function StandaloneSelect({ className, ...props }: ChoiceProps) {
  return <Choice className={cn("w-40 shrink-0", className)} {...props} />;
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
