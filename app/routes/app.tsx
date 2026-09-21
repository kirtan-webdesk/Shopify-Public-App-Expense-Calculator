import { Outlet } from "react-router";
import type { Route } from "./+types/app";
import { authenticate } from "~/shopify.server";

// /app layout — every child route renders through this. authenticate.admin
// validates the session-token JWT (route-auth matrix: embedded admin route).
//
// Navigation via <s-app-nav>/<s-link> (App Bridge web component, NOT
// Polaris — it renders into the Shopify admin chrome surrounding the app's
// iframe, per shopify.dev "App Bridge web components... control parts of
// the Shopify admin that surround it"), not a custom sidebar and not the
// legacy <ui-nav-menu>. Confirmed current (v1.1-rc, app-home domain) via
// Dev MCP search_docs_chunks — see the developer handoff's MCP evidence
// notes for why this is NOT run through validate_component_codeblocks:
// that validator's type universe is Polaris components
// (@shopify/polaris-types), and s-app-nav is an App Bridge component
// (@shopify/app-bridge-types), a different, out-of-scope namespace for that
// specific tool — not a defect in this code.
export async function loader({ request }: Route.LoaderArgs) {
  await authenticate.admin(request);
  return null;
}

export default function AppLayout() {
  return (
    <>
      {/* The calculator is the app's landing page, so it is designated the app
          HOME (rel="home") rather than listed as a child item. Per shopify.dev
          (App Bridge app-nav, verified via Dev MCP search_docs_chunks): a link
          with rel="home" "is hidden from the navigation menu"; the app name in
          the sidebar already links to the app's home route, so it opens
          /app/calculator, and exactly two children remain: "Expense rules"
          (the rules editor, /app/rules) and "History". Results and the
          history detail are deliberately NOT nav entries - each has one
          natural parent and a breadcrumb back to it (design/v2/IA-v2.md).
          Only one link may carry rel="home". */}
      <s-app-nav>
        <s-link href="/app/calculator" rel="home">
          Calculator
        </s-link>
        <s-link href="/app/rules">Expense rules</s-link>
        <s-link href="/app/history">History</s-link>
      </s-app-nav>
      <Outlet />
    </>
  );
}
