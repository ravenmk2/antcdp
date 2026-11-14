import { spawn } from "node:child_process";
import { watch, mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { once } from "node:events";
import { root, paths, prepare, environment, writeJSON } from "./dev-lib.mjs";

prepare();
const output = resolve(paths.runtime, "backend");
mkdirSync(output, { recursive: true });
const args = process.argv.slice(2);
const serveArgs = args.length
  ? args
  : [
      "--listen",
      "127.0.0.1:8080",
      "--public-url",
      "http://127.0.0.1:5173",
      "--data-dir",
      paths.app,
    ];
let backend, build, currentFile, timer;
let dirty = false,
  closing = false,
  generation = 0;
const watchers = [];
function report(state, extra = {}) {
  const value = {
    state,
    pid: backend?.pid || null,
    updated_at: new Date().toISOString(),
    ...extra,
  };
  writeJSON(resolve(paths.runtime, "backend.json"), value);
  if (process.connected) process.send(value);
}

async function stop(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, "exit");
  child.kill();
  const deadline = setTimeout(() => child.kill("SIGKILL"), 5000);
  await exited;
  clearTimeout(deadline);
}
async function rebuild() {
  if (closing) return;
  if (build) {
    dirty = true;
    return;
  }
  const binary = resolve(
    output,
    `antcdp-${process.pid}-${++generation}${process.platform === "win32" ? ".exe" : ""}`,
  );
  console.log("Building backend…");
  report("building");
  build = spawn("go", ["build", "-o", binary, "./cmd/antcdp"], {
    cwd: root,
    stdio: "inherit",
    windowsHide: true,
    env: environment(),
  });
  build.on("error", (error) => console.error(error.message));
  const [code] = await once(build, "close").catch(() => [1]);
  if (code === 0 && !closing) {
    const previous = backend;
    backend = undefined;
    await stop(previous);
    if (currentFile) rmSync(currentFile, { force: true });
    currentFile = binary;
    backend = spawn(binary, ["serve", ...serveArgs], {
      cwd: root,
      stdio: "inherit",
      windowsHide: true,
      env: environment(),
    });
    const active = backend;
    backend.on("error", (error) => {
      console.error(error.message);
      report("failed");
    });
    backend.on("exit", () => {
      if (backend === active && !closing) report("exited");
    });
    report("built");
    console.log("Backend restarted; watching source changes.");
  } else {
    rmSync(binary, { force: true });
    if (!closing)
      console.error("Build failed; previous backend remains running.");
    if (!closing)
      report("failed", {
        previous_backend_running: Boolean(backend && backend.exitCode === null),
      });
  }
  build = undefined;
  if (dirty && !closing) {
    dirty = false;
    void rebuild();
  }
}
function changed(_event, filename) {
  if (
    filename &&
    !/\.(go|sql)$/.test(String(filename)) &&
    !/^go\.(mod|sum)$/.test(String(filename))
  )
    return;
  clearTimeout(timer);
  timer = setTimeout(() => void rebuild(), 450);
}
for (const directory of ["cmd", "internal"])
  watchers.push(watch(resolve(root, directory), { recursive: true }, changed));
for (const file of ["go.mod", "go.sum"])
  watchers.push(watch(resolve(root, file), changed));
async function close() {
  if (closing) return;
  closing = true;
  clearTimeout(timer);
  watchers.forEach((watcher) => watcher.close());
  await Promise.all([stop(build), stop(backend)]);
  if (currentFile) rmSync(currentFile, { force: true });
  report("stopped");
  if (process.connected) process.disconnect();
}
process.on("SIGINT", () => void close());
process.on("SIGTERM", () => void close());
process.on("message", (message) => {
  if (message === "stop") void close();
});
process.on("disconnect", () => void close());
await rebuild();
