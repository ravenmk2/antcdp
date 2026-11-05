import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type Appearance = "light" | "dark" | "system";
interface ThemeValue {
  appearance: Appearance;
  resolved: "light" | "dark";
  setAppearance: (value: Appearance) => void;
  cycle: () => void;
}

const ThemeContext = createContext<ThemeValue | null>(null);
const storageKey = "antcdp.appearance";

function preference(): Appearance {
  try {
    const value = localStorage.getItem(storageKey);
    if (value === "light" || value === "dark" || value === "system")
      return value;
  } catch {}
  return "system";
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [appearance, setAppearanceState] = useState<Appearance>(preference);
  const [systemDark, setSystemDark] = useState(
    () => matchMedia("(prefers-color-scheme: dark)").matches,
  );
  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const update = (event: MediaQueryListEvent) => setSystemDark(event.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  const resolved =
    appearance === "system" ? (systemDark ? "dark" : "light") : appearance;
  useEffect(() => {
    document.documentElement.classList.toggle("dark", resolved === "dark");
    document.documentElement.dataset.appearance = appearance;
    document.documentElement.style.colorScheme = resolved;
    const favicon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (favicon)
      favicon.href = resolved === "dark" ? "/logo-inverse.svg" : "/logo.svg";
  }, [appearance, resolved]);
  const value = useMemo<ThemeValue>(
    () => ({
      appearance,
      resolved,
      setAppearance: (next) => {
        setAppearanceState(next);
        try {
          localStorage.setItem(storageKey, next);
        } catch {}
      },
      cycle: () => {
        const next: Appearance =
          appearance === "light"
            ? "dark"
            : appearance === "dark"
              ? "system"
              : "light";
        setAppearanceState(next);
        try {
          localStorage.setItem(storageKey, next);
        } catch {}
      },
    }),
    [appearance, resolved],
  );
  return <ThemeContext value={value}>{children}</ThemeContext>;
}

export function useTheme() {
  const value = useContext(ThemeContext);
  if (!value) throw new Error("ThemeProvider is required");
  return value;
}

export const appearanceLabels: Record<Appearance, string> = {
  light: "浅色",
  dark: "深色",
  system: "跟随电脑",
};
