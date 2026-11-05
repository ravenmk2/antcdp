import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { businessRoute } from "./src/lib/routes.ts";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    {
      name: "antcdp-build-contract",
      generateBundle() {
        this.emitFile({
          type: "asset",
          fileName: "ui-build.json",
          source: JSON.stringify({
            base: "/",
            framework: "react",
            business_routes: businessRoute.source,
          }),
        });
      },
    },
  ],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    proxy: {
      "^/(?:api(?:/|$)|healthz$|readyz$)":
        process.env.ANTCDP_DEV_BACKEND || "http://127.0.0.1:8080",
    },
  },
});
