import { useEffect, useRef, useState, type ComponentProps } from "react";
import { Check, Copy } from "lucide-react";
import { copyText } from "@/lib/clipboard";

export function ChatIconButton({
  label,
  className = "",
  children,
  ...props
}: ComponentProps<"button"> & { label: string }) {
  return (
    <button
      type="button"
      className={`agent-chat-icon-button ${className}`}
      aria-label={label}
      title={label}
      {...props}
    >
      {children}
    </button>
  );
}

export function ChatCopyButton({
  value,
  label = "复制",
}: {
  value: string;
  label?: string;
}) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <span className="agent-copy-control">
      <ChatIconButton
        label={state === "copied" ? "已复制" : label}
        onClick={async (event) => {
          clearTimeout(timer.current);
          try {
            await copyText(value, event.currentTarget);
            setState("copied");
            timer.current = setTimeout(() => setState("idle"), 2000);
          } catch {
            setState("failed");
          }
        }}
      >
        {state === "copied" ? <Check /> : <Copy />}
      </ChatIconButton>
      {state === "failed" && <span role="alert">复制失败，请手动复制</span>}
    </span>
  );
}
