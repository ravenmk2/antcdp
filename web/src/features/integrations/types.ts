import { ApiError } from "../../shared/api";
export interface ServiceConnection {
  id: string;
  code: string;
  config?: { base_url: string; custom_ca_pem: string | null };
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
  webhook: { supported: boolean; verification_methods: string[] };
  connection_test: boolean;
  auth_methods: string[];
}
export interface ServiceCredential {
  code: string;
  service_type: string;
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
export interface WebhookSettings {
  connection_id: string; updated_at: string | null;
  enabled: boolean; has_secret: boolean; verification_method: string; version: string;
}
export interface Diagnostic {
  id: string; kind: string; outdated: boolean; status: string; started_at: string; finished_at: string;
  summary: { reachability?: string; authentication?: string; permissions?: string; reason?: string;
    external_identity?: { id: string; username: string }; event_type?: string; source_project_id?: string; delivery_id?: string };
}
export const diagnosticLabels: Record<string, string> = {
  succeeded: "验证通过（不代表已获得具体业务权限）",
  failed: "验证未通过，请检查配置、网络和认证材料",
  unsupported: "此项验证暂不支持",
  received_not_dispatched: "已验证接收，未分发工作流",
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
                  base_url: "请输入 HTTP 或 HTTPS 地址，不能包含查询参数或本机地址",
                  custom_ca_pem: "CA 证书格式不正确",
                  token: "令牌格式不正确",
                  name: "请检查名称",
 code: "code 须以小写字母或数字开头，仅含小写字母、数字、下划线或短横线，最长 64 位",
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
export function available(c: ServiceCredential) {
  return (
    c.enabled &&
    c.has_secret &&
    (!c.expires_at || Date.parse(c.expires_at) > Date.now())
  );
}
