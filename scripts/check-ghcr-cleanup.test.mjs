import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { checkGhcrCleanup, runCli } from "./check-ghcr-cleanup.mjs";

const IMAGE = "application/vnd.oci.image.manifest.v1+json";
const INDEX = "application/vnd.oci.image.index.v1+json";
const DOCKER_IMAGE = "application/vnd.docker.distribution.manifest.v2+json";
const DOCKER_INDEX =
  "application/vnd.docker.distribution.manifest.list.v2+json";
const sha = (value) =>
  "sha256:" + createHash("sha256").update(value).digest("hex");
const blob = (
  name,
  mediaType = "application/vnd.oci.image.layer.v1.tar+gzip",
) => ({
  mediaType,
  digest: sha(name),
  size: name.length,
});
function document(data) {
  const body = JSON.stringify(data);
  return {
    body,
    data,
    digest: sha(body),
    descriptor: {
      mediaType: data.mediaType,
      digest: sha(body),
      size: Buffer.byteLength(body),
    },
  };
}
function image(name = "dev", mediaType = IMAGE) {
  return document({
    schemaVersion: 2,
    mediaType,
    config: blob(name + "-config", "application/vnd.oci.image.config.v1+json"),
    layers: [blob(name + "-layer")],
  });
}
function index(children, mediaType = INDEX) {
  return document({
    schemaVersion: 2,
    mediaType,
    manifests: children.map((child) => child.descriptor),
  });
}
function version(id, doc, tags = []) {
  return {
    id,
    name: doc.digest,
    metadata: { package_type: "container", container: { tags } },
  };
}
function json(data, options = {}) {
  return new Response(JSON.stringify(data), {
    headers: { "content-type": "application/json" },
    ...options,
  });
}
function manifestResponse(doc, headers = {}) {
  return new Response(doc.body, {
    headers: {
      "content-type": doc.data.mediaType,
      "docker-content-digest": doc.digest,
      ...headers,
    },
  });
}
function fixture({
  dev = image(),
  rows,
  documents = [],
  ownerType = "User",
  intercept,
  pages,
  link,
} = {}) {
  rows ||= [version(1, dev, ["dev"])];
  const calls = [];
  const manifests = new Map(
    [dev, ...documents].map((doc) => [doc.digest, doc]),
  );
  const endpoint = `/${ownerType === "Organization" ? "orgs" : "users"}/raven/packages/container/antcdp/versions`;
  let inventoryRound = 0;
  const fetchImpl = async (address, init) => {
    const url = new URL(address);
    calls.push({ url, init });
    assert.equal(init.method, "GET");
    assert.equal(init.redirect, "error");
    assert.ok(init.signal instanceof AbortSignal);
    const alternate = await intercept?.(url, init, calls);
    if (alternate !== undefined) return alternate;
    if (url.origin === "https://api.github.com") {
      assert.equal(init.headers.Authorization, "Bearer secret-token");
      if (url.pathname === "/repos/raven/antcdp") {
        return json({
          full_name: "Raven/AntCDP",
          owner: { login: "Raven", type: ownerType },
        });
      }
      assert.equal(url.pathname, endpoint);
      assert.equal(url.searchParams.get("state"), "active");
      assert.equal(url.searchParams.get("per_page"), "100");
      const page = Number(url.searchParams.get("page"));
      if (page === 1) inventoryRound++;
      const data = pages
        ? pages(page, inventoryRound)
        : rows.slice((page - 1) * 100, page * 100);
      const header = link?.(page, inventoryRound);
      return json(data, { headers: header ? { link: header } : {} });
    }
    assert.equal(url.origin, "https://ghcr.io");
    if (url.pathname === "/token") {
      assert.equal(
        init.headers.Authorization,
        "Basic " + Buffer.from("raven:secret-token").toString("base64"),
      );
      assert.equal(url.searchParams.get("service"), "ghcr.io");
      assert.equal(
        url.searchParams.get("scope"),
        "repository:raven/antcdp:pull",
      );
      return json({ token: "registry-token" });
    }
    assert.equal(init.headers.Authorization, "Bearer registry-token");
    const reference = url.pathname.slice("/v2/raven/antcdp/manifests/".length);
    const doc = reference === "dev" ? dev : manifests.get(reference);
    assert.ok(doc, "unexpected manifest request");
    return manifestResponse(doc);
  };
  return {
    calls,
    options: {
      repository: "Raven/AntCDP",
      actor: "raven",
      token: "secret-token",
      expectedDevDigest: dev.digest,
      fetchImpl,
    },
  };
}

