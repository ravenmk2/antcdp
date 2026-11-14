import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(
  new URL("../public/theme-init.js", import.meta.url),
  "utf8",
);
function run(preference, systemDark) {
  const classes = new Set();
  const root = {
    classList: {
      toggle: (_name, enabled) =>
        enabled ? classes.add("dark") : classes.delete("dark"),
    },
    dataset: {},
    style: {},
  };
  const context = {
    localStorage: { getItem: () => preference },
    matchMedia: () => ({ matches: systemDark }),
    document: { documentElement: root, querySelector: () => null },
  };
  vm.runInNewContext(source, context);
  return {
    dark: classes.has("dark"),
    preference: root.dataset.appearance,
    scheme: root.style.colorScheme,
  };
}
test("appearance supports light, dark and system", () => {
  assert.deepEqual(run("light", true), {
    dark: false,
    preference: "light",
    scheme: "light",
  });
  assert.deepEqual(run("dark", false), {
    dark: true,
    preference: "dark",
    scheme: "dark",
  });
  assert.deepEqual(run("system", true), {
    dark: true,
    preference: "system",
    scheme: "dark",
  });
  assert.deepEqual(run("system", false), {
    dark: false,
    preference: "system",
    scheme: "light",
  });
});
test("invalid preferences fall back to system without storing credentials", () => {
  assert.equal(run("unexpected", false).preference, "system");
  assert(!source.includes("antcdp_session"));
});
