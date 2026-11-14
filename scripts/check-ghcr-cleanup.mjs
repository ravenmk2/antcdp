import { createHash } from "node:crypto";
import { appendFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const API = "https://api.github.com";
const REGISTRY = "https://ghcr.io";
const DIGEST = /^sha256:[a-f0-9]{64}$/;
const TAG = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/;
const INDEX = new Set([
  "application/vnd.oci.image.index.v1+json",
  "application/vnd.docker.distribution.manifest.list.v2+json",
]);
const IMAGE = new Set([
  "application/vnd.oci.image.manifest.v1+json",
  "application/vnd.docker.distribution.manifest.v2+json",
]);
const MEDIA = new Set([...INDEX, ...IMAGE]);
const MAX_BYTES = 5 * 1024 * 1024;
const MAX_PAGES = 1000;

class UnsafeCleanup extends Error {}
function requireSafe(condition, reason) {
  if (!condition) throw new UnsafeCleanup(reason);
}
function object(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function descriptor(value) {
  let inline = true;
  if (object(value) && value.data !== undefined) {
    if (typeof value.data !== "string") return false;
    const bytes = Buffer.from(value.data, "base64");
    inline =
      bytes.toString("base64") === value.data &&
      bytes.length === value.size &&
      `sha256:${createHash("sha256").update(bytes).digest("hex")}` ===
        value.digest;
  }
  return (
    object(value) &&
    DIGEST.test(value.digest) &&
    Number.isSafeInteger(value.size) &&
    value.size >= 0 &&
    typeof value.mediaType === "string" &&
    value.mediaType.length > 0 &&
    value.urls === undefined &&
    inline
  );
}

// Every request is GET, uses a fixed service origin and refuses redirects.
// Response bodies and exception messages are never included in diagnostics.
async function readJSON(fetchImpl, url, headers, timeoutMs, label) {
  const controller = new AbortController();
  let timer;
  try {
    return await Promise.race([
      (async () => {
        const response = await fetchImpl(url, {
          method: "GET",
          headers,
          redirect: "error",
          signal: controller.signal,
        });
        requireSafe(
          response.status === 200 && !response.redirected,
          `${label}: expected HTTP 200 without a redirect.`,
        );
        requireSafe(
          !response.url || response.url === String(url),
          `${label}: unexpected response URL.`,
        );
        requireSafe(response.body, `${label}: response body is missing.`);
        const chunks = [];
        let size = 0;
        for await (const chunk of response.body) {
          size += chunk.byteLength;
          requireSafe(size <= MAX_BYTES, `${label}: response is too large.`);
          chunks.push(chunk);
        }
        const bytes = Buffer.concat(chunks);
        let data;
        try {
          data = JSON.parse(bytes.toString("utf8"));
        } catch {
          throw new UnsafeCleanup(`${label}: invalid JSON.`);
        }
        return { data, bytes, headers: response.headers };
      })(),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new UnsafeCleanup(`${label}: request timed out.`));
        }, timeoutMs);
      }),
    ]);
  } catch (error) {
    if (error instanceof UnsafeCleanup) throw error;
    throw new UnsafeCleanup(`${label}: request failed.`);
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

async function versions(fetchImpl, endpoint, headers, timeoutMs) {
  const rows = [];
  const ids = new Set(),
    digests = new Set(),
    tags = new Set();
  for (let page = 1; page <= MAX_PAGES; page++) {
    const url = `${API}${endpoint}?state=active&per_page=100&page=${page}`;
    const response = await readJSON(
      fetchImpl,
      url,
      headers,
      timeoutMs,
      "Package versions",
    );
    requireSafe(
      Array.isArray(response.data) && response.data.length <= 100,
      "Package versions: invalid page.",
    );
    for (const row of response.data) {
      requireSafe(
        object(row) &&
          Number.isSafeInteger(row.id) &&
          row.id > 0 &&
          DIGEST.test(row.name) &&
          row.metadata?.package_type === "container" &&
          Array.isArray(row.metadata?.container?.tags),
        "Package versions: invalid container version.",
      );
      requireSafe(
        !ids.has(row.id) && !digests.has(row.name),
        "Package versions: duplicate version or digest across pages.",
      );
      const rowTags = row.metadata.container.tags;
      for (const tag of rowTags) {
        requireSafe(
          typeof tag === "string" && TAG.test(tag) && !tags.has(tag),
          "Package versions: invalid or duplicate tag.",
        );
        tags.add(tag);
      }
      ids.add(row.id);
      digests.add(row.name);
      rows.push({ id: row.id, digest: row.name, tags: [...rowTags].sort() });
    }
    // Build each page URL ourselves; GitHub may normalize its Link URLs.
    // Never follow Link or let its shape decide whether cleanup is safe.
    // Probe until an empty page, including after short pages, to avoid truncation.
    if (response.data.length === 0) return rows;
  }
  throw new UnsafeCleanup("Package pagination: page limit exceeded.");
}

function inventory(rows) {
  return JSON.stringify([...rows].sort((a, b) => a.id - b.id));
}

/** Read-only gate for deleting untagged versions, never a deletion operation. */
export async function checkGhcrCleanup({
  repository,
  actor,
  token,
  expectedDevDigest,
  mode = "published",
  fetchImpl = globalThis.fetch,
  timeoutMs = 20_000,
} = {}) {
  try {
    requireSafe(
      typeof repository === "string" &&
        /^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9_.-]+$/.test(repository) &&
        ![".", ".."].includes(repository.split("/")[1]),
      "Configuration: invalid GITHUB_REPOSITORY.",
    );
    requireSafe(
      typeof actor === "string" && /^[A-Za-z0-9_\[\]-]+$/.test(actor),
      "Configuration: invalid GITHUB_ACTOR.",
    );
    requireSafe(
      typeof token === "string" &&
        token.length > 0 &&
        !/[\s\p{Cc}]/u.test(token),
      "Configuration: missing or invalid GITHUB_TOKEN.",
    );
    requireSafe(
      ["published", "manual"].includes(mode),
      "Configuration: invalid GHCR_CLEANUP_MODE.",
    );
    requireSafe(
      mode === "manual" ||
        (typeof expectedDevDigest === "string" &&
          DIGEST.test(expectedDevDigest)),
      "Configuration: invalid EXPECTED_DEV_DIGEST.",
    );
    requireSafe(
      Number.isSafeInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 60_000,
      "Configuration: invalid request timeout.",
    );
    const [owner, name] = repository.toLowerCase().split("/");
    const apiHeaders = {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
    };
    const repo = (
      await readJSON(
        fetchImpl,
        `${API}/repos/${owner}/${name}`,
        apiHeaders,
        timeoutMs,
        "Repository owner",
      )
    ).data;
    requireSafe(
      object(repo) &&
        typeof repo.full_name === "string" &&
        repo.full_name.toLowerCase() === `${owner}/${name}` &&
        typeof repo.owner?.login === "string" &&
        repo.owner.login.toLowerCase() === owner &&
        ["User", "Organization"].includes(repo.owner.type),
      "Repository owner: unexpected repository or owner type.",
    );
    const endpoint = `/${repo.owner.type === "User" ? "users" : "orgs"}/${owner}/packages/container/${encodeURIComponent(name)}/versions`;
    const rows = await versions(fetchImpl, endpoint, apiHeaders, timeoutMs);
    const tagged = new Map(
      rows.filter((row) => row.tags.length).map((row) => [row.digest, row]),
    );
    // The manual workflow holds the publish lock and snapshots the current dev.
    // Published mode must still match the digest from that run's successful push.
    if (mode === "manual") {
      expectedDevDigest = rows.find((row) => row.tags.includes("dev"))?.digest;
      requireSafe(
        expectedDevDigest,
        "The dev tag is missing; cleanup is blocked.",
      );
    }
    requireSafe(
      rows.some(
        (row) => row.digest === expectedDevDigest && row.tags.includes("dev"),
      ),
      "The dev tag does not match this successful push.",
    );

    const authURL = new URL(`${REGISTRY}/token`);
    authURL.searchParams.set("service", "ghcr.io");
    authURL.searchParams.set("scope", `repository:${owner}/${name}:pull`);
    const auth = (
      await readJSON(
        fetchImpl,
        authURL.href,
        {
          Authorization: `Basic ${Buffer.from(`${actor}:${token}`).toString("base64")}`,
        },
        timeoutMs,
        "Registry authorization",
      )
    ).data;
    const registryToken = auth?.token || auth?.access_token;
    requireSafe(
      typeof registryToken === "string" &&
        registryToken.length > 0 &&
        !/[\s\p{Cc}]/u.test(registryToken) &&
        !(auth.token && auth.access_token && auth.token !== auth.access_token),
      "Registry authorization: invalid token response.",
    );
    const registryHeaders = {
      Accept: [...MEDIA].join(", "),
      Authorization: `Bearer ${registryToken}`,
    };
    async function manifest(reference, digest) {
      const response = await readJSON(
        fetchImpl,
        `${REGISTRY}/v2/${owner}/${name}/manifests/${reference}`,
        registryHeaders,
        timeoutMs,
        "Registry manifest",
      );
      const contentType = response.headers
        .get("content-type")
        ?.split(";")[0]
        .trim();
      requireSafe(
        response.headers.get("docker-content-digest") === digest &&
          `sha256:${createHash("sha256").update(response.bytes).digest("hex")}` ===
            digest,
        "Registry manifest: digest does not match the requested version.",
      );
      const data = response.data;
      requireSafe(
        object(data) &&
          data.schemaVersion === 2 &&
          MEDIA.has(data.mediaType) &&
          data.mediaType === contentType,
        "Registry manifest: unsupported or invalid format.",
      );
      let children = [];
      if (INDEX.has(data.mediaType)) {
        requireSafe(
          Array.isArray(data.manifests) &&
            data.manifests.length > 0 &&
            data.config === undefined &&
            data.layers === undefined,
          "Registry index: invalid child manifests.",
        );
        children = data.manifests;
      } else {
        requireSafe(
          data.manifests === undefined &&
            descriptor(data.config) &&
            Array.isArray(data.layers) &&
            data.layers.every(descriptor),
          "Registry image: invalid config or layers.",
        );
      }
      if (data.subject !== undefined) children = [...children, data.subject];
      requireSafe(
        children.every(
          (child) => descriptor(child) && MEDIA.has(child.mediaType),
        ),
        "Registry manifest: unsupported dependency descriptor.",
      );
      for (const child of children) {
        requireSafe(
          tagged.has(child.digest),
          "A tagged manifest references a missing or untagged manifest; cleanup is blocked.",
        );
      }
      return {
        mediaType: data.mediaType,
        size: response.bytes.length,
        children,
      };
    }

    const checked = new Map();
    checked.set(expectedDevDigest, await manifest("dev", expectedDevDigest));
    // All tagged nodes are checked, so every nested index is checked without recursion limits.
    for (const digest of tagged.keys()) {
      if (!checked.has(digest))
        checked.set(digest, await manifest(digest, digest));
    }
    for (const node of checked.values()) {
      for (const child of node.children) {
        const actual = checked.get(child.digest);
        requireSafe(
          actual?.mediaType === child.mediaType && actual.size === child.size,
          "Registry manifest: dependency descriptor differs from its content.",
        );
      }
    }
    requireSafe(
      inventory(rows) ===
        inventory(await versions(fetchImpl, endpoint, apiHeaders, timeoutMs)),
      "Package versions changed during the check; cleanup is blocked.",
    );
    await manifest("dev", expectedDevDigest);
    return {
      safe: true,
      reason:
        "All tagged manifests and their dependencies have independent tags.",
      taggedCount: tagged.size,
      versionCount: rows.length,
    };
  } catch (error) {
    return {
      safe: false,
      reason:
        error instanceof UnsafeCleanup
          ? error.message
          : "Unexpected cleanup check failure; cleanup is blocked.",
    };
  }
}

