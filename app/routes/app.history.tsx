import type { Route } from "./+types/app.history";
import { authenticate } from "~/shopify.server";
import { requireShopContext } from "~/services/shop-context.service";
import { getHistoryPage, parsePageParam } from "~/services/calculation-history.service";
import { formatMoney, formatSavedAt } from "~/domain/presentation";

// --------------------------------------------------------------------------
// /app/history — M4 saved-calculations list (D11).
//
// Ports design/mockup/history.html (G2-confirmed): a native <table> (same
// accessibility choice as the results table, ADR-0004), newest first,
// Previous/Next pagination, and the "no saved calculations yet" empty state.
// The mockup's "design review aid" empty-state toggle is a review-only
// control and is NOT reintroduced.
//
// Read-only and tenant-scoped: the page is produced by the history service
// through the repository with the authenticated shop's context — there is no
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

  return (
    <s-page heading="History">
      <s-section heading="Saved calculations">
        <p
          style={{
            color: "var(--p-color-text-secondary, #616161)",
            fontSize: "0.8125rem",
            marginBlockEnd: "12px",
          }}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 16 16"
            aria-hidden="true"
            style={{ verticalAlign: "-2px", marginInlineEnd: "4px" }}
          >
            <rect x="3" y="7" width="10" height="7" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.3" />
            <path d="M5 7V5a3 3 0 016 0v2" fill="none" stroke="currentColor" strokeWidth="1.3" />
          </svg>
          Every saved calculation is a snapshot — it keeps the revenue and rule values from the
          moment it was saved, even if you change your default rules later.
        </p>

        {items.length === 0 ? (
          <s-banner tone="info" heading="No saved calculations yet">
            <p>
              Run a calculation and select <strong>Save this calculation</strong> on the results
              page to start building your history.
            </p>
            <s-button slot="action" href="/app/calculator">
              Go to calculator
            </s-button>
          </s-banner>
        ) : (
          <div>
            <table className="data-table">
              <caption className="visually-hidden">Saved calculations, newest first</caption>
              <thead>
                <tr>
                  <th scope="col">Saved</th>
                  <th scope="col" className="numeric">
                    Revenue
                  </th>
                  <th scope="col" className="numeric">
                    Total expenses
                  </th>
                  <th scope="col" className="numeric">
                    Net
                  </th>
                  <th scope="col">Currency</th>
                  <th scope="col">
                    <span className="visually-hidden">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id}>
                    <td>{formatSavedAt(item.savedAtIso)}</td>
                    <td className="numeric">{formatMoney(item.revenueMinor, item.currencyCode)}</td>
                    <td className="numeric">{formatMoney(item.totalExpensesMinor, item.currencyCode)}</td>
                    <td className="numeric">{formatMoney(item.netAmountMinor, item.currencyCode)}</td>
                    <td>{item.currencyCode}</td>
                    <td>
                      <s-link href={`/app/history/${item.id}`}>View</s-link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                alignItems: "center",
                gap: "8px",
                marginBlockStart: "16px",
              }}
            >
              <span style={{ color: "var(--p-color-text-secondary, #616161)", fontSize: "0.8125rem" }}>
                Page {page} of {totalPages}
              </span>
              <s-button disabled={page <= 1} href={page > 1 ? `/app/history?page=${page - 1}` : undefined}>
                Previous
              </s-button>
              <s-button
                disabled={page >= totalPages}
                href={page < totalPages ? `/app/history?page=${page + 1}` : undefined}
              >
                Next
              </s-button>
            </div>
          </div>
        )}
      </s-section>
    </s-page>
  );
}
