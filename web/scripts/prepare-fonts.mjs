import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir, rm, rename } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const webRoot = fileURLToPath(new URL("../", import.meta.url));
export const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

// Never trust a cached response without checking the committed digest.
export async function verifiedResource(resource, cacheDir, download = fetch) {
  const cachePath = resolve(cacheDir, resource.sha256);
  try {
    const cached = await readFile(cachePath);
    if (sha256(cached) === resource.sha256) return cached;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  let lastError;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await download(resource.url, { signal: AbortSignal.timeout(30_000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const bytes = Buffer.from(await response.arrayBuffer());
      if (sha256(bytes) !== resource.sha256) throw new Error("SHA-256 mismatch");
      await mkdir(cacheDir, { recursive: true });
      await writeFile(cachePath, bytes);
      return bytes;
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(`MiSans resource unavailable or changed: ${resource.url}`, { cause: lastError });
}

export function localStylesheet(css, resources) {
  const fontPaths = new Map(resources.filter((r) => r.kind === "font").map((r) => [r.url, `${r.sha256}.woff2`]));
  let faces = 0;
  const result = css.replace(/src\s*:[^;]+;/g, (source) => {
    const url = source.match(/url\("([^\"]+\.woff2)"\)/)?.[1];
    const path = fontPaths.get(url);
    if (!path) throw new Error("Unpinned font reference in MiSans CSS");
    faces++;
    return `src: url("./${path}") format("woff2");`;
  }).replace(/font-weight:\s*600;/g, "font-weight: 550 600;");
  if (!faces || /https?:|@import|local\(/i.test(result)) throw new Error("Unexpected external reference in MiSans CSS");
  return `/* AntCDP uses MiSans. Copyright and license: ./license.pdf */\n${result}`;
}

export async function prepareFonts() {
  const lock = JSON.parse(await readFile(resolve(webRoot, "fonts.lock.json"), "utf8"));
  if (lock.version !== 1 || !lock.resources.length) throw new Error("Invalid font lockfile");
  for (const resource of lock.resources) {
    if (!/^[a-f0-9]{64}$/.test(resource.sha256) || !resource.url.startsWith("https://")) throw new Error("Invalid font resource");
  }
  const cacheDir = resolve(webRoot, ".cache/fonts");
  const downloaded = new Map();
  const pending = [...lock.resources];
  const workers = await Promise.allSettled(Array.from({ length: 8 }, async () => {
    while (pending.length) {
      const resource = pending.shift();
      downloaded.set(resource.url, await verifiedResource(resource, cacheDir));
    }
  }));
  const failed = workers.find((worker) => worker.status === "rejected");
  if (failed) throw failed.reason;
  const cssResource = lock.resources.find((r) => r.kind === "css");
  const license = lock.resources.find((r) => r.kind === "license");
  const css = localStylesheet(downloaded.get(cssResource.url).toString("utf8"), lock.resources);
  // Both paths are fixed children of web/public/fonts; never accept user paths for cleanup.
  const target = resolve(webRoot, "public/fonts/misans");
  const staging = resolve(webRoot, "public/fonts/misans-staging");
  await rm(staging, { recursive: true, force: true });
  await mkdir(staging, { recursive: true });
  for (const resource of lock.resources.filter((r) => r.kind === "font")) {
    await writeFile(resolve(staging, `${resource.sha256}.woff2`), downloaded.get(resource.url));
  }
  await writeFile(resolve(staging, "fonts.css"), css);
  await writeFile(resolve(staging, "license.pdf"), downloaded.get(license.url));
  await writeFile(resolve(staging, "NOTICE.txt"), "AntCDP uses MiSans fonts.\nCopyright Xiaomi Inc. All rights reserved.\nSource: https://hyperos.mi.com/font/zh/\nSee license.pdf for the original MiSans Font Intellectual Property License Agreement.\n");
  await mkdir(dirname(target), { recursive: true });
  await rm(target, { recursive: true, force: true });
  await rename(staging, target);
  console.log(`MiSans: ${lock.resources.filter((r) => r.kind === "font").length} verified WOFF2 files ready (same-origin, no runtime CDN).`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await prepareFonts();
}
