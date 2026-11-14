import { request, type RequestOptions } from "@/api/client";

export const modelRoot = "/admin/models";
export const modelKeys = ["model-management"];
export function modelRequest<T>(path: string, options?: RequestOptions) {
  return request<T>(`${modelRoot}${path}`, options);
}
