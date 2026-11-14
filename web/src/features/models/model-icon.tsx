import { BrainCircuit, Check } from "lucide-react";
import { Button } from "@/components/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useApiQuery } from "@/hooks/use-api";
import type { ModelCatalog } from "@/types/models";
import { modelKeys, modelRoot } from "./model-api";
import { useState } from "react";

const brands = new Set([
  "deepseek",
  "minimax",
  "glm",
  "ollama",
  "openai",
  "claude",
  "qwen",
  "gemini",
]);
export function ModelIcon({
  icon,
  fallback = "model",
  className = "size-6",
}: {
  icon?: string | null;
  fallback?: string | null;
  className?: string;
}) {
  const key = icon || fallback || "model";
  return brands.has(key) ? (
    <span
      aria-hidden
      className={`model-brand-icon ${className}`}
      style={{ maskImage: `url(/model-icons/${key}.svg)` }}
    />
  ) : (
    <BrainCircuit aria-hidden className={className} />
  );
}
export function ModelIconField({
  value,
  onChange,
  fallback,
  disabled = false,
}: {
  value: string | null;
  onChange: (key: string | null) => void;
  fallback: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const catalog = useApiQuery<ModelCatalog>(
    [...modelKeys, "types"],
    `${modelRoot}/provider-types`,
  );
  const options = [
    { key: "", label: "自动" },
    ...(catalog.data?.data.icons ?? []),
  ];
  return (
    <div className="space-y-2">
      <span className="block text-sm">图标</span>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <Button
              variant="outline"
              disabled={disabled}
              aria-label="选择模型图标"
            >
              <ModelIcon icon={value} fallback={fallback} />
              {options.find((o) => o.key === (value ?? ""))?.label ??
                "选择图标"}
            </Button>
          }
        />
        <PopoverContent
          align="start"
          className="w-80"
          aria-label="内置模型图标"
        >
          <div className="grid grid-cols-3 gap-2">
            {options.map((option) => (
              <button
                key={option.key}
                type="button"
                aria-pressed={(value ?? "") === option.key}
                className="relative flex flex-col items-center gap-2 rounded-md p-3 text-xs hover:bg-surface-hover aria-pressed:bg-surface-subtle"
                onClick={() => {
                  onChange(option.key || null);
                  setOpen(false);
                }}
              >
                <ModelIcon icon={option.key} fallback={fallback} />
                {option.label}
                {(value ?? "") === option.key && (
                  <Check
                    aria-hidden
                    className="absolute right-1 top-1 size-3"
                  />
                )}
              </button>
            ))}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
