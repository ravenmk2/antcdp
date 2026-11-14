import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "./button";
import { copyText } from "@/lib/clipboard";

export function CopyButton({
  value,
  label = "复制",
  text = false,
}: {
  value: string;
  label?: string;
  text?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <span className="inline-flex items-center gap-1">
      <Button
        size={text ? "sm" : "iconSm"}
        variant="ghost"
        aria-label={copied ? "已复制" : label}
        title={failed ? "复制失败，请手动复制" : copied ? "已复制" : label}
        onClick={async (event) => {
          clearTimeout(timer.current);
          try {
            await copyText(value, event.currentTarget);
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
        {text && (copied ? "已复制" : label)}
      </Button>
      {failed && (
        <span className="text-xs text-danger" role="alert">
          复制失败
        </span>
      )}
    </span>
  );
}
