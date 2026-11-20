import { ThemeContext, type Appearance } from "@/app/theme";
import { useEffect, useLayoutEffect, useState, type ReactNode } from "react";

const storageKey = "antcdp.console.appearance";
const systemScheme = "(prefers-color-scheme: dark)";

function preference(): Appearance {
  try {
    const saved = localStorage.getItem(storageKey);
    if (saved === "light" || saved === "dark" || saved === "system")
      return saved;
  } catch {}
  return "system";
}

export function ConsoleThemeProvider({ children }: { children: ReactNode }) {
  const [appearance, setPreference] = useState(preference);
  const [systemDark, setSystemDark] = useState(
    () => matchMedia(systemScheme).matches,
  );
  const resolved =
    appearance === "system" ? (systemDark ? "dark" : "light") : appearance;

  useEffect(() => {
    const media = matchMedia(systemScheme);
    const update = (event: MediaQueryListEvent) => setSystemDark(event.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useLayoutEffect(() => {
    const root = document.documentElement;
    const dark = root.classList.contains("dark");
    const initial = root.dataset.appearance;
    const scheme = root.style.colorScheme;
    return () => {
      root.classList.toggle("dark", dark);
      if (initial === undefined) delete root.dataset.appearance;
      else root.dataset.appearance = initial;
      root.style.colorScheme = scheme;
    };
  }, []);

  useLayoutEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", resolved === "dark");
    root.dataset.appearance = appearance;
    root.style.colorScheme = resolved;
  }, [appearance, resolved]);

  function setAppearance(next: Appearance) {
    setPreference(next);
    try {
      localStorage.setItem(storageKey, next);
    } catch {}
  }

  return (
    <ThemeContext
      value={{
        appearance,
        resolved,
        setAppearance,
        cycle: () =>
          setAppearance(
            appearance === "light"
              ? "dark"
              : appearance === "dark"
                ? "system"
                : "light",
          ),
      }}
    >
      {children}
    </ThemeContext>
  );
}