test("single-platform dev permits cleanup; config/layer blobs need no package tags", async () => {
  const dev = image(),
    old = index([image("old")]);
  const setup = fixture({
    dev,
    rows: [version(1, dev, ["dev"]), version(2, old)],
  });
  assert.deepEqual(await checkGhcrCleanup(setup.options), {
    safe: true,
    reason:
      "All tagged manifests and their dependencies have independent tags.",
    taggedCount: 1,
    versionCount: 2,
  });
  assert.equal(
    setup.calls.filter(({ url }) => url.pathname.includes("/manifests/"))
      .length,
    2,
  );
  assert.ok(
    !setup.calls.some(
      ({ url }) =>
        url.pathname.includes("/blobs/") || url.pathname.endsWith(old.digest),
    ),
  );
});

test("reads all active pages for an organization and rechecks the inventory", async () => {
  const dev = image();
  const rows = Array.from({ length: 101 }, (_, i) =>
    version(
      i + 1,
      i === 100 ? dev : image(String(i)),
      i === 100 ? ["dev"] : [],
    ),
  );
  const setup = fixture({
    dev,
    rows,
    ownerType: "Organization",
    link: (page) =>
      page === 1
        ? '<https://api.github.com/orgs/raven/packages/container/antcdp/versions?state=active&per_page=100&page=2>; rel="next"'
        : undefined,
  });
  const result = await checkGhcrCleanup(setup.options);
  assert.equal(result.safe, true);
  assert.equal(result.versionCount, 101);
  assert.equal(
    setup.calls.filter(({ url }) => url.pathname.includes("/versions")).length,
    6,
  );
});

test("probes a full page even when the API omitted the pagination Link", async () => {
  const dev = image();
  const rows = Array.from({ length: 101 }, (_, i) =>
    version(i + 1, i ? image(String(i)) : dev, i ? [] : ["dev"]),
  );
  const setup = fixture({ dev, rows });
  assert.equal((await checkGhcrCleanup(setup.options)).versionCount, 101);
});

test("checks every tagged child, including a nested index and Docker media types", async () => {
  const amd = image("amd", DOCKER_IMAGE),
    arm = image("arm");
  const nested = index([arm]),
    release = index([amd, nested], DOCKER_INDEX);
  const dev = image();
  const setup = fixture({
    dev,
    documents: [amd, arm, nested, release],
    rows: [
      version(1, dev, ["dev"]),
      version(2, amd, ["1.0-amd64"]),
      version(3, arm, ["1.0-arm64"]),
      version(4, nested, ["1.0-arm-index"]),
      version(5, release, ["1.0", "latest"]),
    ],
  });
  assert.equal((await checkGhcrCleanup(setup.options)).safe, true);
  for (const doc of [amd, arm, nested, release]) {
    assert.equal(
      setup.calls.filter(({ url }) => url.pathname.endsWith(doc.digest)).length,
      1,
    );
  }
});

for (const missing of [true, false]) {
  test(`blocks a tagged index's ${missing ? "unknown" : "untagged"} child manifest`, async () => {
    const child = image("untagged"),
      dev = index([child]);
    const rows = [
      version(1, dev, ["dev"]),
      ...(missing ? [] : [version(2, child)]),
    ];
    const result = await checkGhcrCleanup(fixture({ dev, rows }).options);
    assert.equal(result.safe, false);
    assert.match(result.reason, /missing or untagged/);
  });
}

