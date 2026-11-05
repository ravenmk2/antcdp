import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
export function verify(directory, base) {
  const dir = resolve(root, directory);
  const html = readFileSync(resolve(dir, "index.html"), "utf8");
  assert(html.includes('id="root"'), "React entry missing");
  const manifest = JSON.parse(readFileSync(resolve(dir, "ui-build.json"), "utf8"));
  assert.equal(manifest.base, base);
  assert.equal(manifest.framework, "react");
  assert(new RegExp(manifest.business_routes).test("/admin/users"));
  assert(!existsSync(resolve(dir, "next")), "Unexpected second frontend build");
  for (const match of html.matchAll(/(?:src|href)="([^"#]+)"/g)) {
    const url = match[1];
    assert(url.startsWith(base) && !url.startsWith("//"), `Unexpected base: ${url}`);
    const file = url.slice(base.length).split("?")[0];
    assert(existsSync(resolve(dir, file)), `Missing asset: ${file}`);
  }
  for (const icon of [
    "gitlab",
    "jenkins",
    "openobserve",
    "elasticsearch",
    "mysql",
    "postgresql",
  ])
    assert(
      existsSync(resolve(dir, "service-icons", icon + ".svg")),
      "Missing service icon: " + icon,
    );
  console.log(`Verified ${directory} at ${base}`);
}
verify("web/dist", "/");
