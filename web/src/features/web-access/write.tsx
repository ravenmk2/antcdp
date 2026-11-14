import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ApiError, type ApiResponse, type RequestOptions } from "@/api/client";
import { Button } from "@/components/button";
import { ErrorNotice, Notice } from "@/components/feedback";
import { webAccessKeys, webRequest } from "./api";

type Attempt<T> = {
  path: string;
  options: RequestOptions;
  complete: (response: ApiResponse<T>) => void;
};
// Unknown write outcomes require an explicit read and human review, never replay.
export function useWebWrite<T>(onError?: (error: unknown) => void) {
  const client = useQueryClient();
  const [etag, setEtag] = useState<string>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>();
  const [uncertain, setUncertain] = useState(false);
  const [checked, setChecked] = useState(false);
  const [found, setFound] = useState<ApiResponse<T> | null>(null);
  const attempt = useRef<Attempt<T> | null>(null);
  const busy = useRef(false);
  async function run(
    path: string,
    options: RequestOptions,
    complete: Attempt<T>["complete"],
  ) {
    if (busy.current || uncertain) return;
    busy.current = true;
    setPending(true);
    setError(undefined);
    setChecked(false);
    setFound(null);
    attempt.current = { path, options, complete };
    try {
      const response = await webRequest<T>(path, options);
      attempt.current = null;
      complete(response);
    } catch (e) {
      setError(e);
      onError?.(e);
      const unknown =
        e instanceof ApiError &&
        (e.uncertain || e.status === 412 || e.status === 428);
      setUncertain(unknown);
      if (!unknown) attempt.current = null;
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  async function check() {
    const value = attempt.current;
    if (!value || busy.current) return;
    busy.current = true;
    setPending(true);
    setError(undefined);
    try {
      let match: ApiResponse<T> | null = null;
      if (value.options.method === "POST") {
        const body = value.options.body as Record<string, unknown>;
        const params = new URLSearchParams({
          page_size: "100",
          q: Array.from(String(body.name ?? "").trim())
            .slice(0, 64)
            .join(""),
        });
        for (let page = 1; ; page++) {
          params.set("page", String(page));
          const response = await webRequest<Record<string, unknown>[]>(
            `${value.path}?${params}`,
          );
          const row = response.data.find(
            (item) =>
              item.name === String(body.name ?? "").trim() &&
              (!body.code || item.code === body.code),
          );
          if (row) {
            match = await webRequest<T>(`${value.path}/${row.id}`);
            break;
          }
          if (
            !response.data.length ||
            page * 100 >= (response.pagination?.total ?? 0)
          )
            break;
        }
      } else {
        try {
          match = await webRequest<T>(
            value.path.replace(/\/authentication$/, ""),
          );
        } catch (e) {
          if (
            value.options.method === "DELETE" &&
            e instanceof ApiError &&
            e.status === 404
          ) {
            attempt.current = null;
            setUncertain(false);
            value.complete({ data: null as T, etag: "", status: 204 });
            return;
          }
          throw e;
        }
      }
      setFound(match);
      if (match?.etag) setEtag(match.etag);
      setChecked(true);
      void client.invalidateQueries({ queryKey: webAccessKeys });
    } catch (e) {
      setError(e);
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  return {
    etag,
    run,
    pending,
    error,
    uncertain,
    clearError: () => setError(undefined),
    recovery: (
      <>
        <ErrorNotice error={error} />
        {uncertain && (
          <Notice tone="warning" title="需要核对服务器状态">
            <p>
              草稿已保留，请重新读取服务器状态后核对。本次请求不会自动重试。
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                variant="outline"
                disabled={pending}
                onClick={() => void check()}
              >
                刷新核对
              </Button>
              {checked && (
                <Button
                  variant="outline"
                  disabled={pending}
                  onClick={() => {
                    attempt.current = null;
                    setUncertain(false);
                    setError(undefined);
                    setChecked(false);
                  }}
                >
                  已核对，继续编辑
                </Button>
              )}
              {checked &&
                found &&
                attempt.current?.options.method === "POST" && (
                  <Button
                    disabled={pending}
                    onClick={() => {
                      const saved = attempt.current;
                      attempt.current = null;
                      setUncertain(false);
                      saved?.complete(found);
                    }}
                  >
                    使用已有记录
                  </Button>
                )}
            </div>
            {checked && (
              <p className="mt-3">
                {found
                  ? `服务器当前记录：${String((found.data as Record<string, unknown>).name ?? "")}，版本 ${String((found.data as Record<string, unknown>).version ?? "")}。请核对列表或详情；密钥内容不可读取，不能据此确认新密钥已保存。`
                  : "当前未找到相同标识的记录；这不能证明原请求从未执行，请核对后再决定是否提交。"}
              </p>
            )}
          </Notice>
        )}
      </>
    ),
  };
}