test("also blocks an untagged attestation beneath a tagged platform index", async () => {
  const platform = image("amd"),
    proof = image("attestation");
  const nested = index([platform, proof]),
    dev = index([nested]);
  const result = await checkGhcrCleanup(
    fixture({
      dev,
      documents: [nested, platform],
      rows: [
        version(1, dev, ["dev"]),
        version(2, nested, ["amd-index"]),
        version(3, platform, ["amd"]),
        version(4, proof),
      ],
    }).options,
  );
  assert.equal(result.safe, false);
});

test("accepts GHCR OCI 1.1 attestations with verified inline config and a tagged subject", async () => {
  const platform = image("amd");
  const proof = document({
    schemaVersion: 2,
    mediaType: IMAGE,
    config: {
      ...blob("{}", "application/vnd.oci.empty.v1+json"),
      data: "e30=",
    },
    layers: [blob("provenance", "application/vnd.in-toto+json")],
    subject: platform.descriptor,
  });
  const dev = index([platform, proof]);
  const result = await checkGhcrCleanup(
    fixture({
      dev,
      documents: [platform, proof],
      rows: [
        version(1, dev, ["dev"]),
        version(2, platform, ["dev-amd64"]),
        version(3, proof, ["dev-proof"]),
      ],
    }).options,
  );
  assert.equal(result.safe, true);
  const invalid = document({
    ...proof.data,
    config: { ...proof.data.config, data: "e31=" },
  });
  assert.equal(
    (await checkGhcrCleanup(fixture({ dev: invalid }).options)).safe,
    false,
  );
});

for (const tags of [[], ["latest"]]) {
  test(`requires dev specifically, not merely another permanent tag (${JSON.stringify(tags)})`, async () => {
    const dev = image();
    const result = await checkGhcrCleanup(
      fixture({ dev, rows: [version(1, dev, tags)] }).options,
    );
    assert.equal(result.safe, false);
    assert.match(result.reason, /dev tag/);
  });
}

test("an older successful workflow cannot clean after another build moved dev", async () => {
  const setup = fixture();
  const result = await checkGhcrCleanup({
    ...setup.options,
    expectedDevDigest: image("previous").digest,
  });
  assert.equal(result.safe, false);
  assert.ok(!setup.calls.some(({ url }) => url.origin === "https://ghcr.io"));
});

test("blocks a changed inventory and a registry dev tag that disagrees with GitHub metadata", async () => {
  const dev = image(),
    newer = image("newer");
  const changed = fixture({
    dev,
    pages: (page, round) =>
      page === 1 ? [version(1, dev, round === 1 ? ["dev"] : ["other"])] : [],
  });
  assert.match(
    (await checkGhcrCleanup(changed.options)).reason,
    /changed during/,
  );
  const stale = fixture({
    dev,
    intercept: (url) =>
      url.pathname.endsWith("/manifests/dev")
        ? manifestResponse(newer)
        : undefined,
  });
  assert.match((await checkGhcrCleanup(stale.options)).reason, /digest/);
});

test("rechecks the dev registry tag after all manifests and the second inventory", async () => {
  const dev = image(),
    newer = image("newer");
  let reads = 0;
  const setup = fixture({
    dev,
    intercept: (url) => {
      if (url.pathname.endsWith("/manifests/dev") && ++reads === 2)
        return manifestResponse(newer);
    },
  });
  assert.equal((await checkGhcrCleanup(setup.options)).safe, false);
  assert.equal(reads, 2);
});

