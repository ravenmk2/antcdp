import { ApiError } from "../../shared/api";
export interface RemoteHost {
 host_key_fingerprints?: Record<string,string>;
  id: string;
  code: string;
  config?: { host_keys?: string[]; host?: string; port?: number; database?: string; tls_mode?: string; default_organization?: string; base_url?: string; custom_ca_pem: string | null };
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
export interface HostCredential {
  auth_method: string;
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
  summary: { host_key?: string; fingerprint?: string; host_identity?: string; host_key_algorithm?: string; reachability?: string; authentication?: string; permissions?: string; reason?: string;
    transport?: string; database_access?: string; organization_access?: string; service?: string; http_status?: number; external_identity?: { id?: string; username: string }; event_type?: string; source_project_id?: string; delivery_id?: string };
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
                  base_url: "服务地址格式不正确，不能包含凭证、查询参数或本机地址；数据库地址须包含数据库名",
                  host: "请输入主机名或 IP，不包含协议和端口",
                  port: "端口须为 1–65535 的整数",
                  database: "请输入默认数据库名",
                  tls_mode: "请选择启用并校验证书或禁用 TLS",
                  custom_ca_pem: "CA 证书格式不正确",
 default_organization: "组织标识须为 1–128 位字母、数字、下划线或短横线，且不能以短横线开头",
                  username: "用户名不能为空，不能包含冒号、控制字符或首尾空白",
                  token: "密码或令牌格式不正确", private_key:"私钥格式不支持或口令不正确", passphrase:"请输入正确的私钥口令", host_keys:"请填写受支持的 OpenSSH 公钥，不可重复",
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
export function available(c: HostCredential) {
  return (
    c.enabled &&
    c.has_secret &&
    (!c.expires_at || Date.parse(c.expires_at) > Date.now())
  );
}

const diagnosticReasons: Record<string, string> = {
 host_key_untrusted:"主机公钥尚未信任，请联系管理员核对", host_key_mismatch:"主机公钥不匹配，已阻止认证", ssh_handshake_failed:"SSH 握手失败", authentication_not_required:"远端未要求认证，无法验证此凭证",
  database_not_found: "数据库不存在，请检查数据库名",
  connection_failed: "连接失败，请检查地址、网络或 TLS 证书",
  dns_failed: "域名解析失败", timeout: "连接超时", tls_failed: "TLS 证书验证失败",
  authentication_failed: "需要认证或认证失败，请检查认证材料",
  access_denied: "访问被拒绝，请检查远端权限或前置代理",
  endpoint_not_found: "接口或组织不存在，请检查地址、组织和服务版本",
  redirected: "请求被重定向，请填写可直接访问 API 的基础地址",
  unexpected_status: "服务返回异常状态", invalid_response: "响应不是预期的服务 API 数据",
  identity_mismatch: "远端身份与填写的用户名不一致，请检查代理认证配置",
};
export function diagnosticText(d: Diagnostic): string {
 if(d.summary.service === "ssh" && d.status === "succeeded") return d.kind === "connection_check" ? "SSH 可达，主机身份可信；未验证登录身份" : "SSH 认证成功；未执行命令或验证 SFTP 权限";
  if (d.status === "succeeded" && d.kind === "connection_check")
    return d.summary.transport === "tcp" ? "TCP 端口可达（未验证数据库服务、TLS 或身份）" : d.summary.service === "jenkins" ? "连接可达，已识别 Jenkins API（未验证身份）" : "连接可达（未验证身份）";
  if (d.status === "succeeded" && d.summary.organization_access === "allowed") return "认证及默认组织列表访问通过；日志查询权限未验证";
  if (d.status === "succeeded" && d.kind === "credential_verification")
    return d.summary.service === "jenkins" ? "身份认证成功；构建权限未验证" : "身份认证成功；具体业务权限未验证";
  const reason = d.summary.reason ? diagnosticReasons[d.summary.reason] : undefined;
  return reason ? `${d.summary.reachability === "reachable" ? "网络可达；" : ""}${reason}` : (diagnosticLabels[d.status] ?? "未知验证结果");
}

export function diagnosticTone(d: Diagnostic): "success" | "danger" | "warning" | "muted" {
  if (d.outdated) return "muted";
  switch (d.status) {
    case "succeeded":
    case "received_not_dispatched": return "success";
    case "failed": return "danger";
    case "unsupported": return "warning";
    default: return "muted";
  }
}
