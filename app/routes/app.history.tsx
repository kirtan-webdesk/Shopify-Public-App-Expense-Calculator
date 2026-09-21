import { useNavigation } from "react-router";
import type { Route } from "./+types/app.history";
import { authenticate } from "~/shopify.server";
import { requireShopContext } from "~/services/shop-context.service";
import { getHistoryPage, parsePageParam } from "~/services/calculation-history.service";
import { formatMoney, formatSavedAt } from "~/domain/presentation";

// --------------------------------------------------------------------------
// /app/history - M4 saved-calculations list (D11), G2-revision v2
// (design/v2/history.html).
//
// Newest first, Previous/Next pagination, an empty state, and a loading state
// while a page navigation is in flight. The DATE is the row link (every link
// has a unique accessible name; a column of identical "View" links would be
// ambiguous for a screen reader), so there is no "View" column. The table is
// an s-table, which is a real table on wide iframes and a list on narrow ones
// (no horizontal-scroll wrapper needed). "New calculation" is the one primary
// action in the header.
//
// Read-only and tenant-scoped: the page is produced by the history service
// through the repository with the authenticated shop's context - there is no
// edit or delete affordance anywhere (calculations are append-only).
// --------------------------------------------------------------------------

export async function loader({ request }: Route.LoaderArgs) {
  const { session } = await authenticate.admin(request);
  const ctx = await requireShopContext(session);
  const requestedPage = parsePageParam(new URL(request.url).searchParams.get("page"));
  return { history: await getHistoryPage(ctx, requestedPage) };
}

export default function HistoryPage({ loaderData }: Route.ComponentProps) {
  const { history } = loaderData;
  const { items, page, totalPages } = history;
  // The table shows its own loading state while the next page is being fetched.
  const navigation = useNavigation();
  const isLoading = navigation.state === "loading" && navigation.location.pathname.startsWith("/app/history");

  if (items.length === 0) {
    return (
      <s-page heading="History">
        {/* Empty state, composed from stack/heading/paragraph/button: the safest
            cross-version composition (design/v2/history.html). */}
        <s-section>
          <s-stack gap="base" alignItems="center">
            <s-heading>No saved calculations yet</s-heading>
            <s-paragraph color="subdued">
              Run a calculation and select <strong>Save calculation</strong> on the results page. Saved
              calculations appear here, newest first.
            </s-paragraph>
            <s-button variant="primary" href="/app/calculator">
              Go to Calculator
            </s-button>
          </s-stack>
        </s-section>
      </s-page>
    );
  }

  return (
    <s-page heading="History">
      <s-button slot="primary-action" variant="primary" href="/app/calculator">
        New calculation
      </s-button>

      <s-stack gap="base">
        <s-section padding="none">
          <s-table loading={isLoading}>
            <s-table-header-row>
              <s-table-header listSlot="primary">Saved</s-table-header>
              <s-table-header format="currency">Revenue</s-table-header>
              <s-table-header format="currency">Total expenses</s-table-header>
              <s-table-header format="currency">Net</s-table-header>
              <s-table-header listSlot="secondary">Currency</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {items.map((item) => (
                <s-table-row key={item.id}>
                  <s-table-cell>
                    <s-link href={`/app/history/${item.id}`}>{formatSavedAt(item.savedAtIso)}</s-link>
                  </s-table-cell>
                  <s-table-cell>{formatMoney(item.revenueMinor, item.currencyCode)}</s-table-cell>
                  <s-table-cell>{formatMoney(item.totalExpensesMinor, item.currencyCode)}</s-table-cell>
                  <s-table-cell>{formatMoney(item.netAmountMinor, item.currencyCode)}</s-table-cell>
                  <s-table-cell>{item.currencyCode}</s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        </s-section>

        {totalPages > 1 && (
          <s-stack direction="inline" gap="small" alignItems="center" justifyContent="end">
            <s-text color="subdued">
              Page {page} of {totalPages}
            </s-text>
            <s-button disabled={page <= 1} href={page > 1 ? `/app/history?page=${page - 1}` : undefined}>
              Previous
            </s-button>
            <s-button disabled={page >= totalPages} href={page < totalPages ? `/app/history?page=${page + 1}` : undefined}>
              Next
            </s-button>
          </s-stack>
        )}

        <s-text color="subdued">
          Every saved calculation is a snapshot: it keeps the revenue and rule values from the moment it was saved,
          even if you change your rules later.
        </s-text>
      </s-stack>
    </s-page>
  );
}
