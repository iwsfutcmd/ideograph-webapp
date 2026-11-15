import { defineConfig } from "vitest/config";

export default defineConfig({
  // Relative asset URLs, so the site works at https://<user>.github.io/<repo>/
  // as well as at a domain root.
  base: "./",
  build: { target: "es2022" },
  test: { include: ["tests/**/*.test.ts"] },
});
