import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:net";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  available,
  validateProfile,
  profileDigest,
  digest,
  checkSourceDigest,
  paths,
  root,
  run,
} from "./dev-lib.mjs";

const database = {
  host: "database.example",
  port: 3306,
  name: "antcdp_example",
  username: "developer",
  password: "test-only",
};
const profile = { database };

test("database initialization rejects unsafe SQL names and the deployment schema", () => {
  for (const name of [
    "antcdp",
    "mysql",
    "antcdp_dev`; DROP DATABASE mysql; --",
    "antcdp_dev'",
    "",
  ]) {
    assert.throws(() => validateProfile({ database: { ...database, name } }));
  }
  assert.equal(validateProfile(profile), profile);
  assert.throws(() =>
    validateProfile({ database: { ...database, port: "3306" } }),
  );
  assert.throws(() => validateProfile(database));
  assert.throws(() => validateProfile({}));
});

test("connection changes invalidate the installed profile fingerprint", () => {
  for (const change of [
    { host: "other" },
    { password: "new-password" },
    { name: "antcdp_other" },
    { tls_mode: "required" },
  ]) {
    assert.notEqual(
      profileDigest(database),
      profileDigest({ ...database, ...change }),
    );
  }
  assert.equal(
    profileDigest(database),
    profileDigest({ ...database, mysql_client: "different-client" }),
  );
});

test("nesting connection settings preserves the installed database fingerprint", () => {
  const oldConnection = { ...database, database: database.name };
  const existingFingerprint = digest(
    JSON.stringify([
      oldConnection.host,
      oldConnection.port,
      oldConnection.database,
      oldConnection.username,
      oldConnection.password,
      "disabled",
    ]),
  );
  assert.equal(profileDigest(database), existingFingerprint);
});

test("profile override loads the database section and preserves future sections", async (t) => {
  mkdirSync(paths.tmp, { recursive: true });
  const dir = mkdtempSync(resolve(paths.tmp, "profile-test-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = resolve(dir, "profile.dev.json");
  writeFileSync(path, JSON.stringify({ database, future: { enabled: true } }));
  const result = await run(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      "import {loadProfile} from './scripts/dev-lib.mjs'; const p=loadProfile(); console.log(JSON.stringify({name:p.database.name,future:p.future.enabled}));",
    ],
    {
      cwd: root,
      env: { ...process.env, ANTCDP_DEV_PROFILE: path },
    },
  );
  assert.deepEqual(JSON.parse(result), { name: database.name, future: true });
});

test("port checks refuse to take over an unrelated running service", async (t) => {
  const server = createServer();
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  t.after(() => new Promise((done) => server.close(done)));
  await assert.rejects(available(server.address().port), /occupied/);
  assert.equal(server.listening, true);
});

test("child commands report failure instead of silently accepting a failed check", async () => {
  await assert.rejects(
    run(process.execPath, [
      "-e",
      "process.stderr.write('expected failure'); process.exit(3)",
    ]),
    /expected failure/,
  );
});

test("check records ignore documentation changes but track executable inputs", (t) => {
  mkdirSync(paths.tmp, { recursive: true });
  const dir = mkdtempSync(resolve(paths.tmp, "check-inputs-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  function write(name, contents) {
    const file = resolve(dir, name);
    mkdirSync(resolve(file, ".."), { recursive: true });
    writeFileSync(file, contents);
  }
  const names = [
    "README.md",
    "AGENTS.md",
    "docs/guide.md",
    "docs/database/schema/example.sql",
    "internal/example.go",
    "internal/prompts/system.md",
    "web/src/app.tsx",
    "web/public/icon.svg",
    "web/package-lock.json",
    ".github/workflows/test.yml",
    "scripts/check-web.mjs",
    ".golangci.yml",
    "go.mod",
    "Dockerfile",
  ];
  for (const name of names) write(name, "original");
  const before = checkSourceDigest(names, dir);
  for (const name of names.slice(0, 4)) write(name, "updated documentation");
  write("docs/new.md", "new documentation");
  assert.equal(checkSourceDigest([...names, "docs/new.md"], dir), before);
  assert.equal(checkSourceDigest(names.slice(4), dir), before);
  for (const name of names.slice(4)) {
    write(name, "changed executable input");
    assert.notEqual(checkSourceDigest(names, dir), before, name);
    write(name, "original");
  }
  write("internal/added.go", "package added");
  assert.notEqual(
    checkSourceDigest([...names, "internal/added.go"], dir),
    before,
  );
  rmSync(resolve(dir, "internal/example.go"));
  assert.notEqual(checkSourceDigest(names, dir), before);
});
