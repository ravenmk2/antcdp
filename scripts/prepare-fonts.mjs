import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, copyFile, rm, cp } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve } from "node:path";

const web = fileURLToPath(new URL("../web/", import.meta.url));
const weights = [400, 500, 600, 700];
const licenseURL =
  "https://hyperos.mi.com/font-download/MiSans%E5%AD%97%E4%BD%93%E7%9F%A5%E8%AF%86%E4%BA%A7%E6%9D%83%E8%AE%B8%E5%8F%AF%E5%8D%8F%E8%AE%AE.pdf";
export const sha256 = (bytes) =>
  createHash("sha256").update(bytes).digest("hex");

async function download(url) {
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(60000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
      return Buffer.from(await response.arrayBuffer());
    } catch (error) {
      if (attempt === 2) throw error;
    }
  }
}

export function parseFaces(css, weight) {
  const faces = [...css.matchAll(/@font-face\s*\{([^}]+)\}/g)].map(
    ([, body]) => {
      const url = body.match(
        /url\("(https:\/\/cdn-file\.hyperos\.mi\.com\/mi-font-service\/misans\/[^"\s]+\.woff2)"\)/,
      )?.[1];
      const unicodeRange = body.match(/unicode-range:\s*([^;]+);/)?.[1];
      if (
        !url ||
        !unicodeRange ||
        !/^U\+[\da-f?]+(?:-[\da-f]+)?(?:,\s*U\+[\da-f?]+(?:-[\da-f]+)?)*$/i.test(
          unicodeRange,
        ) ||
        !body.includes(`font-weight: ${weight};`)
      ) {
        throw new Error(`Unexpected MiSans CSS for weight ${weight}`);
      }
      return { weight, unicodeRange, url };
    },
  );
  if (!faces.length) throw new Error("MiSans CSS has no font faces");
  return faces;
}

export function fontCSS(faces) {
  return (
    "/* AntCDP uses MiSans by Xiaomi. See /fonts/misans/license.pdf. */\n" +
    faces
      .map(
        (face) =>
          `@font-face {\n  font-family: "MiSans";\n  font-style: normal;\n  font-weight: ${face.weight};\n  font-display: swap;\n  src: url("/fonts/misans/${face.sha256}.woff2") format("woff2");\n  unicode-range: ${face.unicodeRange};\n}\n`,
      )
      .join("\n")
  );
}

async function parallel(items, action) {
  let index = 0;
  const results = await Promise.allSettled(
    Array.from({ length: 8 }, async () => {
      while (index < items.length) await action(items[index++]);
    }),
  );
  // Drain every worker before the caller removes the staging directory.
  const failure = results.find((result) => result.status === "rejected");
  if (failure) throw failure.reason;
}

export async function prepareFonts(update = false, directory = web) {
  const cache = resolve(directory, ".cache/misans");
  const output = resolve(directory, "public/fonts/misans");
  const staging = resolve(directory, "public/fonts/misans-staging");
  const lockPath = resolve(directory, "fonts.lock.json");
  await mkdir(cache, { recursive: true });
  let lock;
  if (update) {
    const faces = [];
    const sources = [];
    for (const weight of weights) {
      const url = `https://font.sec.miui.com/font/css?family=MiSans:${weight}:Chinese_Simplify,Latin&display=swap`;
      sources.push(url);
      faces.push(...parseFaces((await download(url)).toString("utf8"), weight));
    }
    lock = { version: 1, sources, license: { url: licenseURL }, faces };
  } else {
    lock = JSON.parse(await readFile(lockPath, "utf8"));
    if (lock.version !== 1 || !lock.faces.length)
      throw new Error("Invalid MiSans lock file");
  }
  await rm(staging, { recursive: true, force: true });
  await mkdir(staging, { recursive: true });
  try {
    await parallel([...lock.faces, lock.license], async (asset) => {
      const font = asset !== lock.license;
      let bytes;
      if (!update) {
        if (!/^[a-f0-9]{64}$/.test(asset.sha256))
          throw new Error("Missing font checksum");
        try {
          bytes = await readFile(resolve(cache, asset.sha256));
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
        }
        if (bytes && sha256(bytes) !== asset.sha256) bytes = undefined;
      }
      bytes ??= await download(asset.url);
      if (bytes.subarray(0, 4).toString() !== (font ? "wOF2" : "%PDF"))
        throw new Error(`Invalid asset: ${asset.url}`);
      const hash = sha256(bytes);
      if (!update && hash !== asset.sha256)
        throw new Error(`MiSans checksum mismatch: ${asset.url}`);
      asset.sha256 = hash;
      await writeFile(resolve(cache, hash), bytes);
      await copyFile(
        resolve(cache, hash),
        resolve(staging, font ? `${hash}.woff2` : "license.pdf"),
      );
    });
    await writeFile(resolve(staging, "fonts.css"), fontCSS(lock.faces));
    await writeFile(
      resolve(staging, "NOTICE.txt"),
      "AntCDP uses MiSans fonts by Xiaomi.\nSource: https://hyperos.mi.com/font/\nLicense: license.pdf (distributed with this application).\nFont files are unmodified official WOFF2 subsets.\n",
    );
    // Publish only after every asset passes validation; a failed build keeps the previous set.
    // Copy immutable assets before the stylesheet. Avoid directory renames, which
    // Windows file watchers can prevent while the development server is running.
    await mkdir(output, { recursive: true });
    await cp(staging, output, {
      recursive: true,
      filter: (source) => !source.endsWith("fonts.css"),
    });
    await copyFile(resolve(staging, "fonts.css"), resolve(output, "fonts.css"));
    if (update) await writeFile(lockPath, JSON.stringify(lock, null, 2) + "\n");
    console.log(
      `Prepared ${lock.faces.length} MiSans subsets (400/500/600/700) and license`,
    );
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  await prepareFonts(process.argv.includes("--update-lock"));
}
