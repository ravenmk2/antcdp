import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useImperativeHandle,
  useMemo,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { CircleCheck, Clock3, TriangleAlert, CircleX } from "lucide-react";
import { useLocation } from "react-router";

export type FeedbackTone = "success" | "info" | "warning" | "danger";
const icons = {
  success: CircleCheck,
  info: Clock3,
  warning: TriangleAlert,
  danger: CircleX,
};
type Notify = (message: string, tone?: FeedbackTone) => void;
const Context = createContext<RefObject<Notify | null> | null>(null);

export function useOperationToast() {
  const target = useContext(Context);
  return useCallback<Notify>(
    (message, tone) => target?.current?.(message, tone),
    [target],
  );
}

export function OperationToastProvider({ children }: { children: ReactNode }) {
  const { key } = useLocation();
  // A write finishing after navigation still holds its original page's target.
  const target = useMemo(
    () => ({ key, current: null as Notify | null }),
    [key],
  );
  return (
    <Context value={target}>
      {children}
      <OperationToast key={target.key} target={target} />
    </Context>
  );
}

function OperationToast({ target }: { target: RefObject<Notify | null> }) {
  const [notice, setNotice] = useState<{
    message: string;
    tone: FeedbackTone;
  } | null>(null);
  useImperativeHandle(
    target,
    () =>
      (message, tone = "success") =>
        setNotice({ message, tone }),
    [],
  );
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 3000);
    return () => window.clearTimeout(timer);
  }, [notice]);
  const Icon = notice && icons[notice.tone];
  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className="pointer-events-none fixed inset-0 z-[100] grid place-items-center p-4"
    >
      {notice && Icon && (
        <div
          data-feedback-tone={notice.tone}
          className="flex min-h-11 max-w-sm items-center gap-2.5 rounded-lg border px-4 py-2.5 text-[15px] font-semibold shadow-md"
        >
          <Icon aria-hidden="true" className="size-5 shrink-0" />
          <span className="min-w-0 break-words">{notice.message}</span>
        </div>
      )}
    </div>
  );
}
