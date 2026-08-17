import { defineConfig } from "vite";

export default defineConfig({
  root: "src/ui",
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
