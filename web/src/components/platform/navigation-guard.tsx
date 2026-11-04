import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useBlocker } from "react-router";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogHeader,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
type State = "dirty" | "pending";
const Context = createContext<{
  register: (id: string, state?: State) => void;
  afterSave: (href: string) => void;
} | null>(null);
export function useNavigationProtection(state?: State) {
  const register = useContext(Context)?.register;
  const id = useId();
  useEffect(() => {
    register?.(id, state);
    return () => register?.(id);
  }, [id, register, state]);
}
// Only use after a confirmed successful write that requires a full-page handoff.
export function useNavigateAfterSave() {
  const context = useContext(Context);
  return (href: string) => {
    if (context) context.afterSave(href);
    else window.location.replace(href);
  };
}
export function NavigationGuard({ children }: { children: ReactNode }) {
  const [states, setStates] = useState<Record<string, State>>({});
  const [target, setTarget] = useState<string | null>(null);
  const allow = useRef(false);
  const active = Object.keys(states).length > 0;
  const pending = Object.values(states).includes("pending");
  const blocker = useBlocker(active);
  const register = useCallback(
    (id: string, state?: State) =>
      setStates((old) => {
        if (old[id] === state) return old;
        const next = { ...old };
        if (state) next[id] = state;
        else delete next[id];
        return next;
      }),
    [],
  );
  const state = useMemo(() => ({ active, pending }), [active, pending]);
  useEffect(() => {
    const unload = (event: BeforeUnloadEvent) => {
      if (state.active && !allow.current) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    const click = (event: MouseEvent) => {
      if (
        !state.active ||
        event.defaultPrevented ||
        event.button !== 0 ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      const link = (event.target as Element | null)?.closest<HTMLAnchorElement>(
        "a[href]",
      );
      if (!link || link.target === "_blank" || link.hasAttribute("download"))
        return;
      event.preventDefault();
      setTarget(link.href);
    };
    window.addEventListener("beforeunload", unload);
    document.addEventListener("click", click);
    return () => {
      window.removeEventListener("beforeunload", unload);
      document.removeEventListener("click", click);
    };
  }, [state]);
  const cancel = () => {
    setTarget(null);
    if (blocker.state === "blocked") blocker.reset();
  };
  return (
    <Context
      value={{
        register,
        afterSave: (href) => {
          allow.current = true;
          window.location.replace(href);
        },
      }}
    >
      {children}
      <Dialog
        open={!!target || blocker.state === "blocked"}
        onOpenChange={(open) => {
          if (!open) cancel();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {pending ? "操作正在进行" : "放弃未保存的修改？"}
            </DialogTitle>
            <DialogDescription>
              {pending
                ? "请等待当前操作完成后再离开，离开页面不代表取消服务端操作。"
                : "离开后将丢失当前草稿，已保存的数据不受影响。"}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={cancel}>
              继续停留
            </Button>
            {!pending && (
              <Button
                variant="destructive"
                onClick={() => {
                  if (target) {
                    allow.current = true;
                    window.location.assign(target);
                  } else if (blocker.state === "blocked") blocker.proceed();
                }}
              >
                放弃并离开
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Context>
  );
}
