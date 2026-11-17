import { resourceCodeSchema } from "@/domain/validation";
import { z } from "zod";

export const resourceSchema = z.object({
  name: z.string().trim().min(1, "请输入名称").max(100, "名称最多 100 个字符"),
  code: resourceCodeSchema,
  summary: z.string().max(300, "摘要最多 300 个字符"),
  description: z
    .string()
    .refine(
      (value) => new TextEncoder().encode(value).length <= 100 * 1024,
      "简介不能超过 100 KiB",
    ),
});

export type ResourceFormValues = z.infer<typeof resourceSchema>;
