import { ApiError } from "./api";
const fieldLabels: Record<string, string> = {
  username: "用户名",
  display_name: "显示名称",
  password: "密码",
  new_password: "新密码",
  current_password: "当前密码",
  site_name: "系统名称",
  timezone: "系统时区",
  session_ttl_days: "会话有效期",
};
const validationMessages: Record<string, string> = {
  too_short: "至少需要 8 个字符",
  too_many_bytes: "不能超过 72 个 UTF-8 字节",
  invalid_length: "长度不符合要求",
  invalid_format: "格式不正确",
  invalid_timezone: "请选择有效时区",
  invalid_value: "请选择有效值",
  null_not_allowed: "不能为空",
};
export function errorMessage(err: unknown) {
  if (!(err instanceof ApiError)) return "操作未完成，请稍后重试。";
  const details =
    err.code === "VALIDATION_FAILED"
      ? err.details
          .filter(
            (d) =>
              d.field && fieldLabels[d.field] && validationMessages[d.code],
          )
          .map((d) => `${fieldLabels[d.field!]}：${validationMessages[d.code]}`)
          .join("；")
      : "";
  return `${details || err.message}${err.requestId ? `（请求编号：${err.requestId}）` : ""}`;
}
export function validatePassword(password: string) {
  return Array.from(password).length < 8
    ? "密码至少需要 8 个字符。"
    : new TextEncoder().encode(password).length > 72
      ? "密码不能超过 72 个 UTF-8 字节。"
      : "";
}

export const usernameHelp =
  "使用 3–30 位小写字母、数字、下划线或短横线，以字母或数字开头。";
export const passwordHelp = "至少 8 个字符，最多 72 个 UTF-8 字节。";
export function validateUsername(value: string) {
  return /^[a-z0-9][a-z0-9_-]{2,29}$/.test(value) ? "" : usernameHelp;
}
export const siteNameHelp =
  "可选，最多 40 个字符。留空时侧边栏和浏览器标题只显示 AntCDP。";
export function validateSiteName(value: string) {
  return Array.from(value.trim()).length > 40 ? "系统名称最多 40 个字符。" : "";
}
export function validateDisplayName(value: string) {
  const length = Array.from(value.trim()).length;
  return length >= 1 && length <= 30 ? "" : "显示名称需为 1–30 个字符。";
}
