import { useEffect, useRef, useState } from "react";
import { ApiError, errorMessage } from "@/lib/api";

export function useFormErrors() {
  const formRef = useRef<HTMLFormElement>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [focusAttempt, setFocusAttempt] = useState(0);
  useEffect(() => {
    if (!focusAttempt) return;
    formRef.current
      ?.querySelector<HTMLElement>('[aria-invalid="true"]')
      ?.focus();
  }, [focusAttempt]);
  function validate(next: Record<string, string>) {
    setFields(next);
    if (Object.values(next).some(Boolean)) {
      setFocusAttempt((value) => value + 1);
      return false;
    }
    return true;
  }
  function clear() {
    setFields({});
    setError("");
  }
  function show(
    err: unknown,
    allowed: string[],
    aliases: Record<string, string> = {},
  ) {
    const next: Record<string, string> = {};
    let unmatched = false;
    if (err instanceof ApiError) {
      const special: Record<string, string> = {
        USERNAME_TAKEN: "username",
        CURRENT_PASSWORD_INVALID: "current_password",
        PASSWORD_UNCHANGED: "new_password",
      };
      const specialName = special[err.code];
      if (specialName && allowed.includes(aliases[specialName] || specialName))
        next[aliases[specialName] || specialName] = errorMessage(err);
      else
        for (const detail of err.details) {
          const field = aliases[detail.field || ""] || detail.field;
          if (field && allowed.includes(field))
            next[field] = errorMessage(
              new ApiError(err.code, err.message, [detail], err.requestId),
            );
          else unmatched = true;
        }
    }
    setFields(next);
    setFocusAttempt((value) => value + 1);
    setError(!Object.keys(next).length || unmatched ? errorMessage(err) : "");
  }
  return { formRef, fields, setFields, error, setError, clear, show, validate };
}
