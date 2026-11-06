import { DayPicker, type DayPickerProps } from "react-day-picker";
import { zhCN } from "react-day-picker/locale";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

// Calendar follows the shadcn/ui Calendar composition with the application's tokens.
export function Calendar({ className, classNames, ...props }: DayPickerProps) {
  return (
    <DayPicker
      locale={zhCN}
      weekStartsOn={1}
      showOutsideDays
      className={cn("relative p-3", className)}
      classNames={{
        months: "relative flex gap-6",
        month: "w-[252px]",
        month_caption:
          "flex h-10 items-center justify-center text-sm font-medium",
        nav: "absolute inset-x-0 top-0 flex justify-between",
        button_previous:
          "relative z-10 flex size-9 items-center justify-center rounded-md hover:bg-surface-hover disabled:opacity-30",
        button_next:
          "relative z-10 flex size-9 items-center justify-center rounded-md hover:bg-surface-hover disabled:opacity-30",
        month_grid: "w-full border-collapse",
        weekday: "h-8 text-center text-xs font-normal text-muted",
        day: "size-9 p-0 text-center text-sm",
        day_button:
          "size-9 rounded-md hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-primary",
        today: "font-semibold text-primary",
        selected: "[&>button]:bg-primary [&>button]:text-primary-foreground",
        range_start: "rounded-l-md bg-primary/10",
        range_end: "rounded-r-md bg-primary/10",
        range_middle:
          "bg-primary/10 [&>button]:rounded-none [&>button]:bg-transparent [&>button]:text-foreground",
        outside: "text-faint",
        disabled: "text-faint opacity-40",
        hidden: "invisible",
        ...classNames,
      }}
      components={{
        Chevron: ({ orientation }) =>
          orientation === "left" ? (
            <ChevronLeft className="size-4" />
          ) : (
            <ChevronRight className="size-4" />
          ),
      }}
      {...props}
    />
  );
}
