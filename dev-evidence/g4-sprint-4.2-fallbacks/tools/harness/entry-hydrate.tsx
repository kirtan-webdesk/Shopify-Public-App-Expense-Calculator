import { hydrateRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router";
import { routes } from "./routes";
(globalThis as any).Buffer = {
  from(input: string, enc: string) {
    const bytes = enc === "utf8" ? new TextEncoder().encode(input) : Uint8Array.from(atob(input.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
    return { toString(out: string) { if (out === "base64url") { let s = ""; bytes.forEach((b) => (s += String.fromCharCode(b))); return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); } return new TextDecoder().decode(bytes); } };
  },
};
(window as any).__toasts = [];
// NOTE: window.shopify is deliberately NOT defined here. Polaris s-page checks `window.shopify` to decide it is embedded in the Admin
// and, when it is, hoists its header (title, breadcrumbs, primary/secondary actions) OUT of the iframe into the Admin chrome. A stub
// would make every client-navigated page show no header. Interaction runs add a toast recorder with page.addInitScript instead.
const router = createBrowserRouter(routes, { hydrationData: (window as any).__staticRouterHydrationData });
(window as any).__router = router;
hydrateRoot(document.getElementById("root")!, <RouterProvider router={router} />);
