import { useOperationToast } from "./operation-toast";
import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
export async function copyText(
  value: string,
  trigger: HTMLElement,
  focusVisible = false,
) {
  if (window.isSecureContext && navigator.clipboard) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const input = document.createElement("textarea");
  input.value = value;
  input.style.cssText = "position:fixed;opacity:0;pointer-events:none";
  (trigger.closest("[role=dialog]") || document.body).appendChild(input);
  try {
    input.select();
    if (!document.execCommand("copy")) throw Error("copy");
  } finally {
    input.remove();
    trigger.focus({ preventScroll: true, focusVisible });
  }
}
export function CopyButton({
  value,
  label = "复制",
}: {
  value: string;
  label?: string;
}) {
  return <CopyValue key={value} value={value} label={label} />;
}
function CopyValue({ value, label }: { value: string; label: string }) {
  const notify = useOperationToast();
  const [status, setStatus] = useState<
    "idle" | "pending" | "copied" | "failed"
  >("idle");
  const alive = useRef(true),
    timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      clearTimeout(timer.current);
    };
  }, []);
  async function copy(button: HTMLButtonElement, keyboard: boolean) {
    clearTimeout(timer.current);
    setStatus("pending");
    try {
      await copyText(value, button, keyboard);
      if (alive.current) {
        notify("已复制。");
        setStatus("copied");
        timer.current = setTimeout(() => setStatus("idle"), 2000);
      }
    } catch {
      if (alive.current) {
        setStatus("failed");
        notify("复制失败，请手动复制。", "danger");
      }
    }
  }
  return (
    <span className="inline-flex items-center gap-2">
      <Button
        type="button"
        size="icon"
        variant="ghost"
        title={label}
        aria-label={status === "copied" ? "已复制" : label}
        disabled={!value || status === "pending"}
        onClick={(e) => void copy(e.currentTarget, e.detail === 0)}
      >
        {status === "copied" ? <Check /> : <Copy />}
      </Button>
      <span
        role="status"
        className={status === "failed" ? "text-xs text-destructive" : "sr-only"}
      >
        {status === "failed"
          ? "复制失败，请手动复制。"
          : status === "copied"
            ? "已复制"
            : ""}
      </span>
    </span>
  );
}
