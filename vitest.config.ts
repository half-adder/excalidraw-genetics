import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/unit/**/*.test.ts"],
    environment: "node",
    // The obsidian package has no runtime entry; unit tests get a stub.
    alias: { obsidian: fileURLToPath(new URL("./tests/unit/helpers/obsidian-stub.ts", import.meta.url)) },
  },
});
