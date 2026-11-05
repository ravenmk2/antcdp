import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function text(value: unknown, fallback = "—") {
  if (value === null || value === undefined || value === "") return fallback;
  return String(value);
}

export function formatDate(
  value: string | null | undefined,
  timezone?: string,
) {
  if (!value || !Number.isFinite(Date.parse(value))) return "暂无记录";
  try {
    return new Intl.DateTimeFormat("zh-CN", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: timezone,
    }).format(new Date(value));
  } catch {
    return new Date(value).toLocaleString("zh-CN");
  }
}

export function formatBytes(value: number) {
  if (!Number.isFinite(value) || value < 0) return "—";
  if (value < 1024) return `${value} B`;
  const units = ["KiB", "MiB", "GiB"];
  let size = value / 1024;
  let unit = units[0] ?? "KiB";
  for (let index = 1; index < units.length && size >= 1024; index += 1) {
    size /= 1024;
    unit = units[index] ?? unit;
  }
  return `${size.toFixed(size >= 10 ? 1 : 2)} ${unit}`;
}

export function uuid() {
  return crypto.randomUUID();
}

export function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function jsonText(value: unknown) {
  return JSON.stringify(value, null, 2);
}
