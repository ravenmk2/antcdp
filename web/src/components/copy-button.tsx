import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { IconButton } from "./button";

export function CopyButton({
  value,
  label = "复制",
}: {
  value: string;
  label?: string;
}) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <span className="inline-flex items-center gap-1">
      <IconButton
        size="iconSm"
        label={copied ? "已复制" : label}
        title={failed ? "复制失败，请手动复制" : copied ? "已复制" : label}
        onClick={async () => {
          clearTimeout(timer.current);
          try {
            await navigator.clipboard.writeText(value);
            setFailed(false);
            setCopied(true);
            timer.current = setTimeout(() => setCopied(false), 2000);
          } catch {
            setCopied(false);
            setFailed(true);
          }
        }}
      >
        {copied ? <Check className="text-success" /> : <Copy />}
      </IconButton>
      {failed && (
        <span className="text-xs text-danger" role="alert">
          复制失败
        </span>
      )}
    </span>
  );
}
