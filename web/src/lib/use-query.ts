import { useCallback, useEffect, useState } from "react";
import { request, errorMessage, type ApiResponse } from "./api";
export function useQuery<T>(
  path: string | null,
  revision: string | number = "",
) {
  const [attempt, setAttempt] = useState(0);
  const key = `${path}|${revision}|${attempt}`;
  const [state, setState] = useState<{
    key: string;
    response?: ApiResponse<T>;
    error?: string;
  }>({ key: "" });
  useEffect(() => {
    if (!path) return;
    const controller = new AbortController();
    void request<T>(path, { signal: controller.signal })
      .then((response) => {
        if (!controller.signal.aborted) setState({ key, response });
      })
      .catch((e) => {
        if (!controller.signal.aborted)
          setState({ key, error: errorMessage(e) });
      });
    return () => controller.abort();
  }, [path, key]);
  const current = state.key === key ? state : undefined;
  return {
    data: current?.response?.data,
    response: current?.response,
    error: current?.error,
    loading: !!path && !current,
    refresh: useCallback(() => setAttempt((n) => n + 1), []),
  };
}
