import { useEffect } from "react";
import { isRouteErrorResponse } from "react-router";
import type { Route } from "./+types/app.history.$id";
import { authenticate } from "~/shopify.server";
import { requireShopContext } from "~/services/shop-context.service";
import { getSavedCalculation } from "~/services/calculation-history.service";
import { SavedCalculationPage } from "~/components/saved-calculation-page";

// --------------------------------------------------------------------------
// /app/history/:id — M4 saved-calculation detail (D11).
//
// Renders STORED values only (app/services/calculation-history.service.ts
// rebuilds the view from the calculation + calculation_line_item rows). It
// never recomputes with the engine and never consults expense_rule, so
// editing live rules afterwards cannot change what this page shows (FT-14a).
//
// Tenant isolation (D12): the lookup is scoped by the authenticated shop.
// Another shop's id, a nonexistent id, and a malformed id all produce the
// SAME 404 response, so the route cannot be used to probe which ids exist.
//
// There is deliberately NO action on this route: saved calculations are
// append-only in normal operation (no edit, no delete UI — deletion happens
// only through the shop/redact cascade).
// --------------------------------------------------------------------------

export async function loader({ request, params }: Route.LoaderArgs) {
  const { session } = await authenticate.admin(request);
  const ctx = await requireShopContext(session);

  const saved = await getSavedCalculation(ctx, params.id);
  if (!saved) {
    // One response for "not yours", "does not exist" and "not an id".
    throw new Response("Saved calculation not found.", { status: 404 });
  }

  const justSaved = new URL(request.url).searchParams.get("saved") === "1";
  return { saved, justSaved };
}

interface ToastHost {
  readonly shopify?: { readonly toast?: { readonly show: (message: string) => void } };
}

export default function HistoryDetailPage({ loaderData }: Route.ComponentProps) {
  const { saved, justSaved } = loaderData;

  // App Bridge toast for the save confirmation (design notes §5). The global
  // is provided by the App Bridge script in <head>; absent outside the admin
  // iframe, in which case the snapshot banner below is the confirmation.
  useEffect(() => {
    if (!justSaved) return;
    (window as unknown as ToastHost).shopify?.toast?.show("Calculation saved");
    // The toast is a one-time confirmation of the redirect that just happened.
    // Drop the `saved` flag from the address bar (no navigation, no loader
    // re-run) so reloading or re-opening this URL does not replay it.
    const url = new URL(window.location.href);
    if (url.searchParams.has("saved")) {
      url.searchParams.delete("saved");
      window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
    }
  }, [justSaved]);

  return <SavedCalculationPage saved={saved} justSaved={justSaved} />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  if (isRouteErrorResponse(error) && error.status === 404) {
    // The same message for a nonexistent id, another shop's id and a malformed
    // id: nothing here says which of the three it was.
    return (
      <s-page heading="Saved calculation">
        <s-link slot="breadcrumb-actions" href="/app/history">
          History
        </s-link>
        <s-banner tone="critical" heading="Saved calculation not found">
          <s-paragraph>
            It may have been removed, or the link is wrong. <s-link href="/app/history">Back to History</s-link>
          </s-paragraph>
        </s-banner>
      </s-page>
    );
  }

  console.error(error);
  return (
    <s-page heading="Something went wrong">
      <s-banner tone="critical" heading="Unexpected error">
        <s-paragraph>
          Something went wrong loading this page. No details are shown here to avoid leaking
          internals - this event has been logged.
        </s-paragraph>
      </s-banner>
    </s-page>
  );
}
