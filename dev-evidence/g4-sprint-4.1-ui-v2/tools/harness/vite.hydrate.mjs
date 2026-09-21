import { defineConfig } from "vite";
import path from "node:path";
const APP = process.env.APP_ROOT; const here = path.resolve(import.meta.dirname);
const stub = (f) => path.join(here, "stubs", f);
const alias = [
  { find: /^~\/shopify\.server$/, replacement: stub("shopify.server.ts") },
  { find: /^~\/services\/shop-context\.service$/, replacement: stub("shop-context.service.ts") },
  { find: /^~\/db\/repositories\/expense-rule\.repository$/, replacement: stub("expense-rule.repository.ts") },
  { find: /^~\/db\/repositories\/calculation\.repository$/, replacement: stub("calculation.repository.ts") },
  { find: /^~\/(.*)$/, replacement: path.join(APP, "app") + "/$1" },
];
const label = process.env.LABEL;
const ssr = process.env.SSR === "1";
export default defineConfig({
  root: here, logLevel: "warn", resolve: { alias }, define: ssr ? {} : { "process.env.NODE_ENV": JSON.stringify("development") },
  ssr: ssr ? { noExternal: [] } : undefined,
  build: ssr
    ? { ssr: path.join(here, "ssr.tsx"), outDir: path.join(here, "dist-ssr-" + label), emptyOutDir: true, minify: false, rollupOptions: { output: { entryFileNames: "ssr.mjs", format: "es" } } }
    : { outDir: path.join(here, "dist-hyd-" + label), emptyOutDir: true, minify: false, rollupOptions: { input: path.join(here, "entry-hydrate.tsx"), output: { entryFileNames: "entry.js", format: "es", inlineDynamicImports: true } } },
});
