import { Button } from "@/components/button";
import { Field, Input } from "@/components/fields";

export function incrementSkillVersion(
  base: string,
  part: number,
): string | null {
  if (
    !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(base) ||
    !Number.isInteger(part) ||
    part < 0 ||
    part > 2
  )
    return null;
  const parts = base.split(".").map(BigInt);
  parts[part] += 1n;
  for (let i = part + 1; i < 3; i++) parts[i] = 0n;
  const result = parts.join(".");
  return result.length <= 64 ? result : null;
}

export function SkillVersionField({
  base,
  value,
  onChange,
  error,
}: {
  error?: string;
  base?: string | null;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <Field
      label="版本号"
      error={error}
      hint={
        base
          ? `最近发布：${base}。可选择递增或手动输入，同一技能下不能重复。`
          : "首个版本默认为 0.1.0，可手动修改。"
      }
    >
      <div className="space-y-3">
        {base && (
          <div className="flex flex-wrap gap-2">
            {["主版本", "次版本", "修订版本"].map((label, part) => {
              const next = incrementSkillVersion(base, part);
              return (
                <Button
                  key={label}
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!next}
                  onClick={() => next && onChange(next)}
                >
                  {label} +1
                  {next && <span className="font-mono text-xs">{next}</span>}
                </Button>
              );
            })}
          </div>
        )}
        <Input
          name="version_label"
          required
          maxLength={64}
          pattern="[!-~]+"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="0.1.0"
          className="font-mono"
        />
        {base && incrementSkillVersion(base, 2) === null && (
          <p className="text-sm text-muted">
            最近版本不是可递增的三段数字版本，请手动输入。
          </p>
        )}
      </div>
    </Field>
  );
}
