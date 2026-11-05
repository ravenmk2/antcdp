import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { Link } from "react-router";
import { cn } from "@/lib/utils";

export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  eyebrow?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div className="min-w-0">
        {eyebrow && (
          <div className="mb-2 text-xs font-medium text-primary">{eyebrow}</div>
        )}
        <h1 className="page-title">{title}</h1>
        {description && <div className="page-description">{description}</div>}
      </div>
      {actions && (
        <div className="flex flex-shrink-0 flex-wrap items-center gap-2 pt-1">
          {actions}
        </div>
      )}
    </header>
  );
}

export function Panel({
  title,
  action,
  children,
  className,
  bodyClassName,
}: {
  title?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={cn("panel", className)}>
      {(title || action) && (
        <header className="panel-header">
          <h2 className="panel-title">{title}</h2>
          {action}
        </header>
      )}
      <div
        className={
          bodyClassName ?? (title || action ? "panel-body" : undefined)
        }
      >
        {children}
      </div>
    </section>
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
}: {
  items: { value: string; label: ReactNode }[];
  value: string;
  onChange: (value: string) => void;
  label: string;
}) {
  return (
    <div className="tabs" role="tablist" aria-label={label}>
      {items.map((item) => (
        <button
          key={item.value}
          type="button"
          role="tab"
          aria-selected={value === item.value}
          className="tab"
          onClick={() => onChange(item.value)}
          onKeyDown={(event) => {
            if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
            event.preventDefault();
            const index = items.findIndex((entry) => entry.value === value);
            const next =
              event.key === "ArrowRight"
                ? (index + 1) % items.length
                : (index - 1 + items.length) % items.length;
            const target = items[next];
            if (target) {
              onChange(target.value);
              const tabs =
                event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(
                  "[role=tab]",
                );
              tabs?.[next]?.focus();
            }
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

export function DescriptionList({
  items,
}: {
  items: { label: string; value: ReactNode; full?: boolean }[];
}) {
  return (
    <dl className="detail-grid">
      {items.map((item) => (
        <div key={item.label} className={item.full ? "form-full" : undefined}>
          <dt className="detail-label">{item.label}</dt>
          <dd className="detail-value">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
