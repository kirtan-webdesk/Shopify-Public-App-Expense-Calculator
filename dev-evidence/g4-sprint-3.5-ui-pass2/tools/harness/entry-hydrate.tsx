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
(window as any).shopify = { toast: { show: (m: string) => (window as any).__toasts.push(m) } };
const router = createBrowserRouter(routes, { hydrationData: (window as any).__staticRouterHydrationData });
(window as any).__router = router;
hydrateRoot(document.getElementById("root")!, <RouterProvider router={router} />);
