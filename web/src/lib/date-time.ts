import { TZDate } from "@date-fns/tz";

export type TimeRange = { from: string; to: string; preset?: string };
export function zonedInput(value: string | null | undefined, timezone: string) {
  if (!value || !Number.isFinite(Date.parse(value))) return "";
  const date = new TZDate(value, timezone);
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
export function parseZonedInput(value: string, timezone: string): string {
  if (!value.trim()) return "";
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/.exec(
    value.trim(),
  );
  if (!match) throw new Error("请按 YYYY-MM-DD HH:mm 输入日期和时间。");
  const [, year, month, day, hour, minute] = match.map(Number);
  const date = new TZDate(year, month - 1, day, hour, minute, 0, 0, timezone);
  const iso = new Date(date.getTime()).toISOString();
  if (zonedInput(iso, timezone) !== value.trim().replace("T", " "))
    throw new Error("日期或时间无效，或该时间因夏令时跳转而不存在。");
  return iso;
}
export function dayBoundary(date: Date, timezone: string, offset = 0) {
  const zoned = new TZDate(date, timezone);
  return new Date(
    new TZDate(
      zoned.getFullYear(),
      zoned.getMonth(),
      zoned.getDate() + offset,
      0,
      0,
      0,
      0,
      timezone,
    ).getTime(),
  ).toISOString();
}
export function presetRange(
  preset: string,
  timezone: string,
  now = new Date(),
): TimeRange {
  if (preset === "all") return { from: "", to: "", preset };
  if (preset === "today")
    return {
      from: dayBoundary(now, timezone),
      to: dayBoundary(now, timezone, 1),
      preset,
    };
  if (preset === "yesterday")
    return {
      from: dayBoundary(now, timezone, -1),
      to: dayBoundary(now, timezone),
      preset,
    };
  return {
    from: new Date(now.getTime() - Number(preset) * 86400000).toISOString(),
    to: "",
    preset,
  };
}
export function validateRange(
  range: TimeRange,
  retentionDays?: number,
  now = Date.now(),
) {
  const from = range.from ? Date.parse(range.from) : undefined;
  const to = range.to ? Date.parse(range.to) : undefined;
  if (
    (from !== undefined && !Number.isFinite(from)) ||
    (to !== undefined && !Number.isFinite(to))
  )
    throw new Error("请输入有效时间。");
  if (from !== undefined && to !== undefined && from >= to)
    throw new Error("结束时间必须晚于开始时间。");
  if (retentionDays && to !== undefined && to <= now - retentionDays * 86400000)
    throw new Error(`仅可查询最近 ${retentionDays} 天保留期内的日志。`);
}
