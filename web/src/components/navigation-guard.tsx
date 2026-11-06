import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useBlocker } from "react-router";
import { ConfirmDialog } from "./overlays";

type Register = (active: boolean, allowTabChange: boolean) => () => void;
const NavigationGuardContext = createContext<Register | null>(null);

export function NavigationGuardProvider({ children }: { children: ReactNode }) {
  const active = useRef(new Map<symbol, boolean>());
  const [open, setOpen] = useState(false);
  const blocker = useBlocker(({ currentLocation, nextLocation }) => {
    const current = new URLSearchParams(currentLocation.search);
    const next = new URLSearchParams(nextLocation.search);
    current.delete("tab");
    next.delete("tab");
    const onlyTabChanged =
      currentLocation.pathname === nextLocation.pathname &&
      currentLocation.hash === nextLocation.hash &&
      current.toString() === next.toString();
    return Array.from(active.current.values()).some(
      (allowTabChange) => !allowTabChange || !onlyTabChanged,
    );
  });
  useEffect(() => {
    if (blocker.state === "blocked") setOpen(true);
  }, [blocker.state]);
  const register = useCallback<Register>((enabled, allowTabChange) => {
    const token = Symbol("unsaved");
    if (enabled) active.current.set(token, allowTabChange);
    return () => {
      active.current.delete(token);
    };
  }, []);
  return (
    <NavigationGuardContext value={register}>
      {children}
      <ConfirmDialog
        open={open}
        title="离开当前页面？"
        description="当前有未保存的修改或正在执行的操作。离开不会取消已经提交的远端请求。"
        confirmLabel="放弃修改并离开"
        danger
        onClose={() => {
          setOpen(false);
          if (blocker.state === "blocked") blocker.reset();
        }}
        onConfirm={() => {
          setOpen(false);
          active.current.clear();
          if (blocker.state === "blocked") blocker.proceed();
        }}
      />
    </NavigationGuardContext>
  );
}

export function useNavigationGuard(active: boolean, allowTabChange = false) {
  const register = useContext(NavigationGuardContext);
  const release = useRef<(() => void) | null>(null);
  useEffect(() => {
    if (!register || !active) return;
    const unregister = register(true, allowTabChange);
    release.current = unregister;
    return () => {
      unregister();
      if (release.current === unregister) release.current = null;
    };
  }, [register, active, allowTabChange]);
  return useCallback(() => release.current?.(), []);
}
