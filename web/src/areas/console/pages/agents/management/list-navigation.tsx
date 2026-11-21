import {
  createContext,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import { Outlet, useLocation, useNavigationType } from "react-router";

type ListPosition = { search: string; scroll: number; key: string };
const ListMemory = createContext<{ current: ListPosition | null } | null>(null);

export function AgentManagementRoutes() {
  const memory = useRef<ListPosition | null>(null);
  return (
    <ListMemory value={memory}>
      <Outlet />
    </ListMemory>
  );
}

export function useAgentListReturn() {
  const memory = useContext(ListMemory);
  return "/admin/agents" + (memory?.current?.search ?? "");
}

export function useAgentListPosition(
  loaded: boolean,
  listBody: RefObject<HTMLDivElement | null>,
) {
  const memory = useContext(ListMemory);
  const location = useLocation();
  const navigation = useNavigationType();
  const [restore] = useState(() => {
    const previous = memory?.current;
    if (
      previous?.search !== location.search ||
      location.pathname !== "/admin/agents"
    )
      return 0;
    return location.state?.restoreList ||
      (navigation === "POP" && previous.key === location.key)
      ? previous.scroll
      : 0;
  });
  const restored = useRef(false);
  useLayoutEffect(() => {
    if (!loaded || restored.current) return;
    restored.current = true;
    if (restore && listBody.current) listBody.current.scrollTop = restore;
    if (location.state?.focusCreate)
      document
        .getElementById("agent-new-trigger")
        ?.focus({ preventScroll: true });
  }, [loaded, restore, location.state, listBody]);
  return () => {
    if (memory)
      memory.current = {
        search: location.search,
        scroll: listBody.current?.scrollTop ?? 0,
        key: location.key,
      };
  };
}
