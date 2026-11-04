import { useEffect, useState } from "react";
import { request, errorMessage } from "./api";
export function useCatalogPages<T>(path: string) {
  const [attempt, setAttempt] = useState(0),
    key = path + "|" + attempt;
  const [state, setState] = useState<{
    key: string;
    items?: T[];
    error?: string;
  }>();
  useEffect(() => {
    const ctrl = new AbortController();
    async function read() {
      const items: T[] = [];
      for (let page = 1; !ctrl.signal.aborted; page++) {
        const response = await request<{ items: T[]; total: number }>(
          path +
            (path.includes("?") ? "&" : "?") +
            "page=" +
            page +
            "&page_size=100",
          { signal: ctrl.signal },
        );
        items.push(...response.data.items);
        if (!response.data.items.length || items.length >= response.data.total)
          break;
      }
      if (!ctrl.signal.aborted) setState({ key, items });
    }
    void read().catch((e) => {
      if (!ctrl.signal.aborted) setState({ key, error: errorMessage(e) });
    });
    return () => ctrl.abort();
  }, [path, key]);
  const current = state?.key === key ? state : undefined;
  return {
    loading: !current,
    items: current?.items,
    error: current?.error,
    refresh: () => setAttempt((n) => n + 1),
  };
}
