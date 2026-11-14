import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { createServer } from "node:net";

export const root = fileURLToPath(new URL("../", import.meta.url));
export const paths = Object.fromEntries(
  ["app", "runtime", "logs", "tmp"].map((name) => [
    name,
    resolve(root, ".data", name),
  ]),
);
export const origin = "http://127.0.0.1:5173";
export const backendURL = "http://127.0.0.1:8080";
export const pause = (ms) => new Promise((done) => setTimeout(done, ms));
export const digest = (value) =>
  createHash("sha256").update(value).digest("hex");
export function checkSourceDigest(names, directory = root) {
  // Documentation is maintained by review. Keep runtime Markdown and all
  // other code, assets and configuration in the verification fingerprint.
  const inputs = [...new Set(names.map((name) => name.replaceAll("\\", "/")))]
    .filter(
      (name) =>
        !name.startsWith("docs/") && !/^(README|AGENTS)\.md$/i.test(name),
    )
    .sort();
  return digest(
    Buffer.concat(
      inputs.flatMap((name) => [
        Buffer.from(`${name}\0`),
        existsSync(resolve(directory, name))
          ? readFileSync(resolve(directory, name))
          : Buffer.from("[deleted]"),
      ]),
    ),
  );
}
export function prepare() {
  for (const directory of Object.values(paths))
    mkdirSync(directory, { recursive: true });
}
export function environment() {
  return {
    ...process.env,
    TEMP: paths.tmp,
    TMP: paths.tmp,
    TMPDIR: paths.tmp,
    GOTMPDIR: paths.tmp,
  };
}
export function readJSON(path, fallback = null) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}
export function writeJSON(path, value) {
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    mode: 0o600,
  });
  renameSync(temporary, path);
}
export function validateProfile(profile) {
  const database = profile?.database;
  if (
    !database ||
    typeof database.host !== "string" ||
    !database.host ||
    !Number.isInteger(database.port) ||
    database.port < 1 ||
    database.port > 65535 ||
    !/^antcdp_[a-zA-Z0-9_]+$/.test(database.name) ||
    typeof database.username !== "string" ||
    !database.username ||
    typeof database.password !== "string" ||
    !database.password
  ) {
    throw new Error(
      "Invalid development profile: database must contain host, port, name, username and password.",
    );
  }
  return profile;
}
export function loadProfile() {
  const path =
    process.env.ANTCDP_DEV_PROFILE || resolve(root, ".data/profile.dev.json");
  const profile = readJSON(path);
  if (!profile)
    throw new Error(
      "Create the local development profile before initialization.",
    );
  return validateProfile(profile);
}
export function profileDigest(profile) {
  return digest(
    JSON.stringify([
      profile.host,
      profile.port,
      profile.name,
      profile.username,
      profile.password,
      profile.tls_mode || "disabled",
    ]),
  );
}
export function run(
  command,
  args,
  {
    env = environment(),
    cwd = root,
    input,
    stdout = "pipe",
    stderr = "pipe",
  } = {},
) {
  return new Promise((accept, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      windowsHide: true,
      stdio: ["pipe", stdout, stderr],
    });
    let output = "",
      errors = "";
    child.stdout?.on("data", (chunk) => {
      output += chunk;
    });
    child.stderr?.on("data", (chunk) => {
      errors += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0
        ? accept(output.trim())
        : reject(new Error(errors.trim() || `${command} exited ${code}`)),
    );
    child.stdin.on("error", () => {});
    child.stdin.end(input);
  });
}
export async function mysql(profile, sql) {
  try {
    return await run(
      profile.mysql_client || process.env.ANTCDP_MYSQL_CLIENT || "mysql",
      [
        "--no-defaults",
        "--protocol=TCP",
        "--connect-timeout=8",
        "--batch",
        "--skip-column-names",
        `--host=${profile.host}`,
        `--port=${profile.port}`,
        `--user=${profile.username}`,
      ],
      { env: { ...environment(), MYSQL_PWD: profile.password }, input: sql },
    );
  } catch (error) {
    throw new Error(error.message.replaceAll(profile.password, "[REDACTED]"));
  }
}
export async function available(port) {
  await new Promise((accept, reject) => {
    const server = createServer();
    server.once("error", () =>
      reject(
        new Error(`Port ${port} is occupied; no existing process was stopped.`),
      ),
    );
    server.listen(port, "127.0.0.1", () => server.close(accept));
  });
}
export async function api(path, options = {}, base = origin) {
  const response = await fetch(`${base}/api/v1${path}`, {
    signal: AbortSignal.timeout(15000),
    ...options,
  });
  const body = await response.json();
  if (!response.ok)
    throw new Error(
      `API ${response.status}: ${body.error?.code || "request failed"}`,
    );
  return { data: body.data, response };
}
export async function initialize() {
  const { database: profile } = loadProfile();
  const stamp = resolve(paths.runtime, "database.json");
  const previous = readJSON(stamp);
  if (previous && previous.profile !== profileDigest(profile)) {
    throw new Error(
      "Database profile changed. Update the installed application configuration explicitly; automatic reset is disabled.",
    );
  }
  const { data } = await api("/setup/status");
  if (data.state === "ready") {
    if (!previous)
      throw new Error(
        "Existing installation has no development database record; verify its connection before adopting it.",
      );
    return;
  }
  if (data.state !== "setup_required")
    throw new Error(
      `Installation is ${data.state}; automatic recovery/reset is disabled.`,
    );
  if (existsSync(resolve(paths.app, "install.lock")))
    throw new Error("Unexpected installation state; refusing to initialize.");
  const name = profile.name;
  const present = await mysql(
    profile,
    `SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME='${name}';`,
  );
  if (!present)
    await mysql(
      profile,
      `CREATE DATABASE \`${name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;`,
    );
  const tables = await mysql(
    profile,
    `SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA='${name}';`,
  );
  if (tables !== "0")
    throw new Error(
      "Development database is not empty. Restore matching application data or explicitly arrange a reset.",
    );
  const { data: csrf, response } = await api("/auth/csrf");
  const headers = {
    "Content-Type": "application/json",
    Origin: origin,
    "X-CSRF-Token": csrf.csrf_token,
    Cookie: response.headers
      .getSetCookie()
      .map((cookie) => cookie.split(";", 1)[0])
      .join("; "),
  };
  const database = {
    host: profile.host,
    port: profile.port,
    name,
    username: profile.username,
    password: profile.password,
    tls_mode: profile.tls_mode || "disabled",
  };
  await api("/setup/database-check", {
    method: "POST",
    headers,
    body: JSON.stringify(database),
  });
  const loginPath = resolve(paths.runtime, "login.json");
  const { randomBytes } = await import("node:crypto");
  const founder = readJSON(loginPath) || {
    username: "devadmin",
    display_name: "开发管理员",
    password: randomBytes(18).toString("base64url"),
  };
  writeJSON(loginPath, founder);
  // Write the connection fingerprint before installation so a lost HTTP response
  // can be reconciled against setup/status without replaying initialization.
  writeJSON(stamp, { profile: profileDigest(profile), database: name });
  try {
    await api("/setup/install", {
      method: "POST",
      headers,
      signal: AbortSignal.timeout(130000),
      body: JSON.stringify({
        database,
        site: { site_name: "AntCDP Dev", timezone: "Asia/Shanghai" },
        founder,
      }),
    });
  } catch (error) {
    const current = await api("/setup/status").catch(() => null);
    if (current?.data.state !== "ready")
      throw new Error(
        `${error.message}; inspect setup/status before retrying. No database was reset.`,
      );
  }
}
