import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import styles from "./list-page.module.css";

export function ConsoleListPage({
  children,
  className,
  nested,
}: {
  children: ReactNode;
  className?: string;
  nested?: boolean;
}) {
  return (
    <div className={`page page-wide ${styles.scope}`}>
      <section
        className={cn("panel", styles.panel, className)}
        data-nested={nested || undefined}
      >
        {children}
      </section>
    </div>
  );
}
