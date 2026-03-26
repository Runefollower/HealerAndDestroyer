import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@healer/shared": fileURLToPath(new URL("../../packages/shared/src/index.ts", import.meta.url)),
      "@healer/content": fileURLToPath(new URL("../../packages/content/src/index.ts", import.meta.url))
    }
  },
  server: {
    port: 5173
  }
});

