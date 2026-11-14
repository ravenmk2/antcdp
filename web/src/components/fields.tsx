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
import {
  SelectContent,
  SelectItem,
  Select as SelectRoot,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { NumberField } from "@base-ui/react/number-field";
import { ChevronDown, ChevronUp, Eye, EyeOff } from "lucide-react";
import {
  Children,
  createContext,
  isValidElement,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ComponentProps,
  type TextareaHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
} from "react";
import { useFilterReset } from "./table-toolbar";

interface FieldContextValue {
  id: string;
  label: string;
  descriptionId?: string;
  invalid: boolean;
  required: boolean;
  hint?: ReactNode;
  error?: ReactNode;
}
const FieldContext = createContext<FieldContextValue | null>(null);

type FieldProps = Omit<ComponentProps<"div">, "children"> & {
  label: string;
  hint?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  children: ReactNode;
};

export function FieldRoot({
  label,
  hint,
  error,
  required,
  children,
  id: suppliedId,
  ...props
}: FieldProps) {
  const generatedId = useId();
  const id = suppliedId ?? generatedId;
  const descriptionId = hint || error ? `${id}-description` : undefined;
  return (
    <FieldContext
      value={{
        id,
        label,
        hint,
        error,
        descriptionId,
        invalid: Boolean(error),
        required: Boolean(required),
      }}
    >
      <div {...props}>{children}</div>
    </FieldContext>
  );
}

function useField() {
  const field = useContext(FieldContext);
  if (!field) throw new Error("Field or FieldRoot is required");
  return field;
}

export function FieldLabel({
  className,
  children,
  ...props
}: ComponentProps<"label">) {
  const field = useField();
  return (
    <label
      htmlFor={field.id}
      className={cn("text-xs font-medium text-text-soft", className)}
      {...props}
    >
      {children ?? field.label}
      {field.required && (
        <span className="ml-1 text-danger" aria-hidden>
          *
        </span>
      )}
    </label>
  );
}

export function FieldDescription({
  className,
  children,
  ...props
}: ComponentProps<"p">) {
  const field = useField();
  if (!field.descriptionId) return null;
  return (
    <p
      id={field.descriptionId}
      role={field.invalid ? "alert" : undefined}
      className={cn(
        "text-[11px] leading-5",
        field.invalid ? "text-danger" : "text-muted",
        className,
      )}
      {...props}
    >
      {children ?? (field.error || field.hint)}
    </p>
  );
}

export function Field({ children, className, ...props }: FieldProps) {
  return (
    <FieldRoot
      className={cn("grid content-start gap-1.5", className)}
      {...props}
    >
      <FieldLabel />
      {children}
      <FieldDescription />
    </FieldRoot>
  );
}

export function useFieldProps() {
  const field = useContext(FieldContext);
  if (!field) throw new Error("Field is required");
  return {
    id: field.id,
    "aria-describedby": field.descriptionId,
    "aria-invalid": field.invalid || undefined,
    "aria-required": field.required || undefined,
  };
}

const controlClass =
  "min-h-10 w-full rounded-(--control-radius) border border-border-strong bg-surface px-3 py-2 text-sm text-foreground placeholder:text-muted disabled:cursor-not-allowed disabled:bg-surface-subtle disabled:opacity-60 read-only:bg-surface-subtle";

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
        className="absolute inset-y-1 right-1 flex w-8 items-center justify-center rounded-(--compact-control-radius) text-muted hover:bg-surface-hover hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
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
  triggerProps,
  contentProps,
}: {
  name: string;
  value: string;
  onValueChange: (value: string) => void;
  options: { value: string; label: string }[];
  disabled?: boolean;
  triggerProps?: ComponentProps<typeof SelectTrigger>;
  contentProps?: ComponentProps<typeof SelectContent>;
}) {
  const field = useFieldProps();
  return (
    <SelectRoot
      name={name}
      value={value}
      items={options}
      onValueChange={(next) => {
        if (next !== null) onValueChange(next);
      }}
      disabled={disabled}
    >
      <SelectTrigger
        {...field}
        className={cn(
          controlClass,
          "flex h-10 w-full items-center justify-between gap-3 text-left data-[size=default]:h-10",
        )}
        {...triggerProps}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent sideOffset={5} className="max-h-80" {...contentProps}>
        {options.map((option) => (
          <SelectItem
            key={option.value}
            value={option.value}
            className="min-h-9 py-2 pl-3"
          >
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </SelectRoot>
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
  triggerProps,
  contentProps,
}: {
  name: string;
  value: string;
  onValueChange: (value: string) => void;
  options: string[];
  searchLabel: string;
  emptyLabel?: string;
  disabled?: boolean;
  triggerProps?: ComponentProps<typeof ComboboxTrigger>;
  contentProps?: ComponentProps<typeof ComboboxContent>;
}) {
  const field = useFieldProps();
  const [search, setSearch] = useState("");
  const hidden = useRef<HTMLInputElement>(null);
  return (
    <Combobox
      items={options}
      value={value}
      onValueChange={(next) => {
        if (next !== null) {
          onValueChange(next);
          hidden.current?.dispatchEvent(new Event("input", { bubbles: true }));
        }
      }}
      inputValue={search}
      onInputValueChange={setSearch}
      onOpenChange={() => setSearch("")}
      disabled={disabled}
      autoHighlight
    >
      <input
        ref={hidden}
        type="hidden"
        name={name}
        value={value}
        disabled={disabled}
      />
      <ComboboxTrigger {...field} name={name} {...triggerProps}>
        <ComboboxValue />
      </ComboboxTrigger>
      <ComboboxContent {...contentProps}>
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

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
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
  "aria-required": ariaRequired,
  ...props
}: ChoiceProps) {
  const [internal, setInternal] = useState(String(defaultValue ?? ""));
  const hidden = useRef<HTMLInputElement>(null);
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
      items={options.map((option) => ({
        value:
          String(option.props.value ?? option.props.children ?? "") || empty,
        label: option.props.children,
      }))}
      disabled={disabled}
      onValueChange={(next) => {
        const result = next === empty || next === null ? "" : next;
        setInternal(result);
        onValueChange?.(result);
        hidden.current?.dispatchEvent(new Event("input", { bubbles: true }));
      }}
    >
      {name && (
        <input
          ref={hidden}
          type="hidden"
          name={name}
          value={selected}
          disabled={disabled}
        />
      )}
      <SelectTrigger
        {...props}
        data-field-name={name}
        aria-required={required || ariaRequired || undefined}
        disabled={disabled}
        className={cn(
          controlClass,
          "h-10 w-full min-w-0 data-[size=default]:h-10",
          className,
        )}
      >
        <SelectValue placeholder="请选择" />
      </SelectTrigger>
      <SelectContent
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
