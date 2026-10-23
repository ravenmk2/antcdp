// Run before styles and Vue to avoid a flash of the opposite appearance.
(function () {
  var preference = "system";
  try {
    var saved = localStorage.getItem("antcdp.appearance");
    if (saved === "light" || saved === "dark") preference = saved;
  } catch (_) {
    // Appearance remains usable when browser storage is unavailable.
  }
  var dark = preference === "dark" ||
    (preference === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  var root = document.documentElement;
  root.classList.toggle("dark", dark);
  root.dataset.appearance = preference;
  root.style.colorScheme = dark ? "dark" : "light";
})();
