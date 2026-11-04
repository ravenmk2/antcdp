import { ApiError } from "./api";
import { reasonLabels } from "./delivery";

// Decode this domain's field details without changing validation on the server.
export function deliveryFieldErrors(error: unknown): Record<string, string> {
  if (!(error instanceof ApiError) || error.code !== "VALIDATION_FAILED")
    return {};
  const errors: Record<string, string> = {};
  const messages: Record<string, string> = {
    required: "请填写此项",
    immutable: "创建后不可修改",
    invalid_value: "内容不符合要求",
    invalid_mode: "请选择有效的匹配方式",
    too_large: "仓库选择或匹配规则超过数量限制",
    duplicate: "存在重复的匹配规则",
    repository_out_of_scope: "所选仓库已不在当前产品分支范围内，请重新选择",
    connection_out_of_scope: "规则中的服务连接不属于当前项目仓库范围",
    ...reasonLabels,
  };
  for (const detail of error.details) {
    const field = detail.field?.split(".")[0];
    if (!field) continue;
    const key = ["main_branch", "branch_name"].includes(field)
      ? "branch"
      : field;
    let message = messages[detail.code];
    if (field === "code" && detail.code === "invalid_format")
      message =
        "编码须为 2–64 位字母、数字、下划线或连字符，首尾须为字母或数字";
    if (field === "name" && detail.code === "invalid_length")
      message = "名称须为 1–100 个字符，不能为空";
    if (field === "summary" && detail.code === "invalid_length")
      message = "说明不能超过 300 个字符";
    if (message)
      errors[key] = [errors[key], message].filter(Boolean).join("；");
  }
  return errors;
}
