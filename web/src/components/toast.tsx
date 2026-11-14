import { CheckCircle2, Info, X } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { IconButton } from "./button";
import { usePortalContainer } from "./platform/surface-context";

interface ToastItem {
  id: number;
  message: string;
  tone: "success" | "info";
}
interface ToastContextValue {
  items: ToastItem[];
  dismiss: (id: number) => void;
  notify: (message: string, tone?: "success" | "info") => void;
}
const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({
  children,
  host = true,
}: {
  children: ReactNode;
  host?: boolean;
}) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const next = useRef(1);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  const dismiss = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer) clearTimeout(timer);
    timers.current.delete(id);
    setItems((current) => current.filter((item) => item.id !== id));
  }, []);
  const notify = useCallback(
    (message: string, tone: "success" | "info" = "success") => {
      const id = next.current++;
      setItems([{ id, message, tone }]);
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), 3000),
      );
    },
    [dismiss],
  );
  useEffect(
    () => () => {
      for (const timer of timers.current.values()) clearTimeout(timer);
      timers.current.clear();
    },
    [],
  );
  return (
    <ToastContext value={{ notify, items, dismiss }}>
      {children}
      {host && <ToastHost />}
    </ToastContext>
  );
}

export function useToast() {
  const value = useContext(ToastContext);
  if (!value) throw new Error("ToastProvider is required");
  return value;
}

export function ToastHost() {
  const state = useContext(ToastContext);
  const portal = usePortalContainer();
  if (!state) return null;
  const { items, dismiss } = state;
  const content = (
    <div
      className="pointer-events-none fixed top-1/2 left-1/2 z-[100] grid w-[min(420px,calc(100%-32px))] -translate-x-1/2 -translate-y-1/2 gap-2"
      aria-live="polite"
      aria-atomic
    >
      {items.map((item) => (
        <div
          key={item.id}
          className="pointer-events-auto flex items-center gap-3 rounded-lg border bg-surface px-4 py-3 shadow-(--floating-shadow)"
          role="status"
        >
          {item.tone === "success" ? (
            <CheckCircle2 className="size-5 text-success" />
          ) : (
            <Info className="size-5 text-info" />
          )}
          <span className="min-w-0 flex-1">{item.message}</span>
          <IconButton
            size="iconSm"
            label="关闭提示"
            onClick={() => dismiss(item.id)}
          >
            <X />
          </IconButton>
        </div>
      ))}
    </div>
  );
  return portal ? createPortal(content, portal) : content;
}
