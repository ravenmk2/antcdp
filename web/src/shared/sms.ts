export type Profile = {
  id: string;
  code: string;
  name: string;
  description: string;
  enabled: boolean;
  version: string;
  access_key_id: string;
  config: { provider: string };
  latest?: Log;
};
export type Param = {
  type: string;
  description?: string;
  required: boolean;
  default?: string;
};
export type Template = {
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
  parameter_schema: Record<string, Param>;
  sample_data: Record<string, string>;
  latest?: Log;
  last_simulation?: { status: string; outdated: boolean; started_at: string };
  updated_at: string;
};
export type Log = {
  id: string;
  test_id: string;
  profile_name: string;
  template_name: string;
  recipient_mask: string;
  status: string;
  reason_code: string;
  started_at: string;
  finished_at?: string;
  actor_name: string;
  outdated: boolean;
  provider_request_id?: string;
  provider_message_id?: string;
};
export type Page<T> = { items: T[]; total: number };
export type Preview = {
  body?: string;
  sign_name?: string;
  remote_template_id?: string;
  provider_parameters?: Record<string, string>;
};
export const labels: Record<string, string> = {
  in_progress: "执行中",
  accepted: "已受理",
  rejected: "被拒绝",
  failed_before_submit: "提交前失败",
  unknown: "结果未知",
};
const reasons: Record<string, string> = {
  provider_accepted: "供应商已受理请求",
  provider_rejected: "供应商拒绝请求，请核对账号、签名、模板及参数",
  response_unknown: "结果未知，可能已经提交，请核对后再发送",
  invalid_response: "未能识别供应商响应，结果未知",
  interrupted: "执行中断，无法确认结果",
  pending: "正在提交",
};
export const explain = (l: Log) =>
  reasons[l.reason_code] || "操作失败，请检查配置";
