import { createContext, useContext } from "react";

// Only the mounted install flow can hold its success page; nothing is persisted.
export const SetupCompletionContext = createContext<(() => void) | null>(null);

export function useSetupCompletion() {
  return useContext(SetupCompletionContext);
}