for (const status of [301, 302, 401, 403, 404, 429, 500]) {
  test(`fails closed for API HTTP ${status} and never exposes response content`, async () => {
    const setup = fixture({
      intercept: () =>
        new Response("secret-token raw failure", {
          status,
          headers: { location: "https://evil.invalid" },
        }),
    });
    const result = await checkGhcrCleanup(setup.options);
    assert.equal(result.safe, false);
    assert.ok(!result.reason.includes("secret-token"));
    assert.equal(setup.calls.length, 1);
  });
}

for (const link of [
  '<https://api.github.com/user/123/packages/container/antcdp/versions?per_page=100&page=2>; rel="next"',
  '<https://api.github.com/users/raven/packages/container/antcdp/versions?per_page=100&page=2>; rel="next"',
  '<https://evil.invalid/versions?page=2>; rel="next"',
  '<https://api.github.com/users/raven/packages/container/antcdp/versions?state=active&per_page=100&page=1>; rel="next"',
  '<https://api.github.com/users/raven/packages/container/antcdp/versions?state=active&per_page=100&page=3>; rel="next"',
  "not a Link header",
]) {
  test(`reads fixed pages without following or depending on Link: ${link}`, async () => {
    const dev = image();
    const setup = fixture({
      dev,
      link: () => link,
      // A tagged version on a later short page must still be checked.
      pages: (page) =>
        page === 1
          ? [version(1, image("old"))]
          : page === 2
            ? [version(2, dev, ["dev"])]
            : [],
    });
    const result = await checkGhcrCleanup(setup.options);
    assert.equal(result.safe, true);
    assert.equal(result.versionCount, 2);
    assert.deepEqual(
      setup.calls
        .filter(({ url }) => url.pathname.includes("/versions"))
        .map(({ url }) => url.href),
      [1, 2, 3, 1, 2, 3].map(
        (page) =>
          `https://api.github.com/users/raven/packages/container/antcdp/versions?state=active&per_page=100&page=${page}`,
      ),
    );
  });
}

test("does not permit cleanup when pagination never reaches an empty page", async () => {
  const setup = fixture({
    pages: (page) => [version(page, image(String(page)))],
  });
  const result = await checkGhcrCleanup(setup.options);
  assert.equal(result.safe, false);
  assert.match(result.reason, /page limit exceeded/);
});

test("does not silently accept a failed later page or repeated version IDs", async () => {
  const dev = image();
  const link = () =>
    '<https://api.github.com/users/raven/packages/container/antcdp/versions?state=active&per_page=100&page=2>; rel="next"';
  const failing = fixture({
    dev,
    link,
    intercept: (url) =>
      url.searchParams.get("page") === "2"
        ? new Response("failure", { status: 503 })
        : undefined,
  });
  assert.equal((await checkGhcrCleanup(failing.options)).safe, false);
  const duplicate = fixture({
    dev,
    pages: () => [version(1, dev, ["dev"])],
  });
  assert.match((await checkGhcrCleanup(duplicate.options)).reason, /duplicate/);
});

test("blocks malformed version metadata and unsupported owner types", async () => {
  const dev = image();
  for (const row of [
    null,
    { id: 1 },
    { ...version(1, dev, ["dev"]), metadata: {} },
    version(1, dev, ["dev", "dev"]),
  ]) {
    assert.equal(
      (await checkGhcrCleanup(fixture({ dev, rows: [row] }).options)).safe,
      false,
    );
  }
  assert.equal(
    (await checkGhcrCleanup(fixture({ ownerType: "Enterprise" }).options)).safe,
    false,
  );
});

