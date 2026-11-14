import { npm } from "./npm-web.mjs";
npm(["ci"]);
npm(["run", "build"]);
await import("./verify-web.mjs");
