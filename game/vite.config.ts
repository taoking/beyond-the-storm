import { searchForWorkspaceRoot } from "vite";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // 四间的坐标和底图在仓库根目录的 assets/05/，不复制进 game/
  server: { port: 5173, strictPort: false, fs: { allow: [searchForWorkspaceRoot(process.cwd()), "../assets/05"] } },
  build: { target: "es2023", outDir: "dist" },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    testTimeout: 120_000,
  },
});
