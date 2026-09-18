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
      <s-app-nav>
        <s-link href="/app/calculator">Calculator</s-link>
        <s-link href="/app/history">History</s-link>
      </s-app-nav>
      <Outlet />
    </>
  );
}
