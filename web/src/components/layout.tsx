import type { ComponentProps, ReactNode } from "react";
import { Tabs as TabsPrimitive } from "@base-ui/react/tabs";
import { ChevronRight } from "lucide-react";
import { Link } from "react-router";
import { cn } from "@/lib/utils";

export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
  className,
  titleClassName,
  descriptionClassName,
  actionsClassName,
  children,
  ...props
}: Omit<ComponentProps<"header">, "title"> & {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  eyebrow?: ReactNode;
  titleClassName?: string;
  descriptionClassName?: string;
  actionsClassName?: string;
}) {
  return (
    <header className={cn("page-header", className)} {...props}>
      {children ?? (
        <>
          <div className="min-w-0">
            {eyebrow && (
              <div className="mb-2 text-xs font-medium text-primary">
                {eyebrow}
              </div>
            )}
            {title && (
              <h1 className={cn("page-title", titleClassName)}>{title}</h1>
            )}
            {description && (
              <div className={cn("page-description", descriptionClassName)}>
                {description}
              </div>
            )}
          </div>
          {actions && (
            <div
              className={cn(
                "flex shrink-0 flex-wrap items-center gap-2 pt-1",
                actionsClassName,
              )}
            >
              {actions}
            </div>
          )}
        </>
      )}
    </header>
  );
}

// These parts are independently composable: pages own order, spacing and surface treatment.
export function PanelRoot({
  className,
  variant = "outlined",
  ...props
}: ComponentProps<"section"> & { variant?: "outlined" | "plain" }) {
  return (
    <section
      className={cn(variant === "outlined" ? "panel" : "min-w-0", className)}
      {...props}
    />
  );
}
export function PanelHeader({ className, ...props }: ComponentProps<"header">) {
  return <header className={cn("panel-header", className)} {...props} />;
}
export function PanelTitle({ className, ...props }: ComponentProps<"h2">) {
  return <h2 className={cn("panel-title", className)} {...props} />;
}
export function PanelBody({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("panel-body", className)} {...props} />;
}
export function Panel({
  title,
  action,
  children,
  className,
  bodyClassName,
  headerClassName,
  titleClassName,
  header,
  variant = "outlined",
  ...props
}: Omit<ComponentProps<"section">, "title"> & {
  title?: ReactNode;
  action?: ReactNode;
  header?: ReactNode;
  variant?: "outlined" | "plain";
  bodyClassName?: string;
  headerClassName?: string;
  titleClassName?: string;
}) {
  return (
    <PanelRoot variant={variant} className={className} {...props}>
      {header ??
        ((title || action) && (
          <PanelHeader className={headerClassName}>
            {title && (
              <PanelTitle className={titleClassName}>{title}</PanelTitle>
            )}
            {action}
          </PanelHeader>
        ))}
      <div
        className={cn(
          (title || action || header) && "panel-body",
          bodyClassName,
        )}
      >
        {children}
      </div>
    </PanelRoot>
  );
}

export function SummaryRoot({ className, ...props }: ComponentProps<"dl">) {
  return <dl className={cn("summary-strip", className)} {...props} />;
}
export function SummaryItem({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("summary-item", className)} {...props} />;
}
export function SummaryLabel({ className, ...props }: ComponentProps<"dt">) {
  return <dt className={cn("summary-item-label", className)} {...props} />;
}
export function SummaryValue({ className, ...props }: ComponentProps<"dd">) {
  return <dd className={cn("summary-item-value", className)} {...props} />;
}
export function SummaryDetail({ className, ...props }: ComponentProps<"dd">) {
  return <dd className={cn("summary-item-detail", className)} {...props} />;
}

export function SummaryStrip({
  items,
  label,
  className,
  itemClassName,
  children,
  ...props
}: ComponentProps<"dl"> & {
  itemClassName?: string;
  items: {
    label: string;
    value: ReactNode;
    detail?: ReactNode;
    icon?: ReactNode;
    emphasized?: boolean;
  }[];
  label: string;
}) {
  return (
    <SummaryRoot className={className} aria-label={label} {...props}>
      {children ??
        items.map((item) => (
          <div className={cn("summary-item", itemClassName)} key={item.label}>
            <dt className="summary-item-label">
              {item.icon}
              <span>{item.label}</span>
            </dt>
            <dd
              className={cn(
                "summary-item-value",
                item.emphasized && "text-warning",
              )}
            >
              {item.value}
            </dd>
            {item.detail && (
              <dd className="summary-item-detail">{item.detail}</dd>
            )}
          </div>
        ))}
    </SummaryRoot>
  );
}

