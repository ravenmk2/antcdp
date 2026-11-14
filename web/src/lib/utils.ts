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
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  // LAN HTTP deployments lack randomUUID (a secure-context API), but still
  // expose cryptographic randomness. Keep command keys UUID v4 in both cases.
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"));
  return [
    hex.slice(0, 4).join(""),
    hex.slice(4, 6).join(""),
    hex.slice(6, 8).join(""),
    hex.slice(8, 10).join(""),
    hex.slice(10).join(""),
  ].join("-");
}

export function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function jsonText(value: unknown) {
  return JSON.stringify(value, null, 2);
}