test("rejects corrupt content, unsupported manifests, and inconsistent child descriptors", async () => {
  const dev = image();
  for (const response of [
    () => new Response("not-json"),
    () => manifestResponse(dev, { "docker-content-digest": sha("other") }),
    () => manifestResponse(dev, { "content-type": "text/plain" }),
  ]) {
    const setup = fixture({
      dev,
      intercept: (url) =>
        url.pathname.includes("/manifests/") ? response() : undefined,
    });
    assert.equal((await checkGhcrCleanup(setup.options)).safe, false);
  }
  for (const doc of [
    document({ schemaVersion: 2, mediaType: "application/unknown" }),
    document({ schemaVersion: 2, mediaType: INDEX, manifests: [] }),
    document({ schemaVersion: 2, mediaType: IMAGE, config: null, layers: [] }),
    document({ schemaVersion: 1, mediaType: IMAGE }),
  ])
    assert.equal(
      (await checkGhcrCleanup(fixture({ dev: doc }).options)).safe,
      false,
    );
  const child = image("child");
  const wrong = document({
    schemaVersion: 2,
    mediaType: INDEX,
    manifests: [{ ...child.descriptor, size: 0 }],
  });
  assert.equal(
    (
      await checkGhcrCleanup(
        fixture({
          dev: wrong,
          documents: [child],
          rows: [version(1, wrong, ["dev"]), version(2, child, ["amd64"])],
        }).options,
      )
    ).safe,
    false,
  );
});

test("timeouts and thrown fetch errors fail closed without leaking credentials", async () => {
  const setup = fixture();
  const timed = await checkGhcrCleanup({
    ...setup.options,
    timeoutMs: 5,
    fetchImpl: () => new Promise(() => {}),
  });
  assert.equal(timed.safe, false);
  assert.match(timed.reason, /timed out/);
  const failed = await checkGhcrCleanup({
    ...setup.options,
    fetchImpl: () => {
      throw new Error("https://user:secret-token@evil.invalid/raw");
    },
  });
  assert.equal(failed.safe, false);
  assert.ok(!failed.reason.includes("secret-token"));
  assert.ok(!failed.reason.includes("evil.invalid"));
});

test("rejects input injection before making any request", async () => {
  const setup = fixture();
  for (const override of [
    { repository: "raven/../other" },
    { repository: "raven/antcdp?other" },
    { repository: "raven/.." },
    { actor: "raven:other" },
    { token: "secret\r\nInjected: true" },
    { expectedDevDigest: "sha256:x\nsafe=true" },
  ])
    assert.equal(
      (await checkGhcrCleanup({ ...setup.options, ...override })).safe,
      false,
    );
  assert.equal(setup.calls.length, 0);
});

test("CLI publishes false on a blocked check or unexpected exception, and true only after success", async (t) => {
  const warnings = [];
  t.mock.method(console, "warn", (message) => warnings.push(message));
  t.mock.method(console, "log", () => {});
  const dir = await mkdtemp(join(tmpdir(), "antcdp-ghcr-check-"));
  try {
    const env = {
      GITHUB_OUTPUT: join(dir, "output"),
      GITHUB_REPOSITORY: "raven/antcdp",
    };
    assert.equal(
      await runCli(env, async () => ({
        safe: false,
        reason: "Dependency missing.",
      })),
      false,
    );
    assert.equal(await readFile(env.GITHUB_OUTPUT, "utf8"), "safe=false\n");
    assert.equal(
      await runCli(env, async () => {
        throw new Error("secret-token");
      }),
      false,
    );
    assert.equal(
      await runCli(env, async () => ({
        safe: true,
        taggedCount: 3,
        versionCount: 5,
      })),
      true,
    );
    assert.equal(
      await readFile(env.GITHUB_OUTPUT, "utf8"),
      "safe=false\nsafe=false\nsafe=true\n",
    );
    assert.equal(warnings.length, 2);
    assert.ok(warnings.every((message) => !message.includes("secret-token")));
    await assert.rejects(
      runCli({}, async () => ({ safe: false })),
      /GITHUB_OUTPUT/,
    );
  } finally {
    assert.equal(dirname(resolve(dir)), resolve(tmpdir()));
    assert.ok(basename(dir).startsWith("antcdp-ghcr-check-"));
    await rm(dir, { recursive: true, force: true });
  }
});
