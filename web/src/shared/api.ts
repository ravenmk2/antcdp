export interface ErrorDetail {
  code: string;
  field?: string;
  context?: Record<string, unknown>;
}
export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public details: ErrorDetail[] = [],
    public requestId?: string,
  ) {
    super(message);
  }
}
export interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  etag?: string;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}
export interface ApiResponse<T> {
  data: T;
  etag: string;
  collectionEtag?: string;
  pagination?: {
    page?: number;
    page_size?: number;
    total?: number;
    next_cursor?: string | null;
    has_more?: boolean;
  };
}

export function createApiClient() {
  let csrfToken = "";
  let csrfRequest: Promise<string> | undefined;
  let generation = 0;
  let authFailure: ((code: string) => void) | undefined;
  function resetCSRF() {
    csrfToken = "";
    csrfRequest = undefined;
    generation++;
  }
  function onAuthFailure(handler: (code: string) => void) {
    authFailure = handler;
  }
  async function api<T>(path: string, body?: unknown): Promise<T> {
    return (
      await request<T>(path, {
        method: body === undefined ? "GET" : "POST",
        body,
      })
    ).data;
  }
  async function token() {
    if (csrfToken) return csrfToken;
    if (!csrfRequest) {
      const current = generation;
      const pending = api<{ csrf_token: string }>("/auth/csrf").then((r) => {
        if (current !== generation)
          throw new ApiError("CSRF_INVALID", "登录状态已变化，请重试。");
        csrfToken = r.csrf_token;
        return csrfToken;
      });
      csrfRequest = pending;
      void pending
        .finally(() => {
          if (csrfRequest === pending) csrfRequest = undefined;
        })
        .catch(() => {});
    }
    return csrfRequest;
  }
  async function request<T>(
    path: string,
    options: RequestOptions = {},
  ): Promise<ApiResponse<T>> {
    const method = options.method ?? "GET";
    const write = method !== "GET";
    let csrf = "";
    if (write) {
      try {
        csrf = await token();
      } catch (error) {
        if (
          error instanceof ApiError &&
          [
            "NETWORK_ERROR",
            "HTTP_ERROR",
            "INVALID_RESPONSE",
            "INTERNAL_ERROR",
          ].includes(error.code)
        )
          throw new ApiError(
            "CSRF_UNAVAILABLE",
            "未取得请求令牌，本次操作尚未提交，请重试。",
            error.details,
            error.requestId,
          );
        throw error;
      }
    }
    let response: Response;
    try {
      response = await fetch(`/api/v1${path}`, {
        method,
        credentials: "same-origin",
        cache: "no-store",
        signal: options.signal,
        headers: {
          ...(write ? { "X-CSRF-Token": csrf } : {}),
          ...(write && !(options.body instanceof FormData)
            ? { "Content-Type": "application/json" }
            : {}),
          ...(options.etag ? { "If-Match": options.etag } : {}),
          ...options.headers,
        },
        body:
          options.body === undefined
            ? undefined
            : options.body instanceof FormData
              ? options.body
              : JSON.stringify(options.body),
      });
    } catch (err) {
      if (options.signal?.aborted) throw err;
      throw new ApiError("NETWORK_ERROR", "无法连接服务，请检查网络后重试。");
    }
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      if (payload?.error?.code === "CSRF_INVALID") resetCSRF();
      if (
        path !== "/auth/session" &&
        ["UNAUTHENTICATED", "PASSWORD_CHANGE_REQUIRED"].includes(
          payload?.error?.code,
        )
      )
        authFailure?.(payload.error.code);
      throw new ApiError(
        payload?.error?.code ?? "HTTP_ERROR",
        payload?.error?.message ?? "服务返回异常，请稍后重试。",
        payload?.error?.details ?? [],
        payload?.request_id,
      );
    }
    if (response.status === 204)
      return {
        data: undefined as T,
        etag: response.headers.get("ETag") ?? "",
        collectionEtag: response.headers.get("X-Collection-ETag") ?? undefined,
      };
    if (!payload || !("data" in payload))
      throw new ApiError("INVALID_RESPONSE", "服务响应格式不正确。");
    return {
      data: payload.data as T,
      etag: response.headers.get("ETag") ?? "",
      collectionEtag: response.headers.get("X-Collection-ETag") ?? undefined,
      pagination: payload.pagination,
    };
  }
  return { api, request, resetCSRF, onAuthFailure };
}
