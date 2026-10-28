import { ApiError } from "../../shared/api";
export interface Integration {
  id: string;
  service_type: string;
  name: string;
  description: string;
  enabled: boolean;
  version?: string;
}
export interface Capability {
  service_type: string;
  name: string;
  credentials: boolean;
  webhook: boolean;
  connection_test: boolean;
  auth_methods: string[];
}
export interface Credential {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  is_preferred: boolean;
  has_secret: boolean;
  expires_at: string | null;
  version: string;
  identity_config: Record<string, string>;
}
export interface Diagnostic {
  outdated?: boolean;
  status: string;
  started_at: string;
  http_status?: number;
  username?: string;
  event?: string;
  external_project_id?: string;
}
export const diagnosticLabels: Record<string, string> = {
  connection_failed: "连接失败，请检查地址、网络和证书",
  http_reachable: "HTTP 服务可达（未验证身份与业务权限）",
  authenticated: "身份验证通过（业务权限尚未验证）",
  authentication_failed: "认证未通过，请检查令牌和访问权限",
  invalid_response: "外部服务响应不符合预期",
  received_not_dispatched: "已验证接收，未触发工作流",
};
export function message(e: unknown) {
  if (e instanceof ApiError)
    return (
      e.message +
      (e.details.length
        ? "：" +
          e.details
            .map(
              (d) =>
                ({
                  base_url: "请输入 HTTPS 地址，不能包含查询参数或本机地址",
                  custom_ca_pem: "CA 证书格式不正确",
                  token: "令牌格式不正确",
                  name: "请检查名称",
                  webhook_enabled: "启用前请先保存验证秘密",
                  credential_id: "凭证不可用",
                  auth_method: "不支持此认证方式",
                  expires_at: "有效期格式不正确",
                })[d.field ?? ""] ??
                d.field ??
                d.code,
            )
            .join("；")
        : "")
    );
  return e instanceof Error ? e.message : "操作失败，请重试";
}
export function available(c: Credential) {
  return (
    c.enabled &&
    c.has_secret &&
    (!c.expires_at || Date.parse(c.expires_at) > Date.now())
  );
}
