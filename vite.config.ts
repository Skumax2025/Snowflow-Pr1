import { defineConfig } from "vite";
import { apiDevServer } from "./tools/apiDevServer.js";

export default defineConfig({
  root: "src/ui",
  plugins: [apiDevServer()],
  build: {
    outDir: "../../dist",
    emptyOutDir: true,
  },
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts"],
    root: process.cwd(),
  },
} as never);
