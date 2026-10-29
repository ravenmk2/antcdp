import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { verifiedResource, localStylesheet, sha256 } from "../scripts/prepare-fonts.mjs";

test("verified font cache works offline; corrupt cache and changed upstream fail closed", async () => {
  const cache = await mkdtemp(join(tmpdir(), "antcdp-font-test-"));
  const bytes = Buffer.from("pinned font fixture");
  const resource = { url: "https://example.invalid/font.woff2", sha256: sha256(bytes) };
  let requests = 0;
  const unavailable = async () => { requests++; throw new Error("offline"); };
  try {
    await writeFile(join(cache, resource.sha256), bytes);
    assert.deepEqual(await verifiedResource(resource, cache, unavailable), bytes);
    assert.equal(requests, 0);
    await writeFile(join(cache, resource.sha256), "corrupt");
    await assert.rejects(verifiedResource(resource, cache, unavailable), /unavailable or changed/);
    assert.equal(requests, 3);
    await assert.rejects(verifiedResource(resource, cache, async () => new Response("changed upstream")), /unavailable or changed/);
    assert.deepEqual(await verifiedResource(resource, cache, async () => new Response(bytes)), bytes);
    assert.deepEqual(await readFile(join(cache, resource.sha256)), bytes);
  } finally {
    await rm(cache, { recursive: true, force: true });
  }
});

test("font CSS only references locked same-origin WOFF2 files and preserves character ranges", () => {
  const url = "https://example.invalid/font.woff2";
  const resources = [{ kind: "font", url, sha256: "a".repeat(64) }];
  const css = `@font-face { font-family: MiSans; font-weight: 600; font-display: swap; src: url("${url}") format("woff2"),url("https://example.invalid/font.ttf") format("truetype"); unicode-range: U+4E00-9FFF; }`;
  const local = localStylesheet(css, resources);
  assert.match(local, /font-weight: 550 600;/);
  assert.match(local, /font-display: swap;/);
  assert.match(local, /unicode-range: U\+4E00-9FFF;/);
  assert.ok(local.includes(`./${resources[0].sha256}.woff2`));
  assert.doesNotMatch(local, /https:|truetype/);
  assert.throws(() => localStylesheet(css, []), /Unpinned/);
  assert.throws(() => localStylesheet(`${css}\n@import "other.css";`, resources), /Unexpected/);
});
