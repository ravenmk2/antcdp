import { useCallback, useEffect, useState } from "react";
import { useNavigationGuard } from "@/components/navigation-guard";

export function useUnsaved(dirty: boolean, pending = false) {
  const [saved, setSaved] = useState(false);
  const release = useNavigationGuard((dirty || pending) && !saved);
  useEffect(() => {
    if ((!dirty && !pending) || saved) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty, pending, saved]);
  return useCallback(() => {
    release();
    setSaved(true);
  }, [release]);
}
