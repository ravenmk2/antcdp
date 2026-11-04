export function ConfigPreview({ text }: { text: string }) {
  return (
    <pre
      className="mt-2 max-h-72 overflow-auto rounded-lg bg-muted p-3 text-sm"
      tabIndex={0}
      aria-label="配置原文预览"
    >
      {text
        .split(
          /("(?:[^"\\]|\\.)*"|#[^\n]*|\b(?:true|false|null|\d+)\b|[\w.-]+(?=\s*[:=]))/g,
        )
        .map((part, n) => (
          <span
            key={n}
            className={n % 2 ? "font-medium text-[var(--info)]" : undefined}
          >
            {part}
          </span>
        ))}
    </pre>
  );
}
