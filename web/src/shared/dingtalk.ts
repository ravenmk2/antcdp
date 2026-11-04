export type Diagnostic = {
  test_id: string;
  status: string;
  reason_code: string;
  started_at: string;
  finished_at?: string;
  outdated: boolean;
};
export type Robot = {
  id: string;
  code: string;
  name: string;
  description: string;
  enabled: boolean;
  keyword: string;
  version: string;
  latest?: Diagnostic;
};
export const labels: Record<string, string> = {
    in_progress: "执行中",
    accepted: "已受理",
    rejected: "被拒绝",
    failed_before_submit: "提交前失败",
    unknown: "结果未知",
  },
  reasons: Record<string, string> = {
    provider_accepted: "机器人接口已受理消息",
    provider_rejected: "机器人接口拒绝消息，请核对安全设置和频率限制",
    response_unknown: "未能确认结果，可能已经提交",
    invalid_response: "供应商响应无法识别，结果未知",
    interrupted: "执行中断，结果未知",
    pending: "正在提交",
  };
export const explain = (d: Diagnostic) =>
  reasons[d.reason_code] || "操作失败，请检查配置";
