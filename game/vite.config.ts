import { defineConfig } from "vitest/config";

export default defineConfig({
  server: { port: 5173, strictPort: false },
  build: { target: "es2023", outDir: "dist" },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    testTimeout: 120_000,
  },
});
