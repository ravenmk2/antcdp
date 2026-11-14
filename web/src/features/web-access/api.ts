import { request, type RequestOptions } from "@/api/client";
import { webAccessRoot } from "../agents/data/agent-api";
export { webAccessKeys } from "../agents/data/agent-api";
export function webRequest<T>(path: string, options?: RequestOptions) {
  return request<T>(`${webAccessRoot}${path}`, options);
}
