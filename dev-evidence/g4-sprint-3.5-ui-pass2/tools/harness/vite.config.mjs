import { defineConfig } from "vite";
import path from "node:path";
const APP = process.env.APP_ROOT; // dir containing app/
const here = path.resolve(import.meta.dirname);
const stub = (f) => path.join(here, "stubs", f);
export default defineConfig({
  root: here,
  logLevel: "warn",
  define: { "process.env.NODE_ENV": JSON.stringify("development") },
  resolve: {
    alias: [
      { find: /^~\/shopify\.server$/, replacement: stub("shopify.server.ts") },
      { find: /^~\/services\/shop-context\.service$/, replacement: stub("shop-context.service.ts") },
      { find: /^~\/db\/repositories\/expense-rule\.repository$/, replacement: stub("expense-rule.repository.ts") },
      { find: /^~\/services\/calculation-history\.service$/, replacement: stub("calculation-history.service.ts") },
      { find: /^~\/(.*)$/, replacement: path.join(APP, "app") + "/$1" },
    ],
  },
  build: {
    outDir: path.join(here, "dist-" + (process.env.LABEL || "after")),
    emptyOutDir: true,
    minify: false,
    rollupOptions: { input: path.join(here, "entry.tsx"), output: { entryFileNames: "entry.js", format: "es", inlineDynamicImports: true } },
  },
});
