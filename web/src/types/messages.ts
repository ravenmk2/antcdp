export interface SenderName {
  id: string;
  name: string;
  default: boolean;
}
export interface MessageLog {
  id: string;
  test_id: string;
  profile_id: string;
  template_id: string;
  actor_user_id: string;
  actor_name: string;
  profile_name: string;
  template_name: string;
  profile_version: number;
  template_version: number;
  sender_name_id?: string;
  recipient_mask: string;
  status: string;
  stage: string;
  reason_code: string;
  response_code?: string;
  message_id?: string;
  provider_request_id?: string;
  provider_message_id?: string;
  attachment_count?: number;
  attachment_bytes?: number;
  started_at: string;
  finished_at?: string;
  outdated: boolean;
}
export interface MessageProfile {
  id: string;
  code: string;
  name: string;
  description: string;
  enabled: boolean;
  version: string;
  created_at: string;
  updated_at: string;
  latest?: MessageLog;
}
export interface EmailProfile extends MessageProfile {
  config: {
    host: string;
    port: number;
    tls_mode: string;
    from_address: string;
    custom_ca_pem?: string;
  };
  username: string;
  has_secret: boolean;
  sender_names: SenderName[];
}
export interface SmsProfile extends MessageProfile {
  config: { provider: string };
  access_key_id: string;
  has_secret: boolean;
}
export interface TemplateParameter {
  type: string;
  description?: string;
  required: boolean;
  default?: unknown;
  properties?: Record<string, TemplateParameter>;
  items?: TemplateParameter;
}
export interface EmailTemplate {
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
  parameter_schema: Record<string, TemplateParameter>;
  sample_data: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  latest?: MessageLog;
}
export interface SmsTemplate {
  id: string;
  code: string;
  name: string;
  description: string;
  enabled: boolean;
  version: string;
  mode: "remote" | "local";
  profile_id: string;
  sign_name: string;
  remote_template_id: string;
  provider_parameters: Record<string, string>;
  engine_id: string;
  engine_version: number;
  body_template: string;
  parameter_schema: Record<string, TemplateParameter>;
  sample_data: Record<string, unknown>;
  last_simulation?: {
    test_id: string;
    status: string;
    outdated: boolean;
    started_at: string;
  };
  created_at: string;
  updated_at: string;
  latest?: MessageLog;
}
export interface DingTalkRobot {
  id: string;
  code: string;
  name: string;
  description: string;
  enabled: boolean;
  keyword: string;
  has_secret: boolean;
  version: string;
  created_at: string;
  updated_at: string;
  latest: {
    test_id: string;
    status: string;
    stage: string;
    reason_code: string;
    robot_version: number;
    actor_user_id: string;
    started_at: string;
    finished_at?: string;
    outdated: boolean;
  } | null;
}
export const messageStatusLabels: Record<string, string> = {
  in_progress: "执行中",
  accepted: "已受理",
  rejected: "被拒绝",
  failed_before_submit: "提交前失败",
  unknown: "结果未知",
};
export const messageReasons: Record<string, string> = {
  smtp_accepted: "SMTP 服务器已接受邮件",
  smtp_rejected: "SMTP 服务器拒绝请求",
  provider_accepted: "供应商已受理请求",
  provider_rejected: "供应商拒绝请求",
  response_unknown: "未能确认结果，可能已经提交，请核对后再发送",
  connection_failed: "无法建立连接",
  tls_failed: "TLS 握手失败",
  certificate_invalid: "证书配置无效",
  starttls_unavailable: "服务器不支持 STARTTLS",
  smtp_failed: "SMTP 操作失败",
  interrupted: "执行中断，无法确认结果",
  pending: "正在提交",
  mime_invalid: "邮件组装失败",
  invalid_response: "供应商响应无法识别，结果未知",
};
