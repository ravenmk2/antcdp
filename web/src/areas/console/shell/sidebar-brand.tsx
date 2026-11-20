import { Link } from "react-router";

export function SidebarBrand({
  brand,
  onNavigate,
}: {
  brand: string;
  onNavigate?: () => void;
}) {
  return (
    <Link
      to="/admin"
      className="console-sidebar-brand"
      aria-label={`${brand} 控制台`}
      title={`${brand} 控制台`}
      onClick={onNavigate}
    >
      <img src="/logo-inverse.svg" alt="" className="size-8 shrink-0" />
      <span className="sidebar-label min-w-0">
        <strong className="block truncate leading-5">{brand}</strong>
        <small className="block text-xs text-muted">控制台</small>
      </span>
    </Link>
  );
}
