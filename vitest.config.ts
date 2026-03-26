import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const rootDir = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@healer/shared": fileURLToPath(new URL("./packages/shared/src/index.ts", import.meta.url)),
      "@healer/content": fileURLToPath(new URL("./packages/content/src/index.ts", import.meta.url)),
      "@healer/persistence": fileURLToPath(new URL("./packages/persistence/src/index.ts", import.meta.url))
    }
  },
  test: {
    environment: "node",
    include: ["packages/**/*.test.ts", "apps/**/*.test.ts"],
    root: rootDir
  }
});
