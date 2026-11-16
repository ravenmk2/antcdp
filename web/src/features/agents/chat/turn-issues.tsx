import { CircleAlert, Info, X } from "lucide-react";
import { Popover } from "@base-ui/react/popover";
import { Tooltip } from "@base-ui/react/tooltip";
import { usePortalContainer } from "@/components/platform/surface-context";
import type { TurnIssue } from "../data/turn-issues";
import { builtinToolNames } from "./tool-event";
import { ChatCopyButton } from "./controls";
import styles from "./turn-issues.module.css";

export function TurnIssues({
  issues,
  open,
  selected,
  onOpenChange,
  label,
}: {
  issues: TurnIssue[];
  label?: string;
  open: boolean;
  selected?: string;
  onOpenChange: (open: boolean) => void;
}) {
  const container = usePortalContainer();
  const tone = issues.some((item) => item.state === "failed")
    ? "failed"
    : issues.some((item) => item.state === "pending")
      ? "pending"
      : "past";
  const title = label ?? (tone === "past" ? "本轮过程记录" : "本轮异常");
  const summary = issues
    .map((item) => item.summary)
    .filter((value, index, values) => values.indexOf(value) === index)
    .join("；");
  const text = issues
    .map(
      (item) =>
        `${builtinToolNames[item.source] ?? item.source} · ${item.summary}${item.count > 1 ? ` · 异常 ${item.count} 次` : ""}\n${[...item.reasons, ...(item.details ?? [])].filter(Boolean).join("\n")}`,
    )
    .join("\n\n");
  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Tooltip.Root disabled={open}>
        <Tooltip.Trigger
          render={<Popover.Trigger />}
          className={styles.trigger}
          data-tone={tone}
          aria-label={`${title} · ${issues.length} 项`}
          delay={200}
        >
          {tone === "past" ? <Info aria-hidden /> : <CircleAlert aria-hidden />}
        </Tooltip.Trigger>
        <Tooltip.Portal container={container}>
          <Tooltip.Positioner
            className={styles.positioner}
            side="top"
            sideOffset={6}
            collisionPadding={12}
          >
            <Tooltip.Popup role="tooltip" className={styles.tooltip}>
              {summary}
              {issues[0]?.reasons[0] && <p>{issues[0].reasons[0]}</p>}
              <span>点击查看详情</span>
            </Tooltip.Popup>
          </Tooltip.Positioner>
        </Tooltip.Portal>
      </Tooltip.Root>
      <Popover.Portal container={container}>
        <Popover.Positioner
          className={styles.positioner}
          side="bottom"
          align="start"
          sideOffset={8}
          collisionPadding={12}
        >
          <Popover.Popup className={styles.popup} aria-label={title}>
            <div className={styles.heading}>
              <Popover.Title>{title}</Popover.Title>
              <ChatCopyButton value={text} label="复制本轮诊断" />
              <Popover.Close className={styles.close} aria-label="关闭本轮诊断">
                <X aria-hidden />
              </Popover.Close>
            </div>
            <div className={styles.items}>
              {issues.map((item) => (
                <section
                  key={item.id}
                  className={styles.item}
                  data-selected={selected === item.id}
                  data-tone={item.state}
                  ref={(element) => {
                    const list = element?.parentElement;
                    if (element && list && selected === item.id)
                      list.scrollTop = Math.max(
                        0,
                        element.offsetTop - list.offsetTop - 8,
                      );
                  }}
                >
                  <div className={styles.source}>
                    <span>{builtinToolNames[item.source] ?? item.source}</span>
                    {item.count > 1 && <span>异常 {item.count} 次</span>}
                  </div>
                  <p className={styles.summary}>{item.summary}</p>
                  {[...item.reasons, ...(item.details ?? [])].map((reason) => (
                    <p key={reason} className={styles.reason}>
                      {reason}
                    </p>
                  ))}
                </section>
              ))}
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
