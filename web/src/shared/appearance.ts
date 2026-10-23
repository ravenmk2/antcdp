import { readonly, ref } from "vue";

export type Appearance = "system" | "light" | "dark";
const storageKey = "antcdp.appearance";
const system = window.matchMedia("(prefers-color-scheme: dark)");
function valid(value: unknown): Appearance {
  return value === "light" || value === "dark" ? value : "system";
}
const preference = ref<Appearance>(valid(document.documentElement.dataset.appearance));

function apply() {
  const dark = preference.value === "dark" ||
    (preference.value === "system" && system.matches);
  const root = document.documentElement;
  root.classList.toggle("dark", dark);
  root.dataset.appearance = preference.value;
  root.style.colorScheme = dark ? "dark" : "light";
  const favicon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (favicon) favicon.href = dark ? "/logo-inverse.svg" : "/logo.svg";
}

system.addEventListener("change", apply);
window.addEventListener("storage", (event) => {
  if (event.key !== storageKey && event.key !== null) return;
  preference.value = valid(event.newValue);
  apply();
});
apply();

export function useAppearance() {
  function setAppearance(value: Appearance) {
    preference.value = valid(value);
    apply();
    try {
      localStorage.setItem(storageKey, preference.value);
    } catch {
      // The current page still follows the selection without persistence.
    }
  }
  return { preference: readonly(preference), setAppearance };
}
