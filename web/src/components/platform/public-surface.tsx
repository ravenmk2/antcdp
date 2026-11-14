import styles from "@/styles/public.module.css";
import { useContext, type ReactNode } from "react";
import { Surface } from "./surface";
import { SurfaceContext } from "./surface-context";

/** Status pages can render before an authenticated region has mounted. */
export function PublicSurface({ children }: { children: ReactNode }) {
  const parent = useContext(SurfaceContext);
  return parent ? (
    children
  ) : (
    <Surface area="public" className={styles.scope}>
      {children}
    </Surface>
  );
}
