import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { fontCSS, sha256 } from "./prepare-fonts.mjs";
const root = fileURLToPath(new URL("../", import.meta.url));
export function verify(directory, base) {
  const dir = resolve(root, directory);
  const html = readFileSync(resolve(dir, "index.html"), "utf8");
  assert(html.includes('id="root"'), "React entry missing");
  const manifest = JSON.parse(
    readFileSync(resolve(dir, "ui-build.json"), "utf8"),
  );
  assert.equal(manifest.base, base);
  assert.equal(manifest.framework, "react");
  assert(new RegExp(manifest.business_routes).test("/admin/users"));
  assert(!existsSync(resolve(dir, "next")), "Unexpected second frontend build");
  for (const match of html.matchAll(/(?:src|href)="([^"#]+)"/g)) {
    const url = match[1];
    assert(
      url.startsWith(base) && !url.startsWith("//"),
      `Unexpected base: ${url}`,
    );
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
  const fonts = JSON.parse(
    readFileSync(resolve(root, "web/fonts.lock.json"), "utf8"),
  );
  const fontDirectory = resolve(dir, "fonts/misans");
  assert.equal(
    readFileSync(resolve(fontDirectory, "fonts.css"), "utf8"),
    fontCSS(fonts.faces),
  );
  for (const font of fonts.faces) {
    assert.equal(
      sha256(readFileSync(resolve(fontDirectory, `${font.sha256}.woff2`))),
      font.sha256,
    );
  }
  assert.equal(
    sha256(readFileSync(resolve(fontDirectory, "license.pdf"))),
    fonts.license.sha256,
  );
  console.log(`Verified ${directory} at ${base}`);
}
verify("web/dist", "/");
