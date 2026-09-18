import { reactRouter } from "@react-router/dev/vite";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

// installGlobals-equivalent behaviour ships by default in @react-router/node 7.
declare module "react-router" {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface Future {}
}

export default defineConfig({
  server: {
    port: Number(process.env.PORT || 3000),
    // Required when running the Vite dev server behind the Shopify CLI's
    // tunnel/proxy for embedded-app local development.
    // VERIFY AT BUILD: exact allowedHosts / HMR config needed for the
    // resolved Shopify CLI version's tunnel host.
    allowedHosts: true,
  },
  plugins: [reactRouter(), tsconfigPaths()],
  build: {
    assetsInlineLimit: 0,
  },
});
