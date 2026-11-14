import type { SurfaceArea } from "@/components/platform/surface-context";
import { useState } from "react";

export function useSidebarPreference(area: Exclude<SurfaceArea, "public">) {
  const key = `antcdp.${area}.sidebar-collapsed`;
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return (
        (localStorage.getItem(key) ??
          localStorage.getItem("antcdp.sidebar-collapsed")) === "true"
      );
    } catch {
      return false;
    }
  });
  function toggleCollapsed() {
    setCollapsed((current) => {
      try {
        localStorage.setItem(key, String(!current));
      } catch {
        /* Optional preference storage. */
      }
      return !current;
    });
  }
  return { collapsed, toggleCollapsed };
}
