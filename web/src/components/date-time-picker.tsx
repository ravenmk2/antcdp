import { useState, type ReactNode } from "react";
import { Popover } from "radix-ui";
import { CalendarDays, ChevronDown } from "lucide-react";
import { TZDate } from "@date-fns/tz";
import { Button } from "./button";
import { Calendar } from "./ui/calendar";
import { StandaloneInput, useFieldProps } from "./fields";
import {
  dayBoundary,
  parseZonedInput,
  presetRange,
  validateRange,
  zonedInput,
  type TimeRange,
} from "@/lib/date-time";

const presets = [
  ["today", "今天"],
  ["yesterday", "昨天"],
  ["1", "近 24 小时"],
  ["7", "近 7 天"],
  ["30", "近 30 天"],
];
function Popup({ children }: { children: ReactNode }) {
  return (
    <Popover.Portal>
      <Popover.Content
        align="start"
        sideOffset={6}
        collisionPadding={16}
        className="z-[80] max-h-[calc(100dvh-40px)] max-w-[calc(100vw-32px)] overflow-auto rounded-xl border bg-surface text-foreground shadow-xl outline-none duration-150 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95"
      >
        {children}
      </Popover.Content>
    </Popover.Portal>
  );
}

export function DateRangePicker({
  value,
  onApply,
  timezone,
  retentionDays,
  disabled,
}: {
  value: TimeRange;
  onApply: (value: TimeRange) => void;
  timezone: string;
  retentionDays?: number;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [preset, setPreset] = useState("");
  const [error, setError] = useState("");
  const [month, setMonth] = useState<Date>();
  function draftDate(input: string) {
    try {
      const iso = parseZonedInput(input, timezone);
      return iso ? new TZDate(iso, timezone) : undefined;
    } catch {
      return undefined;
    }
  }
  const start = draftDate(from),
    end = draftDate(to);
  const endDay =
    end && new TZDate(end.getTime() - (to.endsWith("00:00") ? 1 : 0), timezone);
  const selected = start ? { from: start, to: endDay } : undefined;
  const label =
    presets.find(([key]) => key === value.preset)?.[1] ??
    (!value.from && !value.to
      ? retentionDays
        ? `近 ${retentionDays} 天`
        : "全部时间"
      : `${value.from ? zonedInput(value.from, timezone).slice(0, 10) : "不限"} 至 ${value.to ? zonedInput(value.to, timezone).slice(0, 10) : "现在"}`);
  function apply() {
    try {
      const range =
        preset && preset !== "custom"
          ? presetRange(preset, timezone)
          : {
              from: parseZonedInput(from, timezone),
              to: parseZonedInput(to, timezone),
              preset: "custom",
            };
      validateRange(range, retentionDays);
      onApply(range);
      setOpen(false);
    } catch (cause) {
      setError((cause as Error).message);
    }
  }
  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        if (next) {
          setFrom(zonedInput(value.from, timezone));
          setTo(zonedInput(value.to, timezone));
          setPreset(value.preset ?? "custom");
          setError("");
          setMonth(
            value.from
              ? new TZDate(value.from, timezone)
              : new TZDate(Date.now(), timezone),
          );
        }
        setOpen(next);
      }}
    >
      <Popover.Trigger asChild>
        <Button
          variant="outline"
          disabled={disabled}
          aria-label="时间范围"
          title={`${label} · ${timezone}`}
          className="max-w-[280px] justify-start font-normal"
        >
          <CalendarDays />
          <span className="truncate">{label}</span>
          <ChevronDown className="ml-auto text-muted" />
        </Button>
      </Popover.Trigger>
      <Popup>
        <div className="flex">
          <div className="flex w-32 shrink-0 flex-col gap-1 border-r bg-surface-subtle p-3">
            <span className="mb-1 px-2 text-xs text-muted">快捷范围</span>
            {[...(retentionDays ? [] : [["all", "全部时间"]]), ...presets].map(
              ([key, title]) => (
                <Button
                  key={key}
                  size="sm"
                  variant={preset === key ? "secondary" : "ghost"}
                  className="justify-start"
                  onClick={() => {
                    const range = presetRange(key, timezone);
                    setFrom(zonedInput(range.from, timezone));
                    setTo(zonedInput(range.to, timezone));
                    setPreset(key);
                    setError("");
                    if (range.from) setMonth(new TZDate(range.from, timezone));
                  }}
                >
                  {title}
                </Button>
              ),
            )}
          </div>
          <div>
            <Calendar
              mode="range"
              timeZone={timezone}
              month={month}
              onMonthChange={setMonth}
              numberOfMonths={2}
              selected={selected}
              disabled={
                retentionDays
                  ? {
                      before: new TZDate(
                        dayBoundary(
                          new Date(Date.now() - retentionDays * 86400000),
                          timezone,
                        ),
                        timezone,
                      ),
                      after: new TZDate(Date.now(), timezone),
                    }
                  : undefined
              }
              onSelect={(range) => {
                setPreset("custom");
                setError("");
                setFrom(
                  range?.from
                    ? zonedInput(dayBoundary(range.from, timezone), timezone)
                    : "",
                );
                setTo(
                  range?.to
                    ? zonedInput(dayBoundary(range.to, timezone, 1), timezone)
                    : "",
                );
              }}
            />
            <div className="grid grid-cols-2 gap-3 border-t px-4 py-3">
              <label className="grid gap-1.5 text-xs text-muted">
                开始时间（含）
                <StandaloneInput
                  aria-label="开始时间"
                  placeholder="YYYY-MM-DD HH:mm"
                  value={from}
                  onChange={(e) => {
                    setFrom(e.target.value);
                    setPreset("custom");
                    setError("");
                  }}
                />
              </label>
              <label className="grid gap-1.5 text-xs text-muted">
                结束时间（不含）
                <StandaloneInput
                  aria-label="结束时间"
                  placeholder="YYYY-MM-DD HH:mm"
                  value={to}
                  onChange={(e) => {
                    setTo(e.target.value);
                    setPreset("custom");
                    setError("");
                  }}
                />
              </label>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3 border-t px-4 py-3">
          <div className="mr-auto text-xs leading-5 text-muted">
            <div>系统时区：{timezone} · 24 小时制</div>
            <div>
              {retentionDays
                ? `仅查询最近 ${retentionDays} 天；超出部分按保留期截取。`
                : "可只填一端；选中日期包含结束日，留空表示不限。"}
            </div>
            {error && (
              <p role="alert" className="text-danger">
                {error}
              </p>
            )}
          </div>
          <Button
            variant="ghost"
            onClick={() => {
              setFrom("");
              setTo("");
              setPreset(retentionDays ? "30" : "all");
              setError("");
            }}
          >
            重置
          </Button>
          <Button variant="outline" onClick={() => setOpen(false)}>
            取消
          </Button>
          <Button onClick={apply}>应用</Button>
        </div>
      </Popup>
    </Popover.Root>
  );
}

