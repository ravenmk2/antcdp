import { createContext, useContext, useState, type ReactNode } from "react";

const Presence = createContext<{
  open: boolean;
  onExitComplete: () => void;
} | null>(null);

// Keep conditional editors (and their local form state) mounted through exit.
// The Drawer owns the animation; this boundary owns the editor's lifetime.
export function OverlayPresence({ children }: { children: ReactNode }) {
  const [previous, setPrevious] = useState(children);
  const [retained, setRetained] = useState(children);
  if (children !== previous) {
    setPrevious(children);
    if (children) setRetained(children);
  }
  const open = Boolean(children);
  return (
    <Presence.Provider
      value={{
        open,
        onExitComplete: () => {
          if (!open) setRetained(null);
        },
      }}
    >
      {children || retained}
    </Presence.Provider>
  );
}

export function useOverlayPresence() {
  return useContext(Presence);
}
