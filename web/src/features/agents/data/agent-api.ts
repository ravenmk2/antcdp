import { request, type RequestOptions } from "@/api/client";
import type { CommandReceipt } from "@/types/agents";

export const agentAdminRoot = "/admin/agents";
export const agentRoot = "/agents";
export const webAccessRoot = "/admin/web-access";
export type AgentApiDomain =
  typeof agentAdminRoot | typeof agentRoot | typeof webAccessRoot;
export const agentKeys = ["agents"] as const;
export const webAccessKeys = ["web-access"] as const;
export function agentRequest<T>(path: string, options?: RequestOptions) {
  return request<T>(`${agentRoot}${path}`, options);
}
export function agentAdminRequest<T>(path: string, options?: RequestOptions) {
  return request<T>(`${agentAdminRoot}${path}`, options);
}
export function webAccessRequest<T>(path: string, options?: RequestOptions) {
  return request<T>(`${webAccessRoot}${path}`, options);
}
export function commandReceipt<T>(
  domain: AgentApiDomain,
  key: string,
  command: string,
  scope: string,
) {
  const query = new URLSearchParams({ command, scope });
  return request<CommandReceipt<T>>(
    `${domain}/command-receipts/${encodeURIComponent(key)}?${query}`,
  );
}
export function agentQuery(
  params: Record<string, string | number | boolean | null | undefined>,
) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params))
    if (value != null && value !== "" && value !== "all")
      search.set(key, String(value));
  return search.toString();
}
export function versionEtag(version: string) {
  return `"${version}"`;
}
