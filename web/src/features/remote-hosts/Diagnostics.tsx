import { StatusText } from "@/components/platform/status-text";
import {
  type Diagnostic,
  diagnosticText,
  diagnosticTone,
} from "@/shared/remote-hosts";
import { useDate } from "@/lib/date";
export function DiagnosticResult({ value }: { value: Diagnostic | null }) {
  const date = useDate();
  if (!value)
    return <p className="text-sm text-muted-foreground">尚无诊断记录。</p>;
  const tone = diagnosticTone(value);
  return (
    <section className="space-y-2 rounded-lg border bg-muted/40 p-4">
      <h3 className="text-sm font-medium">
        {value.outdated ? "历史诊断 · 配置已变化" : "最近诊断"}
      </h3>
      <p className="text-sm">
        <StatusText
          tone={
            value.outdated ? "warning" : tone === "muted" ? "neutral" : tone
          }
        >
          {diagnosticText(value)}
        </StatusText>
      </p>
      <p className="text-xs text-muted-foreground">
        {date(value.finished_at)} {value.summary.external_identity?.username}{" "}
        {value.summary.event_type}
      </p>
    </section>
  );
}
