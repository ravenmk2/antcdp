import type { ReactNode } from "react";
import { Link } from "react-router";
export function SettingsFrame({
  title,
  links,
  children,
}: {
  title: string;
  links: { label: string; to: string; active?: boolean; external?: boolean }[];
  children: ReactNode;
}) {
  return (
    <section className="max-w-6xl space-y-7">
      <h1 className="text-2xl font-semibold">{title}</h1>
      <div className="grid items-start gap-6 lg:grid-cols-[172px_minmax(0,1fr)]">
        <nav
          aria-label={`${title}分类`}
          className="flex flex-wrap gap-1 lg:flex-col"
        >
          {links.map((link) =>
            link.external ? (
              <a
                key={link.to}
                href={link.to}
                className="rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-muted"
              >
                {link.label}
              </a>
            ) : (
              <Link
                key={link.to}
                to={link.to}
                aria-current={link.active ? "page" : undefined}
                className={`rounded-lg px-3 py-2 text-sm ${link.active ? "bg-accent font-medium" : "text-muted-foreground hover:bg-muted"}`}
              >
                {link.label}
              </Link>
            ),
          )}
        </nav>
        <div className="min-w-0 max-w-3xl rounded-xl border bg-card p-5 sm:p-7">
          {children}
        </div>
      </div>
    </section>
  );
}
