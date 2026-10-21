import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./apps/web/src", import.meta.url)) } },
  esbuild: { jsx: "automatic" },
  test: { include: ["packages/*/test/**/*.test.ts", "apps/bot/test/**/*.test.ts", "apps/web/test/**/*.test.ts"], environment: "node" },
});
