import { RotateCcw } from "lucide-react";
import type { DurableRecord } from "@/types/agent-events";
import type { RetryState } from "../data/model-retries";
import { runtimeReason } from "../data/runtime-reasons";
import { StatusHint } from "./status-hint";
import styles from "./model-retry.module.css";

export function ModelRetry({
  record,
  state,
}: {
  record: Extract<DurableRecord, { event_type: "assistant/attempt" }>;
  state?: RetryState;
}) {
  const retry = record.data.retry;
  if (!retry) return null;
  const label =
    state === "waiting"
      ? "等待重试"
      : state === "running"
        ? "正在重试"
        : state === "recovered"
          ? "重试已恢复"
          : state === "ended"
            ? "重试已结束"
            : "已重试";
  return (
    <div
      className={styles.retry}
      role={state === "waiting" || state === "running" ? "status" : undefined}
    >
      <StatusHint
        label={`${label} ${retry.number}/${retry.max_retries}`}
        icon={<RotateCcw aria-hidden="true" />}
      >
        {retry.stage === "stream" ? "响应中断" : "请求失败"}：
        {runtimeReason(record.data.reason_code)}
        <br />第 {retry.number}/{retry.max_retries} 次重试，退避{" "}
        {(retry.delay_ms / 1000).toFixed(1)} 秒。
        <br />
        重新生成当前步骤，之前完成的工具不会重新执行。
      </StatusHint>
      <span>{label}</span>
      <span className={styles.count}>
        {retry.number}/{retry.max_retries}
      </span>
    </div>
  );
}
