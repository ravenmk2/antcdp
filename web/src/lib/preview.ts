import { useEffect, useState } from "react";
import { request, errorMessage } from "./api";
export function jsonObject(text: string): Record<string, unknown> {
  const value: unknown = JSON.parse(text);
  if (!value || Array.isArray(value) || typeof value !== "object")
    throw Error("请输入 JSON 对象。");
  return value as Record<string, unknown>;
}
// Only call read-only preview endpoints. A changed draft invalidates the previous response immediately.
export function usePreview<T>(
  path: string,
  payload: string | null,
  initial = false,
  etag?: string,
) {
  const [wanted, setWanted] = useState<{ payload: string; seq: number } | null>(
    () => (initial && payload ? { payload, seq: 0 } : null),
  );
  const [value, setValue] = useState<{
    key: string;
    data?: T;
    error?: string;
  }>();
  const key =
    wanted && wanted.payload === payload
      ? path + "|" + (etag || "") + "|" + wanted.seq + "|" + payload
      : "";
  useEffect(() => {
    if (!key || !payload) return;
    const abort = new AbortController();
    void request<T>(path, {
      method: "POST",
      etag,
      body: JSON.parse(payload),
      signal: abort.signal,
    })
      .then((r) => {
        if (!abort.signal.aborted) setValue({ key, data: r.data });
      })
      .catch((e) => {
        if (!abort.signal.aborted) setValue({ key, error: errorMessage(e) });
      });
    return () => abort.abort();
  }, [key, path, payload, etag]);
  const current = value?.key === key ? value : undefined;
  return {
    data: current?.data,
    error: current?.error,
    loading: !!key && !current,
    run: () => {
      if (payload) setWanted((old) => ({ payload, seq: (old?.seq || 0) + 1 }));
    },
  };
}
