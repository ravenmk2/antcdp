import { useId, useState } from "react";
import { Info, X } from "lucide-react";
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

export function HostDescription({
  name,
  description,
}: {
  name: string;
  description: string;
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
      <TooltipProvider delayDuration={250}>
        <Tooltip open={preview && !open} onOpenChange={setPreview}>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <IconButton
                label={`查看 ${name} 的说明`}
                size="iconSm"
                title={undefined}
              >
                <Info aria-hidden />
              </IconButton>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent
            side="right"
            collisionPadding={12}
            className="max-w-[420px]"
          >
            <p className="m-0 max-h-[min(320px,var(--radix-tooltip-content-available-height))] overflow-y-auto whitespace-pre-wrap break-all leading-6">
              {description}
            </p>
            <p className="mt-2 mb-0 text-faint">
              点击固定查看，可选择和复制全文
            </p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <PopoverContent
        align="start"
        collisionPadding={16}
        aria-labelledby={titleId}
        className="w-[460px] max-w-[calc(100vw-32px)] p-0"
      >
        <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
          <h2
            id={titleId}
            className="m-0 min-w-0 break-all text-sm font-semibold"
          >
            {name} · 主机说明
          </h2>
          <div className="flex shrink-0 items-center gap-1">
            <CopyButton value={description} label="复制主机说明" />
            <PopoverClose asChild>
              <IconButton label="关闭说明" size="iconSm">
                <X aria-hidden />
              </IconButton>
            </PopoverClose>
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
