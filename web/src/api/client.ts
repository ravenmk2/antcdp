import { z, type ZodType } from "zod";

const detailSchema = z.object({
  code: z.string(),
  field: z.string().optional(),
  context: z.record(z.string(), z.unknown()).optional(),
});
const errorBodySchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.array(detailSchema).default([]),
  }),
  request_id: z.string().optional(),
});
const paginationSchema = z.object({
  page: z.number().optional(),
  page_size: z.number().optional(),
  total: z.number().optional(),
  next_cursor: z.string().nullable().optional(),
  has_more: z.boolean().optional(),
});
const envelopeSchema = z.object({
  data: z.unknown(),
  pagination: paginationSchema.optional(),
});

export type ErrorDetail = z.infer<typeof detailSchema>;
export type Pagination = z.infer<typeof paginationSchema>;

export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 0,
    public readonly details: ErrorDetail[] = [],
    public readonly requestId?: string,
    public readonly retryAfter?: number,
    public readonly uncertain = false,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  etag?: string;
  collectionEtag?: string;
  idempotencyKey?: string;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

export interface ApiResponse<T> {
  data: T;
  etag: string;
  collectionEtag?: string;
  pagination?: Pagination;
  status: number;
  location?: string;
}

let csrfToken = "";
let csrfRequest: Promise<string> | undefined;
let csrfGeneration = 0;

export function resetCSRF() {
  csrfToken = "";
  csrfRequest = undefined;
  csrfGeneration += 1;
}

async function readCSRF(signal?: AbortSignal) {
  if (csrfToken) return csrfToken;
  if (!csrfRequest) {
    const generation = csrfGeneration;
    const pending = request<{ csrf_token: string }>("/auth/csrf", {
      signal,
    }).then((response) => {
      if (generation !== csrfGeneration) {
        throw new ApiError("CSRF_INVALID", "登录状态已变化，请重新操作。", 403);
      }
      csrfToken = response.data.csrf_token;
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

function retryAfter(response: Response) {
  const value = Number(response.headers.get("Retry-After"));
  return Number.isFinite(value) && value >= 0 ? value : undefined;
}

export async function request<T>(
  path: string,
  options: RequestOptions = {},
  schema?: ZodType<T>,
): Promise<ApiResponse<T>> {
  const method =
    options.method ?? (options.body === undefined ? "GET" : "POST");
  const write = method !== "GET";
  let csrf = "";
  if (write) {
    try {
      csrf = await readCSRF(options.signal);
    } catch (error) {
      if (
        error instanceof ApiError &&
        error.status !== 401 &&
        error.status !== 403
      ) {
        throw new ApiError(
          "CSRF_UNAVAILABLE",
          "未取得请求令牌，本次操作尚未提交，请检查连接后重试。",
          error.status,
          error.details,
          error.requestId,
        );
      }
      throw error;
    }
  }
  let response: Response;
  try {
    const form = options.body instanceof FormData;
    response = await fetch(`/api/v1${path}`, {
      method,
      credentials: "same-origin",
      cache: "no-store",
      signal: options.signal,
      headers: {
        ...(write ? { "X-CSRF-Token": csrf } : {}),
        ...(write && !form ? { "Content-Type": "application/json" } : {}),
        ...(options.etag ? { "If-Match": options.etag } : {}),
        ...(options.collectionEtag
          ? { "X-Collection-If-Match": options.collectionEtag }
          : {}),
        ...(options.idempotencyKey
          ? { "Idempotency-Key": options.idempotencyKey }
          : {}),
        ...options.headers,
      },
      body:
        options.body === undefined
          ? undefined
          : options.body instanceof FormData
            ? options.body
            : JSON.stringify(options.body),
    });
  } catch (error) {
    if (options.signal?.aborted) throw error;
    throw new ApiError(
      "NETWORK_ERROR",
      write
        ? "请求结果尚未确认。请先读取当前状态核实，不要直接重复提交。"
        : "无法连接服务，请检查网络后重试。",
      0,
      [],
      undefined,
      undefined,
      write,
    );
  }
  const payload: unknown =
    response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) {
    const parsed = errorBodySchema.safeParse(payload);
    const code = parsed.success ? parsed.data.error.code : "HTTP_ERROR";
    if (code === "CSRF_INVALID") resetCSRF();
    if (
      path !== "/auth/session" &&
      !["/auth/login", "/auth/register"].includes(path) &&
      ["UNAUTHENTICATED", "PASSWORD_CHANGE_REQUIRED"].includes(code)
    ) {
      window.dispatchEvent(
        new CustomEvent("antcdp:auth-failure", { detail: code }),
      );
    }
    throw new ApiError(
      code,
      parsed.success ? parsed.data.error.message : "服务返回异常，请稍后重试。",
      response.status,
      parsed.success ? parsed.data.error.details : [],
      parsed.success
        ? parsed.data.request_id
        : (response.headers.get("X-Request-ID") ?? undefined),
      retryAfter(response),
      write && !parsed.success,
    );
  }
  const base = {
    etag: response.headers.get("ETag") ?? "",
    collectionEtag: response.headers.get("X-Collection-ETag") ?? undefined,
    status: response.status,
    location: response.headers.get("Location") ?? undefined,
  };
  if (response.status === 204) return { ...base, data: undefined as T };
  const envelope = envelopeSchema.safeParse(payload);
  if (!envelope.success) {
    throw new ApiError(
      "INVALID_RESPONSE",
      "服务响应格式不正确。若本次为写操作，请先读取当前状态核实。",
      response.status,
      [],
      response.headers.get("X-Request-ID") ?? undefined,
      undefined,
      write,
    );
  }
  let data: T;
  try {
    data = schema
      ? schema.parse(envelope.data.data)
      : (envelope.data.data as T);
  } catch {
    throw new ApiError(
      "INVALID_RESPONSE",
      "服务响应内容与当前页面不兼容。",
      response.status,
    );
  }
  return { ...base, data, pagination: envelope.data.pagination };
}

export async function api<T>(
  path: string,
  body?: unknown,
  schema?: ZodType<T>,
) {
  return (await request<T>(path, { body }, schema)).data;
}

export function errorMessage(error: unknown) {
  if (!(error instanceof ApiError)) {
    return error instanceof Error && error.name !== "AbortError"
      ? error.message
      : "操作未完成，请稍后重试。";
  }
  const retry =
    error.retryAfter !== undefined
      ? ` 请等待 ${error.retryAfter} 秒后重试。`
      : "";
  const requestId = error.requestId ? `（请求编号：${error.requestId}）` : "";
  return `${error.message}${retry}${requestId}`;
}

export function isVersionConflict(error: unknown) {
  return error instanceof ApiError && [412, 428].includes(error.status);
}

export function isUncertain(error: unknown) {
  return error instanceof ApiError && error.uncertain;
}
