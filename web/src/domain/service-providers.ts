import type { Tone } from "@/components/feedback";
import type { Diagnostic } from "@/types/integrations";

export interface ProviderField {
  key: string;
  label: string;
  type?: "text" | "password" | "textarea";
  options?: { value: string; label: string }[];
}
export interface ProviderDefinition {
  type: string;
  name: string;
  description: string;
  defaultPort?: number;
  configFields: ProviderField[];
  methods: {
    value: string;
    label: string;
    identity: ProviderField[];
    secret: ProviderField[];
  }[];
  configBody: (values: Record<string, string>) => Record<string, unknown>;
}
const urlFields = (label: string): ProviderField[] => [
  { key: "base_url", label },
  { key: "custom_ca_pem", label: "公共 CA（可选）", type: "textarea" },
];
const user = { key: "username", label: "用户名" };
const token = (label: string): ProviderField => ({
  key: "token",
  label,
  type: "password",
});
const urlBody = (values: Record<string, string>) => ({
  base_url: values.base_url ?? "",
  custom_ca_pem: values.custom_ca_pem || null,
});
const databaseBody = (port: number) => (values: Record<string, string>) => ({
  host: values.host ?? "",
  port: Number(values.port ?? port),
  database: values.database ?? "",
  tls_mode: values.tls_mode ?? "disable",
  custom_ca_pem: values.custom_ca_pem || null,
});
export const serviceProviders: ProviderDefinition[] = [
  {
    type: "gitlab",
    name: "GitLab",
    description: "代码仓库、MR、Webhook 与发布身份",
    configFields: urlFields("GitLab 实例地址"),
    methods: [
      {
        value: "gitlab_access_token",
        label: "GitLab Access Token",
        identity: [],
        secret: [token("Access Token")],
      },
    ],
    configBody: urlBody,
  },
  {
    type: "jenkins",
    name: "Jenkins",
    description: "Jenkins 实例连接与 API 身份验证",
    configFields: urlFields("Jenkins 实例地址"),
    methods: [
      {
        value: "jenkins_api_token",
        label: "Jenkins API Token",
        identity: [user],
        secret: [token("API Token")],
      },
    ],
    configBody: urlBody,
  },
  {
    type: "openobserve",
    name: "OpenObserve",
    description: "日志平台连接、组织与身份验证",
    configFields: [
      ...urlFields("OpenObserve API 地址"),
      { key: "default_organization", label: "默认组织" },
    ],
    methods: [
      {
        value: "openobserve_basic",
        label: "用户名与密码 / Token",
        identity: [user],
        secret: [token("密码或服务账号 Token")],
      },
    ],
    configBody: (values) => ({
      ...urlBody(values),
      default_organization: values.default_organization || "default",
    }),
  },
  {
    type: "elasticsearch",
    name: "Elasticsearch",
    description: "搜索集群连接与安全身份验证",
    configFields: urlFields("Elasticsearch API 地址"),
    methods: [
      {
        value: "elasticsearch_basic",
        label: "用户名与密码",
        identity: [user],
        secret: [token("密码")],
      },
      {
        value: "elasticsearch_api_key",
        label: "API Key",
        identity: [],
        secret: [token("完整 encoded API Key")],
      },
    ],
    configBody: urlBody,
  },
  {
    type: "mysql",
    name: "MySQL",
    description: "MySQL 数据库连接与登录验证",
    defaultPort: 3306,
    configFields: [
      { key: "host", label: "主机" },
      { key: "port", label: "端口" },
      { key: "database", label: "默认数据库" },
      {
        key: "tls_mode",
        label: "TLS 模式",
        options: [
          { value: "disable", label: "禁用 TLS" },
          { value: "verify-full", label: "校验证书与主机名" },
        ],
      },
      { key: "custom_ca_pem", label: "公共 CA（可选）", type: "textarea" },
    ],
    methods: [
      {
        value: "mysql_password",
        label: "数据库用户名与密码",
        identity: [user],
        secret: [token("数据库密码")],
      },
    ],
    configBody: databaseBody(3306),
  },
  {
    type: "postgresql",
    name: "PostgreSQL",
    description: "PostgreSQL 数据库连接与登录验证",
    defaultPort: 5432,
    configFields: [
      { key: "host", label: "主机" },
      { key: "port", label: "端口" },
      { key: "database", label: "默认数据库" },
      {
        key: "tls_mode",
        label: "TLS 模式",
        options: [
          { value: "disable", label: "禁用 TLS" },
          { value: "verify-full", label: "校验证书与主机名" },
        ],
      },
      { key: "custom_ca_pem", label: "公共 CA（可选）", type: "textarea" },
    ],
    methods: [
      {
        value: "postgresql_password",
        label: "数据库用户名与密码",
        identity: [user],
        secret: [token("数据库密码")],
      },
    ],
    configBody: databaseBody(5432),
  },
];
export function providerFor(type: string) {
  return serviceProviders.find((provider) => provider.type === type);
}
export function defaultConfig(provider: ProviderDefinition) {
  return Object.fromEntries(
    provider.configFields.map((field) => [
      field.key,
      field.key === "port"
        ? String(provider.defaultPort ?? "")
        : field.key === "tls_mode"
          ? "disable"
          : field.key === "default_organization"
            ? "default"
            : "",
    ]),
  );
}
export function authenticationBody(
  method: ProviderDefinition["methods"][number],
  values: Record<string, string>,
) {
  return {
    auth_method: method.value,
    identity_config: Object.fromEntries(
      method.identity.map((field) => [field.key, values[field.key] ?? ""]),
    ),
    secret: Object.fromEntries(
      method.secret.map((field) => [field.key, values[field.key] ?? ""]),
    ),
  };
}
export const diagnosticReasons: Record<string, string> = {
  database_not_found: "数据库不存在",
  connection_failed: "连接失败，请检查地址、网络或证书",
  dns_failed: "域名解析失败",
  timeout: "连接超时",
  tls_failed: "TLS 证书验证失败",
  authentication_failed: "认证失败，请检查材料",
  access_denied: "远端访问被拒绝",
  endpoint_not_found: "接口或组织不存在",
  redirected: "请求被重定向，请使用直接 API 地址",
  unexpected_status: "服务返回异常状态",
  invalid_response: "响应不是预期服务数据",
  identity_mismatch: "远端身份与填写用户名不一致",
  host_key_untrusted: "主机公钥尚未信任",
  host_key_mismatch: "主机公钥不匹配，已阻止认证",
  ssh_handshake_failed: "SSH 握手失败",
  authentication_not_required: "远端未要求认证，无法验证此凭证",
};
export function diagnosticText(diagnostic: Diagnostic): string {
  if (diagnostic.outdated)
    return `历史结果 · ${diagnosticText({ ...diagnostic, outdated: false })}`;
  if (
    diagnostic.status === "succeeded" &&
    diagnostic.kind === "connection_check"
  )
    return diagnostic.summary.transport === "tcp"
      ? "TCP 端口可达；未验证数据库服务、TLS 或身份"
      : diagnostic.summary.service === "ssh"
        ? "SSH 可达且主机身份可信；未验证登录身份"
        : diagnostic.summary.service === "jenkins"
          ? "连接可达并识别 Jenkins；未验证身份"
          : "连接可达；未验证身份";
  if (
    diagnostic.status === "succeeded" &&
    diagnostic.summary.organization_access === "allowed"
  )
    return "认证及默认组织列表访问通过；日志查询权限未验证";
  if (
    diagnostic.status === "succeeded" &&
    diagnostic.kind === "credential_verification"
  )
    return diagnostic.summary.service === "ssh"
      ? "SSH 认证成功；未执行命令或验证 SFTP"
      : diagnostic.summary.service === "jenkins"
        ? "身份认证成功；构建权限未验证"
        : "身份认证成功；具体业务权限未验证";
  if (diagnostic.status === "received_not_dispatched")
    return "已验证接收；未分发工作流";
  return (
    diagnosticReasons[diagnostic.summary.reason ?? ""] ??
    (diagnostic.status === "unsupported"
      ? "此项验证暂不支持"
      : diagnostic.status === "failed"
        ? "验证未通过"
        : diagnostic.status)
  );
}
export function diagnosticTone(diagnostic: Diagnostic): Tone {
  if (diagnostic.outdated) return "warning";
  if (["succeeded", "received_not_dispatched"].includes(diagnostic.status))
    return "success";
  if (diagnostic.status === "failed") return "danger";
  return "warning";
}
