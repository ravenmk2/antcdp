import { useId, useState } from "react";
import { Info, X, type LucideIcon } from "lucide-react";
import { IconButton } from "@/components/button";
import { CopyButton } from "@/components/copy-button";
import {
  Popover,
  PopoverClose,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export function DescriptionPreview({
  name,
  description,
  label = "说明",
  triggerLabel,
  icon: Icon = Info,
}: {
  name: string;
  description: string;
  label?: string;
  triggerLabel?: string;
  icon?: LucideIcon;
}) {
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState(false);
  const titleId = useId();
  return (
    <Popover
      open={open}
      onOpenChange={(value) => {
        setOpen(value);
        setPreview(false);
      }}
    >
      <TooltipProvider delay={250}>
        <Tooltip open={preview && !open} onOpenChange={setPreview}>
          <TooltipTrigger
            render={
              <PopoverTrigger
                render={
                  <IconButton
                    label={triggerLabel ?? `查看 ${name} 的说明`}
                    size="iconSm"
                    title={undefined}
                    onClick={(event) => event.stopPropagation()}
                  >
                    <Icon aria-hidden />
                  </IconButton>
                }
              />
            }
          />
          <TooltipContent
            side="right"
            collisionPadding={12}
            className="max-w-[420px]"
          >
            <p className="m-0 max-h-[min(320px,var(--available-height))] overflow-y-auto whitespace-pre-wrap break-all leading-6">
              {description}
            </p>
            <p className="mt-2 mb-0 text-muted">
              点击固定查看，可选择和复制全文
            </p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <PopoverContent
        onClick={(event) => event.stopPropagation()}
        align="start"
        collisionPadding={16}
        aria-labelledby={titleId}
        className="w-[460px] max-w-[calc(100vw-32px)] p-0"
      >
        <div className="flex items-center justify-between gap-3 border-b border-b-border-subtle px-4 py-3">
          <h2
            id={titleId}
            className="m-0 min-w-0 break-all text-sm font-semibold"
          >
            {name} · {label}
          </h2>
          <div className="flex shrink-0 items-center gap-1">
            <CopyButton value={description} label={`复制${label}`} />
            <PopoverClose
              render={
                <IconButton label="关闭说明" size="iconSm">
                  <X aria-hidden />
                </IconButton>
              }
            />
          </div>
        </div>
        <div
          tabIndex={0}
          aria-label="说明全文"
          className="max-h-[min(420px,50vh)] overflow-y-auto whitespace-pre-wrap break-all p-4 text-sm leading-6"
        >
          {description}
        </div>
      </PopoverContent>
    </Popover>
  );
}
