import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseFaces, prepareFonts, sha256 } from "./prepare-fonts.mjs";

test("official CSS keeps Unicode coverage and rejects unexpected sources", () => {
  const css =
    '@font-face { font-weight: 400; src: url("https://cdn-file.hyperos.mi.com/mi-font-service/misans/400/test.woff2"); unicode-range: U+20-7E,U+4E00; }';
  assert.equal(parseFaces(css, 400)[0].unicodeRange, "U+20-7E,U+4E00");
  assert.throws(() =>
    parseFaces(css.replace("cdn-file.hyperos.mi.com", "example.com"), 400),
  );
  assert.throws(() => parseFaces(css, 500));
  assert.throws(() => parseFaces("", 400));
});

test("cached builds work offline; corrupt cache is repaired and upstream drift fails closed", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "antcdp-fonts-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const cache = join(dir, ".cache/misans");
  await mkdir(cache, { recursive: true });
  const font = Buffer.from("wOF2 test font");
  const license = Buffer.from("%PDF test license");
  const face = {
    weight: 400,
    unicodeRange: "U+20-7E",
    url: "https://example.com/font",
    sha256: sha256(font),
  };
  const lock = {
    version: 1,
    faces: [face],
    license: { url: "https://example.com/license", sha256: sha256(license) },
  };
  await writeFile(join(dir, "fonts.lock.json"), JSON.stringify(lock));
  await writeFile(join(cache, face.sha256), font);
  await writeFile(join(cache, lock.license.sha256), license);
  const request = t.mock.method(globalThis, "fetch", async () => {
    throw new Error("offline");
  });
  await prepareFonts(false, dir);
  assert.equal(request.mock.callCount(), 0);
  const cssPath = join(dir, "public/fonts/misans/fonts.css");
  const css = await readFile(cssPath, "utf8");
  assert.match(css, /font-display: swap/);
  assert.ok(css.includes(`/fonts/misans/${face.sha256}.woff2`));
  assert.ok(!css.includes("https://"));
  await writeFile(join(cache, face.sha256), "corrupt");
  request.mock.mockImplementation(async () => new Response(font));
  await prepareFonts(false, dir);
  assert.deepEqual(await readFile(join(cache, face.sha256)), font);
  await writeFile(join(cache, face.sha256), "corrupt again");
  request.mock.mockImplementation(
    async () => new Response("wOF2 changed upstream"),
  );
  await assert.rejects(prepareFonts(false, dir), /checksum mismatch/);
  assert.equal(await readFile(cssPath, "utf8"), css);
});
