export type EmailProfile = {
  id: string;
  code: string;
  name: string;
  description: string;
  enabled: boolean;
  version: string;
  updated_at: string;
  latest?: SendLog;
  config: {
    host: string;
    port: number;
    tls_mode: string;
    from_address: string;
    custom_ca_pem?: string;
  };
  username: string;
  sender_names: { id: string; name: string; default: boolean }[];
};
export type EmailTemplate = {
  id: string;
  code: string;
  name: string;
  description: string;
  enabled: boolean;
  version: string;
  engine_id: string;
  engine_version: number;
  subject_template: string;
  body_format: string;
  body_template: string;
  text_body_template: string;
  parameter_schema: Record<string, unknown>;
  sample_data: Record<string, unknown>;
  updated_at: string;
  latest?: SendLog;
};
export type SendLog = {
  id: string;
  test_id: string;
  profile_name: string;
  template_name: string;
  recipient_mask: string;
  status: string;
  reason_code: string;
  stage: string;
  actor_name: string;
  started_at: string;
  finished_at?: string;
  outdated: boolean;
  profile_version: number;
  template_version: number;
  attachment_count: number;
  attachment_bytes: number;
  message_id?: string;
};
export type Page<T> = { items: T[]; total: number };
export const labels: Record<string, string> = {
  in_progress: "执行中",
  accepted: "已受理",
  rejected: "被拒绝",
  failed_before_submit: "提交前失败",
  unknown: "结果未知",
};
const reasons: Record<string, string> = {
  smtp_accepted: "SMTP 服务器已接受邮件",
  smtp_rejected: "SMTP 服务器拒绝请求",
  response_unknown: "未能确认结果，可能已经提交，请核对后再发送",
  connection_failed: "无法建立 SMTP 连接",
  tls_failed: "TLS 握手失败",
  certificate_invalid: "证书配置无效",
  starttls_unavailable: "服务器不支持 STARTTLS",
  smtp_failed: "SMTP 操作失败",
  interrupted: "执行中断，无法确认结果",
  pending: "正在提交",
  mime_invalid: "邮件组装失败",
};
export const explain = (l: SendLog) =>
  reasons[l.reason_code] || "操作未完成，请检查配置和服务状态";
