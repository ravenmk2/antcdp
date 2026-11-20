import type { ReactNode } from "react";
import styles from "./list-page.module.css";
export function AgentListPage({ children }: { children: ReactNode }) {
  return (
    <div className={`page page-wide ${styles.scope}`}>
      <section className={`panel ${styles.panel}`}>{children}</section>
    </div>
  );
}
