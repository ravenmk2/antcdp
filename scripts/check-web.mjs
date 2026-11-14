import { npm } from "./npm-web.mjs";
for (const step of ["lint", "test"]) npm(["run", step]);
await import("./verify-web.mjs");
