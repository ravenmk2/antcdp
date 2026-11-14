import type { JsonObject } from "@/types/models";

export const commonParameters = [
  "temperature",
  "top_p",
  "max_output_tokens",
  "stop",
] as const;
export function parseParameterObject(text: string): JsonObject {
  const parsed: unknown = JSON.parse(text);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new Error("请输入 JSON 对象");
  return parsed as JsonObject;
}
// This is an early form check; the server's registered schema remains authoritative.
export function validateParameters(
  value: JsonObject,
  schema: JsonObject,
): string | null {
  const properties = (schema.properties ?? {}) as Record<string, JsonObject>;
  for (const [key, item] of Object.entries(value)) {
    const rule = properties[key];
    if (!rule) return `参数 ${key} 未在当前协议的参数目录中注册`;
    const type = rule.type;
    if (
      (type === "number" || type === "integer") &&
      (typeof item !== "number" ||
        !Number.isFinite(item) ||
        (type === "integer" && !Number.isInteger(item)))
    )
      return `参数 ${key} 必须是${type === "integer" ? "整数" : "数字"}`;
    if (
      typeof item === "number" &&
      ((typeof rule.minimum === "number" && item < rule.minimum) ||
        (typeof rule.maximum === "number" && item > rule.maximum))
    )
      return `参数 ${key} 超出允许范围`;
    if (type === "boolean" && typeof item !== "boolean")
      return `参数 ${key} 必须是布尔值`;
    if (type === "string" && typeof item !== "string")
      return `参数 ${key} 必须是字符串`;
    if (
      type === "object" &&
      (!item || typeof item !== "object" || Array.isArray(item))
    )
      return `参数 ${key} 必须是对象`;
    if (type === "array" && !Array.isArray(item))
      return `参数 ${key} 必须是数组`;
    if (
      Array.isArray(rule.enum) &&
      !rule.enum.some(
        (allowed) => JSON.stringify(allowed) === JSON.stringify(item),
      )
    )
      return `参数 ${key} 不在允许的取值中`;
  }
  return null;
}
