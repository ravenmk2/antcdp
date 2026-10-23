import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import assert from "node:assert/strict";
import test from "node:test";

const bootstrap = readFileSync(new URL("../public/theme-init.js", import.meta.url), "utf8");
function load({ saved = null, systemDark = false, storageBlocked = false } = {}) {
  const classes = new Set();
  const root = {
    classList: { toggle: (name, enabled) => enabled ? classes.add(name) : classes.delete(name) },
    dataset: {}, style: {},
  };
  runInNewContext(bootstrap, {
    document: { documentElement: root },
    localStorage: { getItem: () => {
      if (storageBlocked) throw new Error("Storage unavailable");
      return saved;
    } },
    matchMedia: () => ({ matches: systemDark }),
  });
  return { preference: root.dataset.appearance, dark: classes.has("dark"), scheme: root.style.colorScheme };
}

test("first visit follows a light system before rendering", () => {
  assert.deepEqual(load(), { preference: "system", dark: false, scheme: "light" });
});
test("first visit follows a dark system before rendering", () => {
  assert.deepEqual(load({ systemDark: true }), { preference: "system", dark: true, scheme: "dark" });
});
test("saved light preference wins over a dark system on refresh", () => {
  assert.deepEqual(load({ saved: "light", systemDark: true }), { preference: "light", dark: false, scheme: "light" });
});
test("saved dark preference wins over a light system on refresh", () => {
  assert.deepEqual(load({ saved: "dark" }), { preference: "dark", dark: true, scheme: "dark" });
});
test("explicit system preference follows the current OS", () => {
  assert.deepEqual(load({ saved: "system", systemDark: true }), { preference: "system", dark: true, scheme: "dark" });
});
test("invalid stored preferences fall back to the system", () => {
  assert.deepEqual(load({ saved: "invalid", systemDark: true }), { preference: "system", dark: true, scheme: "dark" });
});
test("blocked storage does not prevent rendering the system theme", () => {
  assert.deepEqual(load({ storageBlocked: true, systemDark: true }), { preference: "system", dark: true, scheme: "dark" });
});