export function ResourceHeader({
  icon,
  title,
  badge,
  meta,
  summary,
  actions,
  className,
  identityClassName,
  titleClassName,
  summaryClassName,
  sideClassName,
  children,
  ...props
}: Omit<ComponentProps<"header">, "title"> & {
  identityClassName?: string;
  titleClassName?: string;
  summaryClassName?: string;
  sideClassName?: string;
  icon?: ReactNode;
  title?: ReactNode;
  badge?: ReactNode;
  meta?: ReactNode;
  summary?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className={cn("resource-header", className)} {...props}>
      {children ?? (
        <>
          <div className={cn("resource-identity", identityClassName)}>
            <div className="resource-title-line">
              {icon}
              {title && (
                <h1 className={cn("page-title", titleClassName)}>{title}</h1>
              )}
              {badge}
            </div>
            {summary && (
              <p className={cn("resource-summary", summaryClassName)}>
                {summary}
              </p>
            )}
          </div>
          {(meta || actions) && (
            <div className={cn("resource-header-side", sideClassName)}>
              {meta && <div className="resource-meta">{meta}</div>}
              {actions && <div className="resource-actions">{actions}</div>}
            </div>
          )}
        </>
      )}
    </header>
  );
}

export function ResourceDetailShell({
  header,
  navigation,
  children,
  wide = false,
  className,
  contextClassName,
  contentClassName,
  ...props
}: ComponentProps<"div"> & {
  contextClassName?: string;
  contentClassName?: string;
  header: ReactNode;
  navigation?: ReactNode;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <div className={cn("resource-detail-page", className)} {...props}>
      <div className={cn("resource-context", contextClassName)}>
        {header}
        {navigation}
      </div>
      <div
        className={cn(
          "resource-detail-content",
          wide && "resource-detail-content-wide",
          contentClassName,
        )}
      >
        {children}
      </div>
    </div>
  );
}

export interface Crumb {
  label: string;
  to?: string;
}
export function Breadcrumbs({ items }: { items: Crumb[] }) {
  return (
    <nav
      aria-label="当前位置"
      className="flex min-w-0 items-center gap-2 overflow-hidden text-xs text-muted"
    >
      {items.map((item, index) => (
        <span
          key={`${item.label}-${index}`}
          className="flex min-w-0 items-center gap-2"
        >
          {index > 0 && (
            <ChevronRight className="size-3 shrink-0 text-faint" aria-hidden />
          )}
          {item.to ? (
            <Link className="truncate hover:text-primary" to={item.to}>
              {item.label}
            </Link>
          ) : (
            <span
              aria-current="page"
              className="truncate font-medium text-foreground"
            >
              {item.label}
            </span>
          )}
        </span>
      ))}
    </nav>
  );
}

export function Tabs({
  items,
  value,
  onChange,
  label,
  className,
  listClassName,
  tabClassName,
  children,
  ...props
}: Omit<TabsPrimitive.Root.Props, "value" | "onValueChange" | "onChange"> & {
  items: { value: string; label: ReactNode; disabled?: boolean }[];
  value: string;
  onChange: (value: string) => void;
  label: string;
  listClassName?: string;
  tabClassName?: string;
}) {
  return (
    <TabsPrimitive.Root
      className={className}
      value={value}
      onValueChange={(next) => {
        if (typeof next === "string") onChange(next);
      }}
      {...props}
    >
      <TabsPrimitive.List
        activateOnFocus
        className={cn("tabs", listClassName)}
        aria-label={label}
      >
        {items.map((item) => (
          <TabsPrimitive.Tab
            key={item.value}
            value={item.value}
            disabled={item.disabled}
            className={cn("tab", tabClassName)}
          >
            {item.label}
          </TabsPrimitive.Tab>
        ))}
      </TabsPrimitive.List>
      {children}
    </TabsPrimitive.Root>
  );
}
export const TabPanel = TabsPrimitive.Panel;

export function DescriptionList({
  items,
  className,
  itemClassName,
  labelClassName,
  valueClassName,
  ...props
}: ComponentProps<"dl"> & {
  itemClassName?: string;
  labelClassName?: string;
  valueClassName?: string;
  items: { label: string; value: ReactNode; full?: boolean }[];
}) {
  return (
    <dl className={cn("detail-grid", className)} {...props}>
      {items.map((item) => (
        <div
          key={item.label}
          className={cn(item.full && "form-full", itemClassName)}
        >
          <dt className={cn("detail-label", labelClassName)}>{item.label}</dt>
          <dd className={cn("detail-value", valueClassName)}>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
