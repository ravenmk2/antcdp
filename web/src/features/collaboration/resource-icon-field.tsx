import { Button } from "@/components/button";
import { iconLabels, ResourceIcon } from "@/components/resource-icon";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ImageEditor, type ImageValue } from "@/features/media/image-editor";
import { useApiQuery } from "@/hooks/use-api";
import type { ResourceIconValue } from "@/types/collaboration";
import { Check } from "lucide-react";
import { useState } from "react";

export function ResourceIconField({
  value,
  onChange,
  previewName,
  disabled = false,
  label = "图标",
  triggerLabel = "更换图标",
  triggerText = triggerLabel,
  popupLabel = "选择图标",
  popupTitle = popupLabel,
}: {
  value: ResourceIconValue;
  onChange: (value: ResourceIconValue) => void;
  previewName: string;
  disabled?: boolean;
  label?: string;
  triggerLabel?: string;
  triggerText?: string;
  popupLabel?: string;
  popupTitle?: string;
}) {
  const [image, setImage] = useState<ImageValue | null | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const [cropping, setCropping] = useState(false);
  const icons = useApiQuery<string[]>(["icon-catalog"], "/icon-catalog");
  const preview = {
    name: previewName || "未命名",
    icon_key: value.type === "builtin" ? value.key : null,
    icon_file_id: value.type === "upload" ? value.file_id : null,
  };

  return (
    <div className="form-full">
      <span className="mb-2 block text-xs font-medium text-text-soft">
        {label}
      </span>
      <Popover
        open={open}
        onOpenChange={(next, details) => {
          if (cropping) details.cancel();
          else setOpen(next);
        }}
      >
        <PopoverTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              className="h-auto gap-3 p-1"
              disabled={disabled}
              aria-label={triggerLabel}
            >
              <ResourceIcon resource={preview} className="size-12" />
              <span className="text-sm text-foreground">{triggerText}</span>
            </Button>
          }
        />
        <PopoverContent align="start" className="w-80" aria-label={popupLabel}>
          <p className="mb-3 text-sm font-medium">{popupTitle}</p>
          <div className="grid grid-cols-4 gap-2">
            {(icons.data?.data ?? Object.keys(iconLabels)).map((key) => {
              const selected = value.type === "builtin" && value.key === key;
              const iconLabel =
                iconLabels[key as keyof typeof iconLabels] ?? key;
              return (
                <button
                  key={key}
                  type="button"
                  aria-label={iconLabel}
                  aria-pressed={selected}
                  className={`relative grid justify-items-center gap-1 rounded-lg border px-1 py-2 text-xs hover:bg-surface-hover ${selected ? "border-primary bg-accent-soft text-primary" : "border-transparent"}`}
                  onClick={() => {
                    onChange({ type: "builtin", key });
                    setImage(null);
                    setOpen(false);
                  }}
                >
                  <ResourceIcon
                    resource={{
                      name: iconLabel,
                      icon_key: key,
                      icon_file_id: null,
                    }}
                    className="size-8"
                  />
                  <span className="text-foreground">{iconLabel}</span>
                  {selected && (
                    <Check
                      className="absolute right-1 top-1 size-3"
                      aria-hidden
                    />
                  )}
                </button>
              );
            })}
          </div>
          <div className="mt-3 flex items-center justify-between gap-3 border-t border-t-border-subtle pt-3">
            <ImageEditor
              kind="icon"
              value={image}
              compact
              onEditingChange={setCropping}
              disabled={disabled}
              onChange={(next) => {
                if (next) {
                  setImage(next);
                  onChange({ type: "upload", file_id: next.id });
                  setOpen(false);
                }
              }}
            />
            {value.type !== "default" && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  onChange({ type: "default" });
                  setImage(null);
                }}
              >
                恢复默认
              </Button>
            )}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
