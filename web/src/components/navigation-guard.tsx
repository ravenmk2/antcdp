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
const NavigationGuardViewContext = createContext<{
  open: boolean;
  cancel: () => void;
  confirm: () => void;
} | null>(null);
const NavigationGuardContext = createContext<Register | null>(null);

export function NavigationGuardProvider({
  children,
  host = true,
}: {
  children: ReactNode;
  host?: boolean;
}) {
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
    <NavigationGuardViewContext
      value={{
        open,
        cancel: () => {
          setOpen(false);
          if (blocker.state === "blocked") blocker.reset();
        },
        confirm: () => {
          setOpen(false);
          active.current.clear();
          if (blocker.state === "blocked") blocker.proceed();
        },
      }}
    >
      <NavigationGuardContext value={register}>
        {children}
        {host && <NavigationGuardHost />}
      </NavigationGuardContext>
    </NavigationGuardViewContext>
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

export function NavigationGuardHost() {
  const state = useContext(NavigationGuardViewContext);
  if (!state) return null;
  const { open, cancel, confirm } = state;
  return (
    <ConfirmDialog
      open={open}
      title="离开当前页面？"
      description="当前有未保存的修改或正在执行的操作。离开不会取消已经提交的远端请求。"
      confirmLabel="放弃修改并离开"
      danger
      onClose={cancel}
      onConfirm={confirm}
    />
  );
}
