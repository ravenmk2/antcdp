import { Dialog } from "@base-ui/react/dialog";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { TerminalSquare, X } from "lucide-react";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { ConfirmDialog } from "@/components/overlays";
import { usePortalContainer } from "@/components/platform/surface-context";

const monokai = {
  background: "#000000",
  foreground: "#f8f8f2",
  cursor: "#f8f8f0",
  selectionBackground: "#49483e",
  black: "#333333",
  red: "#c4265e",
  green: "#86b42b",
  yellow: "#b3b42b",
  blue: "#6a7ec8",
  magenta: "#8c6bc8",
  cyan: "#56adbc",
  white: "#e3e3dd",
  brightBlack: "#666666",
  brightRed: "#f92672",
  brightGreen: "#a6e22e",
  brightYellow: "#e2e22e",
  brightBlue: "#819aff",
  brightMagenta: "#ae81ff",
  brightCyan: "#66d9ef",
  brightWhite: "#f8f8f2",
};

type Phase = "connecting" | "ready" | "disconnected";

export default function CloudTerminal({
  computerId,
  onClose,
}: {
  computerId: string;
  onClose: () => void;
}) {
  const portalContainer = usePortalContainer();
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const socket = useRef<WebSocket | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [phase, setPhase] = useState<Phase>("connecting");
  const [message, setMessage] = useState("正在连接");
  const [confirmEnd, setConfirmEnd] = useState(false);

  const onSessionExit = useEffectEvent(onClose);

  useEffect(() => {
    if (!host) return;
    const term = new Terminal({
      theme: monokai,
      cursorBlink: true,
      fontSize: 14,
      fontFamily: 'Consolas, "Liberation Mono", monospace',
      disableStdin: true,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);
    const observer = new ResizeObserver(() => fit.fit());
    observer.observe(host);
    let ws: WebSocket | undefined;
    let ready = false;
    let disposed = false;
    let finalMessage = false;
    const encoder = new TextEncoder();
    const sendSize = () => {
      if (ready && ws?.readyState === WebSocket.OPEN)
        ws.send(
          JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }),
        );
    };
    const sendBytes = (bytes: Uint8Array<ArrayBuffer>) => {
      if (!ready || ws?.readyState !== WebSocket.OPEN) return;
      for (let i = 0; i < bytes.length; i += 32768)
        ws.send(bytes.subarray(i, i + 32768));
    };
    term.onResize(sendSize);
    term.onData((data) => sendBytes(encoder.encode(data)));
    term.onBinary((data) =>
      sendBytes(Uint8Array.from(data, (c) => c.charCodeAt(0))),
    );
    const frame = requestAnimationFrame(() => {
      fit.fit();
      const url = new URL(
        `/api/v1/admin/agents/cloud-computers/${computerId}/terminal`,
        window.location.href,
      );
      url.protocol = location.protocol === "https:" ? "wss:" : "ws:";
      ws = new WebSocket(url, "antcdp.terminal.v1");
      socket.current = ws;
      ws.binaryType = "arraybuffer";
      ws.onmessage = ({ data }) => {
        if (disposed) return;
        if (data instanceof ArrayBuffer) {
          term.write(new Uint8Array(data));
          return;
        }
        const event = JSON.parse(data) as { type: string; message: string };
        if (event.type === "ready") {
          ready = true;
          term.options.disableStdin = false;
          setPhase("ready");
          setMessage("已连接");
          sendSize();
          term.focus();
        } else {
          finalMessage = true;
          ready = false;
          term.options.disableStdin = true;
          if (event.type === "exit") {
            onSessionExit();
            return;
          }
          setPhase("disconnected");
          setMessage(event.message);
        }
      };
      ws.onclose = () => {
        if (disposed || finalMessage) return;
        ready = false;
        term.options.disableStdin = true;
        setPhase("disconnected");
        setMessage("连接已断开");
      };
    });
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      ws?.close();
      socket.current = null;
      term.dispose();
    };
  }, [computerId, attempt, host]);

  return (
    <Dialog.Root
      open
      onOpenChange={(next, details) => {
        if (details.reason === "escape-key") {
          details.cancel();
          return;
        }
        if (!next) onClose();
      }}
    >
      <Dialog.Portal container={portalContainer}>
        <Dialog.Popup
          aria-describedby={undefined}
          className="fixed inset-0 z-50 flex h-dvh w-full flex-col bg-black text-[#f8f8f2] outline-none"
          style={{ colorScheme: "dark" }}
        >
          <header className="flex shrink-0 items-center gap-3 border-b border-white/20 px-4 py-2">
            <TerminalSquare size={18} aria-hidden />
            <Dialog.Title className="font-medium">
              云电脑 {computerId} 终端
            </Dialog.Title>
            <span role="status" className="text-xs text-zinc-400">
              {message}
            </span>
            <div className="ml-auto flex items-center gap-3">
              {phase === "disconnected" && (
                <button
                  className="rounded px-2 py-1 text-sm hover:bg-white/15"
                  onClick={() => {
                    setPhase("connecting");
                    setMessage("正在连接");
                    setAttempt((v) => v + 1);
                  }}
                >
                  重新连接
                </button>
              )}
              {phase === "ready" && (
                <button
                  className="rounded px-2 py-1 text-sm hover:bg-white/15"
                  onClick={() => setConfirmEnd(true)}
                >
                  结束终端
                </button>
              )}
              <button
                type="button"
                onClick={onClose}
                aria-label="关闭终端窗口"
                title="断开连接，保留终端会话"
                className="rounded p-2 hover:bg-white/15"
              >
                <X size={18} />
              </button>
            </div>
          </header>
          <div
            ref={setHost}
            className="m-2 min-h-0 min-w-0 flex-1 overflow-hidden"
          />
        </Dialog.Popup>
      </Dialog.Portal>
      {confirmEnd && (
        <ConfirmDialog
          open
          danger
          title="结束终端？"
          description="依赖此终端的进程可能会中止。关闭窗口可保留会话。"
          confirmLabel="确认结束"
          onClose={() => setConfirmEnd(false)}
          onConfirm={() => {
            if (socket.current?.readyState === WebSocket.OPEN)
              socket.current.send(JSON.stringify({ type: "end" }));
            setConfirmEnd(false);
          }}
        />
      )}
    </Dialog.Root>
  );
}
