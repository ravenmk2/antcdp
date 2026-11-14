import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import {
  closeSync,
  existsSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { resolve, dirname } from "node:path";
import { once } from "node:events";
import {
  root,
  paths,
  origin,
  prepare,
  environment,
  pause,
  digest,
  checkSourceDigest,
  readJSON,
  writeJSON,
  loadProfile,
  run,
  mysql,
  available,
  api,
  initialize,
} from "./dev-lib.mjs";

const recordPath = resolve(paths.runtime, "dev.json");
const lockPath = resolve(paths.runtime, "command.lock");
const action = process.argv[2] || "status";
prepare();

async function control(record, command) {
  if (
    !record ||
    !Number.isInteger(record.port) ||
    typeof record.token !== "string"
  )
    throw new Error("No development supervisor record.");
  const response = await fetch(`http://127.0.0.1:${record.port}/${command}`, {
    method: command === "stop" ? "POST" : "GET",
    headers: { Authorization: `Bearer ${record.token}` },
    signal: AbortSignal.timeout(3000),
  });
  if (!response.ok)
    throw new Error("Development supervisor identity could not be verified.");
  return response.json();
}
async function status() {
  const record = readJSON(recordPath);
  const supervisor = await control(record, "status").catch(() => null);
  if (!supervisor) return { state: "stopped", url: origin, logs: paths.logs };
  const setup = await api("/setup/status").catch(() => null);
  return {
    ...supervisor,
    state:
      supervisor.backend.state === "built" && supervisor.frontend === "running"
        ? setup?.data.state || "starting"
        : "not_current",
    url: origin,
    database: setup?.data.state || "unavailable",
    logs: paths.logs,
    login_file: existsSync(resolve(paths.runtime, "login.json"))
      ? resolve(paths.runtime, "login.json")
      : undefined,
  };
}
async function logged(label, command, args, env = environment()) {
  const path = resolve(paths.logs, `${label}.log`);
  const fd = openSync(path, "w");
  try {
    await run(command, args, { env, stdout: fd, stderr: fd });
  } catch {
    throw new Error(`${label} failed; see ${path}`);
  } finally {
    closeSync(fd);
  }
}
async function npm(label, args) {
  // Invoke npm's JS entrypoint through a fixed launcher; no user strings enter a shell.
  const cli = resolve(
    dirname(process.execPath),
    "node_modules/npm/bin/npm-cli.js",
  );
  if (process.platform === "win32" && !existsSync(cli))
    throw new Error(
      "npm CLI not found alongside Node.js; repair the Node.js installation.",
    );
  const path = resolve(paths.logs, `${label}.log`);
  const fd = openSync(path, "w");
  try {
    await run(
      existsSync(cli) ? process.execPath : "npm",
      existsSync(cli) ? [cli, ...args] : args,
      {
        cwd: resolve(root, "web"),
        env: environment(),
        stdout: fd,
        stderr: fd,
      },
    );
  } catch {
    throw new Error(`${label} failed; see ${path}`);
  } finally {
    closeSync(fd);
  }
}
async function dependencies() {
  const signature = digest(
    readFileSync(resolve(root, "web/package-lock.json")),
  );
  const saved = resolve(paths.runtime, "dependencies.json");
  if (
    !existsSync(resolve(root, "web/node_modules/vite/bin/vite.js")) ||
    readJSON(saved)?.lock !== signature
  ) {
    console.log("Preparing frontend dependencies…");
    await npm("dependencies", ["ci"]);
    writeJSON(saved, { lock: signature });
  }
  await logged("fonts", process.execPath, ["scripts/prepare-fonts.mjs"]);
  if (!existsSync(resolve(root, "web/dist/index.html"))) {
    console.log("Preparing initial embedded frontend…");
    await npm("initial-web-build", ["run", "build"]);
  }
}
async function withLock(fn) {
  let fd;
  try {
    fd = openSync(lockPath, "wx");
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    const lock = readJSON(lockPath);
    try {
      process.kill(lock.pid, 0);
    } catch (failure) {
      if (failure.code !== "ESRCH")
        throw new Error("Cannot verify previous command ownership.");
      rmSync(lockPath);
      return withLock(fn);
    }
    throw new Error("Another development command is active.");
  }
  try {
    writeFileSync(fd, JSON.stringify({ pid: process.pid }));
    return await fn();
  } finally {
    closeSync(fd);
    rmSync(lockPath, { force: true });
  }
}
async function start() {
  const record = readJSON(recordPath);
  if (await control(record, "status").catch(() => null)) {
    await initialize();
    return status();
  }
  // Refuse to bind over any unrelated service or orphaned child.
  await available(8080);
  await available(5173);
  loadProfile();
  await dependencies();
  const fd = openSync(resolve(paths.logs, "supervisor.log"), "w");
  const child = spawn(
    process.execPath,
    [resolve(root, "scripts/dev.mjs"), "__serve"],
    {
      cwd: root,
      env: environment(),
      detached: true,
      windowsHide: true,
      stdio: ["ignore", fd, fd],
    },
  );
  try {
    await once(child, "spawn");
  } finally {
    closeSync(fd);
  }
  child.unref();
  const deadline = Date.now() + 180000;
  while (Date.now() < deadline) {
    const current = readJSON(recordPath);
    const state = await control(current, "status").catch(() => null);
    if (
      state?.backend.state === "failed" ||
      state?.backend.state === "exited" ||
      state?.frontend === "exited"
    ) {
      throw new Error(
        "Development startup failed; inspect scripts/dev.mjs logs. Existing data was preserved.",
      );
    }
    if (state?.backend.state === "built" && state.frontend === "running") {
      const response = await api("/setup/status").catch(() => null);
      if (response) {
        await initialize();
        return status();
      }
    }
    await pause(500);
  }
  throw new Error(
    "Startup timed out; inspect status and logs before retrying.",
  );
}
async function stop() {
  const record = readJSON(recordPath);
  if (!record) return { state: "stopped" };
  if (!(await control(record, "status").catch(() => null))) {
    return {
      state: "stopped",
      note: "No authenticated supervisor; no PID was terminated.",
    };
  }
  await control(record, "stop");
  for (let attempt = 0; attempt < 60; attempt++) {
    if (!(await control(record, "status").catch(() => null))) {
      await available(8080);
      await available(5173);
      return { state: "stopped", data: "preserved" };
    }
    await pause(250);
  }
  throw new Error("Supervisor has not finished stopping; inspect logs.");
}
async function serve() {
  const token = randomBytes(32).toString("hex");
  const children = [];
  let backend = { state: "starting" },
    frontend = "starting",
    closing = false;
  const server = createServer((request, response) => {
    if (request.headers.authorization !== `Bearer ${token}`) {
      response.writeHead(403).end();
      return;
    }
    response.setHeader("Content-Type", "application/json");
    if (request.method === "GET" && request.url === "/status") {
      response.end(JSON.stringify({ pid: process.pid, backend, frontend }));
    } else if (request.method === "POST" && request.url === "/stop") {
      response.end(JSON.stringify({ state: "stopping" }));
      void shutdown();
    } else response.writeHead(404).end();
  });
  async function shutdown() {
    if (closing) return;
    closing = true;
    for (const child of children) {
      if (child.exitCode !== null || child.signalCode !== null) continue;
      const ended = once(child, "exit");
      if (child.connected) child.send("stop");
      else child.kill();
      const timer = setTimeout(() => child.kill("SIGKILL"), 12000);
      await ended;
      clearTimeout(timer);
    }
    if (readJSON(recordPath)?.token === token)
      rmSync(recordPath, { force: true });
    server.close();
    server.closeAllConnections();
  }
  function launch(name, args, ipc = false) {
    const fd = openSync(resolve(paths.logs, `${name}.log`), "w");
    const child = spawn(process.execPath, args, {
      cwd: root,
      windowsHide: true,
      env: environment(),
      stdio: ipc ? ["ignore", fd, fd, "ipc"] : ["ignore", fd, fd],
    });
    closeSync(fd);
    children.push(child);
    child.on("error", (error) => {
      console.error(error.message);
      if (name === "frontend") frontend = "exited";
      else backend = { state: "failed" };
    });
    child.on("exit", () => {
      if (name === "frontend") frontend = "exited";
      else backend = { state: "exited" };
    });
    return child;
  }
  await new Promise((accept, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", accept);
  });
  writeJSON(recordPath, {
    pid: process.pid,
    port: server.address().port,
    token,
  });
  launch("backend", [resolve(root, "scripts/dev-backend.mjs")], true).on(
    "message",
    (message) => {
      backend = message;
    },
  );
  launch("frontend", [
    resolve(root, "web/node_modules/vite/bin/vite.js"),
    resolve(root, "web"),
    "--config",
    resolve(root, "web/vite.config.ts"),
  ]).on("spawn", () => {
    frontend = "running";
  });
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}
async function check() {
  const source = await sourceDigest();
  const goChecks = readFileSync(
    resolve(root, ".github/actions/check-go/action.yml"),
    "utf8",
  );
  const version = goChecks.match(
    /golangci-lint-action@[\s\S]*?version: v([\d.]+)/,
  )?.[1];
  if (
    !version ||
    !(await run("golangci-lint", ["version"])).includes(`version ${version} `)
  ) {
    throw new Error(
      `Install the CI golangci-lint version ${version} before running checks.`,
    );
  }
  await dependencies();
  for (const [label, command, args] of [
    ["web-build", "npm", ["run", "build"]],
    ["web-check", process.execPath, ["scripts/check-web.mjs"]],
    ["script-tests", process.execPath, ["--test", "scripts/*.test.mjs"]],
    ["go-test", "go", ["test", "./..."]],
    ["go-vet", "go", ["vet", "./..."]],
    ["lint-config", "golangci-lint", ["config", "verify"]],
    ["lint", "golangci-lint", ["run"]],
  ]) {
    console.log(`${label}…`);
    if (command === "npm") await npm(label, args);
    else await logged(label, command, args);
  }
  if ((await sourceDigest()) !== source)
    throw new Error("Source changed during checks; results cannot be reused.");
  writeJSON(resolve(paths.runtime, "checks.json"), {
    source,
    tools: await toolVersions(),
    completed_at: new Date().toISOString(),
  });
  console.log(
    "Required checks passed. Real MySQL tests: run test-db. Browser acceptance remains manual.",
  );
}
async function sourceDigest() {
  const names = (
    await run("git", ["ls-files", "-co", "--exclude-standard", "-z"])
  )
    .split("\0")
    .filter(Boolean);
  return checkSourceDigest(names);
}
async function toolVersions() {
  return [
    process.version,
    await run("go", ["version"]),
    await run("golangci-lint", ["version"]),
  ];
}
async function verified() {
  const checks = readJSON(resolve(paths.runtime, "checks.json"));
  if (
    !checks ||
    checks.source !== (await sourceDigest()) ||
    JSON.stringify(checks.tools) !== JSON.stringify(await toolVersions())
  ) {
    throw new Error(
      "No matching source/toolchain checks. Run node scripts/dev.mjs check.",
    );
  }
  return { checked_source: checks.source, completed_at: checks.completed_at };
}
async function testDatabase() {
  const { database: profile } = loadProfile();
  const created = [];
  const journal = resolve(paths.runtime, "test-databases.json");
  if (readJSON(journal)?.databases?.length)
    throw new Error(
      "Unfinished test database cleanup recorded; inspect test-databases.json before another run.",
    );
  const suffix = randomBytes(6).toString("hex");
  const env = { ...environment(), CGO_ENABLED: "0" };
  try {
    for (const [key, name] of Object.entries({
      ANTCDP_TEST_MYSQL_DSN: "store",
      ANTCDP_TEST_HTTP_MYSQL_DSN: "http",
      ANTCDP_TEST_SCHEMA_MYSQL_DSN: "schema",
      ANTCDP_TEST_MODELS_MYSQL_DSN: "models",
      ANTCDP_TEST_AGENTS_MYSQL_DSN: "agents",
      ANTCDP_TEST_CLOUD_MYSQL_DSN: "cloud",
    })) {
      const database = `antcdp_test_dev_${name}_${suffix}`;
      await mysql(
        profile,
        `CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;`,
      );
      created.push(database);
      writeJSON(resolve(paths.runtime, "test-databases.json"), {
        host: profile.host,
        port: profile.port,
        databases: created,
      });
      env[key] =
        `${profile.username}:${profile.password}@tcp(${profile.host}:${profile.port})/${database}`;
    }
    await logged(
      "mysql-tests",
      "go",
      ["test", "-count=1", "-v", "./internal/store/mysql"],
      env,
    );
    console.log("Real MySQL tests passed (race detector not enabled).");
  } finally {
    for (const name of [...created]) {
      await mysql(profile, `DROP DATABASE \`${name}\`;`);
      created.splice(created.indexOf(name), 1);
      writeJSON(resolve(paths.runtime, "test-databases.json"), {
        host: profile.host,
        port: profile.port,
        databases: created,
      });
    }
    console.log(
      "Temporary test databases removed; development data preserved.",
    );
  }
}
try {
  if (action === "__serve") await serve();
  else if (action === "start")
    console.log(JSON.stringify(await withLock(start), null, 2));
  else if (action === "stop")
    console.log(JSON.stringify(await withLock(stop), null, 2));
  else if (action === "status")
    console.log(JSON.stringify(await status(), null, 2));
  else if (action === "check") await withLock(check);
  else if (action === "test-db") await withLock(testDatabase);
  else if (action === "verified")
    console.log(JSON.stringify(await verified(), null, 2));
  else if (action === "logs") {
    for (const name of ["backend", "frontend", "supervisor"]) {
      const path = resolve(paths.logs, `${name}.log`);
      if (existsSync(path))
        console.log(
          `${name}:\n${readFileSync(path, "utf8").trim().split(/\r?\n/).slice(-20).join("\n")}`,
        );
    }
  } else
    throw new Error(
      "Usage: node scripts/dev.mjs start|status|stop|logs|check|test-db|verified",
    );
} catch (error) {
  let message = error.message;
  try {
    message = message.replaceAll(loadProfile().database.password, "[REDACTED]");
  } catch {}
  console.error(message);
  process.exitCode = 1;
}
