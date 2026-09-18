import type { ReactNode } from "react";
import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useLoaderData,
} from "react-router";
import type { Route } from "./+types/root";
import appStylesHref from "./styles/app.css?url";

// M2/M3: the app's own layout stylesheet (ported from the G2-approved
// mockup — see app/styles/app.css's header). Registered once here so it
// loads on every route, the same "one place, can't be forgotten per-route"
// reasoning already applied to the App Bridge/Polaris <script> tags below.
export const links: Route.LinksFunction = () => [{ rel: "stylesheet", href: appStylesHref }];

// --------------------------------------------------------------------------
// App Bridge + Polaris in <head> of EVERY page (App Store Req 2.2.3 /
// shopify-polaris-app-bridge skill). Both scripts load from the Shopify CDN
// — never vendored/pinned — so the app always resolves the latest App
// Bridge. The API-key <meta> MUST precede app-bridge.js.
//
// Root is the single layout every route renders through, so putting both
// tags here (rather than repeating them per-route) is what actually
// GUARANTEES "every page", not a convention that can be forgotten on a new
// route file.
// --------------------------------------------------------------------------

export async function loader() {
  return { apiKey: process.env.SHOPIFY_API_KEY || "" };
}

export function Layout({ children }: { children: ReactNode }) {
  const data = useLoaderData<typeof loader>() as { apiKey: string } | undefined;
  const apiKey = data?.apiKey ?? "";

  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        {/* API-key meta MUST precede app-bridge.js — see shopify-app-scaffold skill. */}
        <meta name="shopify-api-key" content={apiKey} />
        <script src="https://cdn.shopify.com/shopifycloud/app-bridge.js"></script>
        <script src="https://cdn.shopify.com/shopifycloud/polaris.js"></script>
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return <Outlet />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  console.error(error);
  return (
    <s-page heading="Something went wrong">
      <s-banner tone="critical" heading="Unexpected error">
        <p>
          Something went wrong loading this page. No details are shown here
          to avoid leaking internals — this event has been logged.
        </p>
      </s-banner>
    </s-page>
  );
}
