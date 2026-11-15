import { createContext, useContext, useState, type ReactNode } from "react";

type Choice = { path: string[]; open: boolean };
const DisclosureContext = createContext<{
  path: string[];
  choices: Map<string, Choice>;
  change: (path: string[], open: boolean) => void;
}>({ path: [], choices: new Map(), change: () => {} });

/** Page-local user intent; automatic lifecycle changes never write here. */
export function DisclosureState({ children }: { children: ReactNode }) {
  const [choices, setChoices] = useState(new Map<string, Choice>());
  return (
    <DisclosureContext.Provider
      value={{
        path: [],
        choices,
        change: (path, open) =>
          setChoices((previous) =>
            new Map(previous).set(JSON.stringify(path), { path, open }),
          ),
      }}
    >
      {children}
    </DisclosureContext.Provider>
  );
}

export function DisclosureScope({
  id,
  children,
}: {
  id: string;
  children: ReactNode;
}) {
  const context = useContext(DisclosureContext);
  return (
    <DisclosureContext.Provider
      value={{ ...context, path: [...context.path, id] }}
    >
      {children}
    </DisclosureContext.Provider>
  );
}

export function useDisclosureState() {
  const { path, choices, change } = useContext(DisclosureContext);
  return {
    change: (id: string, open: boolean) => change([...path, id], open),
    expanded: (id: string, automatic: boolean) => {
      const target = [...path, id];
      const own = choices.get(JSON.stringify(target));
      if (own) return own.open;
      for (const choice of choices.values()) {
        if (
          !choice.open ||
          choice.path.length <= target.length ||
          !target.every((part, index) => choice.path[index] === part)
        )
          continue;
        // An explicitly closed ancestor hides its descendants, but retains
        // their choices so reopening it restores the previous combination.
        let visible = true;
        for (
          let length = target.length + 1;
          length < choice.path.length;
          length++
        )
          if (
            choices.get(JSON.stringify(choice.path.slice(0, length)))?.open ===
            false
          )
            visible = false;
        if (visible) return true;
      }
      return automatic;
    },
  };
}