export function DateTimePicker({
  value,
  onChange,
  timezone,
  name,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  timezone: string;
  name: string;
  disabled?: boolean;
}) {
  const field = useFieldProps();
  const [open, setOpen] = useState(false),
    [draft, setDraft] = useState(""),
    [error, setError] = useState("");
  let selected: Date | undefined;
  try {
    const iso = parseZonedInput(draft, timezone);
    if (iso) selected = new TZDate(iso, timezone);
  } catch {
    /* Keep invalid text editable. */
  }
  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        if (next) {
          setDraft(zonedInput(value, timezone));
          setError("");
        }
        setOpen(next);
      }}
    >
      <input type="hidden" name={name} value={value} disabled={disabled} />
      <Popover.Trigger asChild>
        <Button
          {...field}
          data-field-name={name}
          variant="outline"
          disabled={disabled}
          className="h-10 w-full justify-start font-normal"
        >
          <CalendarDays />
          {value ? zonedInput(value, timezone) : "选择到期时间"}
          <ChevronDown className="ml-auto" />
        </Button>
      </Popover.Trigger>
      <Popup>
        <Calendar
          mode="single"
          timeZone={timezone}
          selected={selected}
          defaultMonth={value ? new TZDate(value, timezone) : undefined}
          onSelect={(date) => {
            setDraft(
              date
                ? `${zonedInput(dayBoundary(date, timezone), timezone).slice(0, 10)} ${draft.slice(11) || "00:00"}`
                : "",
            );
            setError("");
          }}
        />
        <div className="grid gap-3 border-t p-3">
          <label className="grid gap-1 text-xs text-muted">
            日期与时间
            <StandaloneInput
              aria-label="到期日期与时间"
              placeholder="YYYY-MM-DD HH:mm"
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                setError("");
              }}
            />
          </label>
          <p className="text-xs text-muted">系统时区：{timezone}</p>
          {error && (
            <p role="alert" className="text-xs text-danger">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button
              variant="ghost"
              onClick={() => {
                onChange("");
                setOpen(false);
              }}
            >
              清空
            </Button>
            <Button variant="outline" onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button
              onClick={() => {
                try {
                  onChange(parseZonedInput(draft, timezone));
                  setOpen(false);
                } catch (cause) {
                  setError((cause as Error).message);
                }
              }}
            >
              确定
            </Button>
          </div>
        </div>
      </Popup>
    </Popover.Root>
  );
}
