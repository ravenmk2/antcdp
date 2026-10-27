import { nextTick, reactive, ref } from "vue";
import type { FormInstance } from "element-plus";
import { ApiError } from "./api";
import { errorMessage } from "../features/identity/store";

// Each form explicitly declares the fields it can explain and focus.
export function useFormErrors<K extends string>(keys: readonly K[], aliases: Record<string, K> = {}) {
  const formRef = ref<FormInstance>();
  const error = ref("");
  const fieldErrors = reactive(Object.fromEntries(keys.map(key => [key, ""]))) as Record<K, string>;
  function clearErrors() {
    error.value = "";
    for (const key of keys) fieldErrors[key] = "";
  }
  async function focusError() {
    await nextTick();
    const input = formRef.value?.$el.querySelector(".is-error input, .is-error textarea, .is-error select") as HTMLElement | null;
    input?.focus({ preventScroll: true });
    input?.scrollIntoView({ block: "center", behavior: "instant" });
  }
  function showError(err: unknown) {
    const mapField = (name: string) => aliases[name] ?? name;
    const setField = (name: string, message: string) => {
      const key = mapField(name) as K;
      if (!keys.includes(key)) return false;
      fieldErrors[key] = [fieldErrors[key], message].filter(Boolean).join("；");
      return true;
    };
    const specialFields: Record<string, string> = {
      USERNAME_TAKEN: "username", CURRENT_PASSWORD_INVALID: "current_password", PASSWORD_UNCHANGED: "new_password",
    };
    if (err instanceof ApiError && specialFields[err.code] && setField(specialFields[err.code]!, errorMessage(err))) {
      // These business errors have an explicit field even when details are absent.
    } else if (err instanceof ApiError && err.code === "VALIDATION_FAILED") {
      const supported = new Set(["too_short", "too_many_bytes", "invalid_length", "invalid_format", "invalid_timezone", "invalid_value", "null_not_allowed"]);
      let unmatched = err.details.length === 0;
      for (const detail of err.details) {
        if (!detail.field || !supported.has(detail.code) || !setField(detail.field,
          errorMessage(new ApiError(err.code, err.message, [detail], err.requestId)))) unmatched = true;
      }
      if (unmatched) error.value = errorMessage(new ApiError(err.code, err.message, [], err.requestId));
    } else error.value = errorMessage(err);
    void focusError();
  }
  function hasErrors() {
    const invalid = keys.some(key => fieldErrors[key]);
    if (invalid) void focusError();
    return invalid;
  }
  return { formRef, error, fieldErrors, clearErrors, focusError, showError, hasErrors };
}

export const usernameHelp = "使用 3–30 位小写字母、数字、下划线或短横线，以字母或数字开头。";
export const passwordHelp = "至少 8 个字符，最多 72 个 UTF-8 字节。";
export function validateUsername(value: string) {
  return /^[a-z0-9][a-z0-9_-]{2,29}$/.test(value) ? "" : usernameHelp;
}
export function validateDisplayName(value: string) {
  const length = Array.from(value.trim()).length;
  return length >= 1 && length <= 30 ? "" : "显示名称需为 1–30 个字符。";
}
