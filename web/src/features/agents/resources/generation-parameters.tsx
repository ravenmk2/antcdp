import { Button } from "@/components/button";
import { Field, Input, Textarea } from "@/components/fields";
import type { JsonObject } from "@/types/models";

const numericFields = [
  ["temperature", "Temperature", 0, 2],
  ["top_p", "Top P", 0, 1],
  ["max_output_tokens", "单次最大输出（Token）", 1, 2000000],
] as const;

export function generationDraft(values: JsonObject) {
  return {
    temperature: String(values.temperature ?? ""),
    top_p: String(values.top_p ?? ""),
    max_output_tokens: String(values.max_output_tokens ?? ""),
    stop: (values.stop ?? []) as string[],
  };
}

type GenerationDraft = ReturnType<typeof generationDraft>;

export function generationParameters(
  draft: GenerationDraft,
  modelLimit?: number,
) {
  const parameters: JsonObject = {};
  for (const [key, label, min, max] of numericFields) {
    const raw = draft[key].trim();
    if (!raw) continue;
    const value = Number(raw);
    const upper = key === "max_output_tokens" ? (modelLimit ?? max) : max;
    if (
      !Number.isFinite(value) ||
      value < min ||
      value > upper ||
      (key === "max_output_tokens" && !Number.isInteger(value))
    ) {
      throw new Error(
        label +
          " 必须在 " +
          min +
          " 至 " +
          upper +
          " 之间" +
          (key === "max_output_tokens" ? "，且为整数" : ""),
      );
    }
    parameters[key] = value;
  }
  if (draft.stop.length) {
    if (
      draft.stop.length > 4 ||
      draft.stop.some(
        (value) =>
          !value.length || new TextEncoder().encode(value).length > 128,
      )
    ) {
      throw new Error("最多可设置 4 个停止词，每个停止词须为 1 至 128 字节");
    }
    parameters.stop = draft.stop;
  }
  return parameters;
}

export function GenerationFields({
  draft,
  modelLimit,
  readOnly,
  onChange,
}: {
  draft: GenerationDraft;
  modelLimit?: number;
  readOnly: boolean;
  onChange: (value: GenerationDraft) => void;
}) {
  return (
    <div className="space-y-4">
      <h4 className="text-sm font-medium">生成参数</h4>
      <div className="grid gap-4 sm:grid-cols-3">
        {numericFields.map(([key, label]) => (
          <Field key={key} label={label}>
            <Input
              value={draft[key]}
              readOnly={readOnly}
              inputMode={key === "max_output_tokens" ? "numeric" : "decimal"}
              placeholder={
                key === "max_output_tokens"
                  ? String(modelLimit ?? "模型上限")
                  : "提供商默认"
              }
              onChange={(e) => onChange({ ...draft, [key]: e.target.value })}
            />
          </Field>
        ))}
      </div>
      {draft.stop.map((value, index) => (
        <div className="flex items-end gap-3" key={index}>
          <Field label={"停止词 " + (index + 1)} className="flex-1">
            <Textarea
              rows={2}
              value={value}
              readOnly={readOnly}
              onChange={(e) =>
                onChange({
                  ...draft,
                  stop: draft.stop.map((word, i) =>
                    i === index ? e.target.value : word,
                  ),
                })
              }
            />
          </Field>
          {!readOnly && (
            <Button
              variant="ghost"
              aria-label={"移除停止词 " + (index + 1)}
              onClick={() =>
                onChange({
                  ...draft,
                  stop: draft.stop.filter((_, i) => i !== index),
                })
              }
            >
              移除
            </Button>
          )}
        </div>
      ))}
      {!readOnly && draft.stop.length < 4 && (
        <Button
          variant="outline"
          size="sm"
          onClick={() => onChange({ ...draft, stop: [...draft.stop, ""] })}
        >
          添加停止词
        </Button>
      )}
    </div>
  );
}
