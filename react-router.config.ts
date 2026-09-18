import type { Config } from "@react-router/dev/config";

export default {
  // Server-side rendering only — this is an embedded admin app, not a
  // static/pre-rendered site. No SSG/pre-rendering routes.
  ssr: true,
  appDirectory: "app",
} satisfies Config;
