import { useSyncExternalStore } from "react";
type Appearance = "system" | "light" | "dark";
const key = "antcdp.appearance";
const listeners = new Set<() => void>();
const system = window.matchMedia("(prefers-color-scheme: dark)");
const valid = (value: unknown): Appearance =>
  value === "light" || value === "dark" ? value : "system";
let value = valid(document.documentElement.dataset.appearance);
function apply() {
  const dark = value === "dark" || (value === "system" && system.matches);
  document.documentElement.classList.toggle("dark", dark);
  document.documentElement.dataset.appearance = value;
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
  listeners.forEach((listener) => listener());
}
system.addEventListener("change", apply);
window.addEventListener("storage", (event) => {
  if (event.key === key || event.key === null) {
    value = valid(event.newValue);
    apply();
  }
});
apply();
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export function useAppearance() {
  const appearance = useSyncExternalStore(subscribe, () => value);
  return {
    appearance,
    setAppearance(next: string) {
      value = valid(next);
      apply();
      try {
        localStorage.setItem(key, value);
      } catch {}
    },
  };
}
