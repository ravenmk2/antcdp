import { z } from "zod";

export const resourceSchema = z.object({
  name: z.string().trim().min(1, "请输入名称").max(100, "名称最多 100 个字符"),
  code: z
    .string()
    .regex(
      /^[A-Za-z0-9][A-Za-z0-9_-]{0,62}[A-Za-z0-9]$/,
      "2–64 位 ASCII 字母、数字、_ 或 -，首尾为字母或数字",
    ),
  summary: z.string().max(300, "摘要最多 300 个字符"),
  description: z
    .string()
    .refine(
      (value) => new TextEncoder().encode(value).length <= 100 * 1024,
      "简介不能超过 100 KiB",
    ),
});

export type ResourceFormValues = z.infer<typeof resourceSchema>;
