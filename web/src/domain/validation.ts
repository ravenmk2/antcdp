import { z } from "zod";

export const usernameSchema = z
  .string()
  .regex(
    /^[a-z0-9][a-z0-9_-]{2,29}$/,
    "3–30 位小写字母、数字、_ 或 -，以字母或数字开头",
  );
export const displayNameSchema = z
  .string()
  .trim()
  .min(1, "请输入显示名称")
  .refine((value) => Array.from(value).length <= 30, "显示名称最多 30 个字符");
export const passwordSchema = z
  .string()
  .refine((value) => Array.from(value).length >= 8, "密码至少需要 8 个字符")
  .refine((value) => Array.from(value).length <= 72, "密码最多 72 个字符")
  .refine(
    (value) => new TextEncoder().encode(value).length <= 72,
    "密码不能超过 72 个 UTF-8 字节",
  );
export const resourceCodeSchema = z
  .string()
  .regex(
    /^[A-Za-z0-9][A-Za-z0-9_-]{0,62}[A-Za-z0-9]$/,
    "2–64 位字母、数字、_ 或 -，首尾为字母或数字",
  );