export async function runCli(env = process.env, check = checkGhcrCleanup) {
  let result;
  try {
    result = await check({
      repository: env.GITHUB_REPOSITORY,
      actor: env.GITHUB_ACTOR,
      token: env.GITHUB_TOKEN,
      expectedDevDigest: env.EXPECTED_DEV_DIGEST,
      mode: env.GHCR_CLEANUP_MODE ?? "published",
    });
  } catch {
    result = {
      safe: false,
      reason: "Unexpected cleanup check failure; cleanup is blocked.",
    };
  }
  const safe = result?.safe === true;
  if (!env.GITHUB_OUTPUT)
    throw new Error("GITHUB_OUTPUT is required to publish the cleanup gate.");
  await appendFile(env.GITHUB_OUTPUT, `safe=${safe}\n`, "utf8");
  if (safe)
    console.log(
      `GHCR cleanup check passed: ${result.taggedCount} tagged / ${result.versionCount} active versions.`,
    );
  else
    console.warn(
      `::warning::GHCR cleanup skipped: ${String(
        result?.reason || "Check failed.",
      )
        .replaceAll("%", "%25")
        .replaceAll("\r", "%0D")
        .replaceAll("\n", "%0A")}`,
    );
  return safe;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  runCli().catch(() => {
    console.error(
      "::error::Could not publish the GHCR cleanup gate; do not run cleanup.",
    );
    process.exitCode = 1;
  });
}
