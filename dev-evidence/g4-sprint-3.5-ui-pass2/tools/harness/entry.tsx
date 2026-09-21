import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider, useLoaderData, useRouteError } from "react-router";
import * as calculator from "~/routes/app.calculator";
import * as results from "~/routes/app.results";
import * as history from "~/routes/app.history";
import * as appIndex from "~/routes/app._index";
import AppLayout from "~/routes/app";

// Buffer shim (transport uses Node Buffer; browsers have none)
(globalThis as any).Buffer = {
  from(input: string, enc: string) {
    const bytes = enc === "utf8" ? new TextEncoder().encode(input) : Uint8Array.from(atob(input.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
    return {
      toString(out: string) {
        if (out === "base64url") { let s = ""; bytes.forEach((b) => (s += String.fromCharCode(b))); return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
        return new TextDecoder().decode(bytes);
      },
    };
  },
};
(window as any).__toasts = [];
(window as any).shopify = { toast: { show: (m: string) => (window as any).__toasts.push(m) } };

function withLoaderData(C: any) { return function W() { const d = useLoaderData(); return <C loaderData={d} />; }; }
function Boundary() { const e: any = useRouteError(); return <pre id="route-error">{String(e?.message ?? e?.statusText ?? e)}</pre>; }

const router = createBrowserRouter([
  { path: "/", loader: () => { throw new Response(null, { status: 302, headers: { Location: "/app/calculator" } }); } },
  {
    path: "/app",
    Component: AppLayout,
    loader: appLayoutLoader as any,
    ErrorBoundary: Boundary,
    children: [
      { index: true, loader: appIndex.loader as any },
      { path: "calculator", Component: calculator.default, loader: calculator.loader as any, action: calculator.action as any, ErrorBoundary: Boundary },
      { path: "results", Component: withLoaderData(results.default), loader: results.loader as any, action: results.action as any, ErrorBoundary: Boundary },
      { path: "history", Component: withLoaderData(history.default), loader: history.loader as any, ErrorBoundary: Boundary },
    ],
  },
]);
function appLayoutLoader() { return null; }
(window as any).__router = router;
createRoot(document.getElementById("root")!).render(<RouterProvider router={router} />);
