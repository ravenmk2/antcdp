import { useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { ApiError, errorMessage } from "@/api/client";

const fieldLabels: Record<string, string> = {
  username: "用户名",
  display_name: "显示名称",
  password: "密码",
  new_password: "新密码",
  current_password: "当前密码",
  confirm: "确认密码",
  site_name: "系统名称",
  timezone: "系统时区",
  session_ttl_days: "会话有效期",
  name: "名称",
  code: "编码",
  summary: "摘要",
  description: "说明",
  version_label: "版本号",
  tag_prefix: "Tag 前缀",
  main_branch: "主干 Git 分支",
  branch_name: "绑定 Git 分支",
  default_source_branch: "默认来源分支",
  note: "说明",
  ref: "引用",
  recipient: "接收目标",
};
const reasonLabels: Record<string, string> = {
  required: "此字段必填",
  too_short: "长度不足",
  too_long: "内容过长",
  too_many_bytes: "UTF-8 字节数超过上限",
  invalid_length: "长度不符合要求",
  invalid_format: "格式不正确",
  invalid_value: "请选择或输入有效值",
  invalid_timezone: "请选择有效时区",
  null_not_allowed: "不能为 null",
  current_password_invalid: "当前密码不正确",
  password_unchanged: "新密码不能与当前密码相同",
};

export function detailMessage(field: string | undefined, code: string) {
  const reason = reasonLabels[code];
  if (field && reason) return `${fieldLabels[field] ?? field}：${reason}`;
  return "";
}

export function useFormErrors() {
  const formRef = useRef<HTMLFormElement>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  function clear() {
    setFields({});
    setError("");
  }
  function validate(values: Record<string, string>) {
    const active = Object.fromEntries(
      Object.entries(values).filter(([, value]) => value),
    );
    setFields(active);
    setError("");
    const first = Object.keys(active)[0];
    if (first) focus(first);
    return !first;
  }
  function focus(field: string) {
    requestAnimationFrame(() => {
      const element =
        Array.from(
          formRef.current?.querySelectorAll<HTMLElement>("[data-field-name]") ??
            [],
        ).find((control) => control.dataset.fieldName === field) ??
        formRef.current?.elements.namedItem(field);
      if (element instanceof HTMLElement) element.focus();
    });
  }
  function show(
    errorValue: unknown,
    known: string[] = [],
    aliases: Record<string, string> = {},
  ) {
    if (!(errorValue instanceof ApiError)) {
      setError(errorMessage(errorValue));
      return;
    }
    const next: Record<string, string> = {};
    const general: string[] = [];
    for (const detail of errorValue.details) {
      const field = aliases[detail.field ?? ""] ?? detail.field ?? "";
      if (field && known.includes(field)) {
        next[field] =
          detailMessage(detail.field, detail.code) ||
          `${fieldLabels[field] ?? field}：${detail.code}`;
      } else {
        general.push(detailMessage(detail.field, detail.code) || detail.code);
      }
    }
    const conflictField = (
      {
        USERNAME_TAKEN: "username",
        CODE_CONFLICT: "code",
        CONNECTION_CODE_CONFLICT: "code",
        CREDENTIAL_CODE_CONFLICT: "code",
        NAME_CONFLICT: "name",
        CURRENT_PASSWORD_INVALID: "current_password",
        PASSWORD_UNCHANGED: "new_password",
      } as Record<string, string>
    )[errorValue.code];
    if (
      conflictField &&
      known.includes(conflictField) &&
      !next[conflictField]
    ) {
      next[conflictField] = errorValue.message;
    }
    setFields(next);
    setError(
      [errorValue.message, ...general].join("；") +
        (errorValue.requestId ? `（请求编号：${errorValue.requestId}）` : ""),
    );
    const first = Object.keys(next)[0];
    if (first) focus(first);
  }
  function change(field: string) {
    setFields((current) => ({ ...current, [field]: "" }));
  }
  return {
    formRef,
    fields,
    error,
    setError,
    setFields,
    clear,
    validate,
    show,
    change,
  };
}

export function useSubmission() {
  const [error, setError] = useState<unknown>(null);
  const mutation = useMutation<void, ApiError, () => Promise<void>>({
    mutationFn: (task) => task(),
    retry: false,
    onError: (error) => setError(error),
  });
  async function run(
    task: () => Promise<void>,
    onError?: (error: ApiError) => void,
  ) {
    setError(null);
    try {
      await mutation.mutateAsync(task);
      return true;
    } catch (error) {
      if (error instanceof ApiError) onError?.(error);
      return false;
    }
  }
  return {
    pending: mutation.isPending,
    error,
    setError,
    run,
    uncertain: error instanceof ApiError && error.uncertain,
  };
}
