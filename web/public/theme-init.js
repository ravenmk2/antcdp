(() => {
  let value = "system";
  try {
    value = localStorage.getItem("antcdp.appearance") || value;
  } catch {}
  if (value !== "light" && value !== "dark") value = "system";
  const dark =
    value === "dark" ||
    (value === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
  document.documentElement.dataset.appearance = value;
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
  const favicon = document.querySelector('link[rel="icon"]');
  if (favicon) favicon.href = dark ? "/logo-inverse.svg" : "/logo.svg";
})();
