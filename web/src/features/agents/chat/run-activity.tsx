import { useEffect, useState } from "react";
import { WifiOff } from "lucide-react";
import type { ConnectionStatus } from "../data/stream-client";
import type { ConversationStreamState } from "../data/stream-reducer";
import { StatusHint } from "./status-hint";
import styles from "./run-activity.module.css";

type StreamHealth = {
  connection: ConnectionStatus;
  phase: ConversationStreamState["phase"];
};

export function ConnectionHint({ connection, phase }: StreamHealth) {
  const healthy = connection === "open" && phase === "live";
  const closed = connection === "closed" || phase === "closed";
  const [delayed, setDelayed] = useState(false);
  useEffect(() => {
    if (healthy) return;
    const timer = setTimeout(() => setDelayed(true), 1500);
    return () => {
      clearTimeout(timer);
      setDelayed(false);
    };
  }, [healthy]);
  return (
    <span className={styles.connection}>
      {!healthy && (delayed || closed) && (
        <StatusHint label="会话连接状态" icon={<WifiOff aria-hidden="true" />}>
          {closed
            ? "会话连接不可用，请刷新页面重新连接。已提交的任务不会因此取消。"
            : "正在同步会话，当前显示可能不是最新状态。已提交的任务不会因此取消。"}
        </StatusHint>
      )}
    </span>
  );
}

export function ConversationLoading() {
  return (
    <div className={styles.loading} role="status" aria-label="正在加载对话">
      <div className={styles.skeleton} aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
    </div>
  );
}
