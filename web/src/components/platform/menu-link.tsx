import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { Home } from "lucide-react";
import { Link } from "react-router";

export function MenuLink({
  to,
  icon: Icon,
  label,
  description,
  className,
  iconClassName,
  current = false,
}: {
  to: string;
  icon: typeof Home;
  label: string;
  description?: string;
  className?: string;
  iconClassName?: string;
  current?: boolean;
}) {
  const content = (
    <>
      <Icon className={cn("size-4 shrink-0 text-muted", iconClassName)} />
      <span className="min-w-0 flex-1">
        <strong className="block text-sm font-medium">{label}</strong>
        {description && (
          <small className="mt-0.5 block text-[11px] text-muted">
            {description}
          </small>
        )}
      </span>
      {current && <span className="text-xs text-muted">当前</span>}
    </>
  );
  if (current) {
    return (
      <DropdownMenuItem
        className={className}
        aria-current="location"
        closeOnClick={false}
      >
        {content}
      </DropdownMenuItem>
    );
  }
  return (
    <DropdownMenuItem
      render={<Link to={to}>{content}</Link>}
      className={className}
    />
  );
}
