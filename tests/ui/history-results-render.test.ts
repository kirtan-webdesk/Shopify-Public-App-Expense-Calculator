import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// DB-free server-render tests for the History, Results and History-detail pages
// (G4-sprint-4.1, G2-revision v2). They render the real route components from
// fixture loader data. The repository / shopify.server modules are stubbed BEFORE
// the route modules are imported so nothing here touches a database.
vi.mock("~/shopify.server", () => ({ authenticate: { admin: vi.fn() } }));
vi.mock("~/db/repositories/shop.repository", () => ({ findShopContextByDomain: vi.fn(), ensureShopContext: vi.fn() }));
vi.mock("~/db/repositories/calculation.repository", () => ({
  countCalculationsForShop: vi.fn(),
  findCalculationWithLineItems: vi.fn(),
  insertCalculationSnapshot: vi.fn(),
  listCalculationsForShop: vi.fn(),
}));

import HistoryPage from "~/routes/app.history";
import ResultsPage from "~/routes/app.results";
import HistoryDetailPage, { ErrorBoundary as HistoryDetailErrorBoundary } from "~/routes/app.history.$id";
import { SavedCalculationPage } from "~/components/saved-calculation-page";
import type { HistoryPage as HistoryPageData, SavedCalculationView } from "~/services/calculation-history.service";
import { decodeCalculationResult } from "~/domain/calculation-transport";
import { calculateExpenses, ENGINE_VERSION } from "~/domain/expense-engine";
import { CATEGORY_COLORS } from "~/domain/donut-chart";
import { buildDefaultResult, encodeDefaultResult } from "../helpers/calc-fixtures";
import { countTags, openingTag, renderRoute } from "../helpers/render-route";

function history(items: HistoryPageData["items"], page = 1, totalPages = 1): { history: HistoryPageData } {
  return { history: { items, page, totalPages, totalCount: items.length, pageSize: 20 } };
}
const renderHistory = (data: ReturnType<typeof history>) =>
  renderRoute(HistoryPage, data, "http://localhost/app/history", { passLoaderData: true });

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const rowA = { id: A, savedAtIso: "2026-09-17T09:14:00.000Z", revenueMinor: 5_000_000, totalExpensesMinor: 3_662_000, netAmountMinor: 1_338_000, currencyCode: "USD" };
const rowB = { id: B, savedAtIso: "2026-09-03T16:02:00.000Z", revenueMinor: 4_200_000, totalExpensesMinor: 3_114_000, netAmountMinor: 1_086_000, currencyCode: "CAD" };

describe("/app/history render", () => {
  it("empty state: heading, guidance, a Go to Calculator button, and no table and no header action", async () => {
    const html = await renderHistory(history([]));
    expect(html).toContain("No saved calculations yet");
    expect(html).toContain("Go to Calculator");
    expect(html).not.toContain("<s-table");
    expect(html).not.toContain('slot="primary-action"');
  });

  it("rows: the DATE is the link, there is no 'View' column, stored money and currency are shown, order is preserved", async () => {
    const html = await renderHistory(history([rowA, rowB]));
    expect(html).toContain(`<s-link href="/app/history/${A}">Sep 17, 2026, 9:14 AM UTC</s-link>`);
    expect(html).toContain(`<s-link href="/app/history/${B}">Sep 3, 2026, 4:02 PM UTC</s-link>`);
    expect(html).not.toMatch(/>View</);
    expect(countTags(html, "s-link")).toBe(2); // exactly one link per row - each with a unique name
    expect(html).toContain("$50,000.00");
    expect(html).toContain("$36,620.00");
    expect(html).toContain("$13,380.00");
    expect(html).toContain("<s-table-cell>USD</s-table-cell>");
    expect(html).toContain("<s-table-cell>CAD</s-table-cell>");
    expect(html.indexOf(A)).toBeLessThan(html.indexOf(B));
    expect(html).toContain("<s-table-header listSlot=\"primary\">Saved</s-table-header>");
  });

  it("has 'New calculation' as the header primary action linking to the Calculator", async () => {
    const html = await renderHistory(history([rowA]));
    const btn = html.match(/<s-button\b[^>]*>New calculation<\/s-button>/)?.[0] ?? "";
    expect(btn).toContain('slot="primary-action"');
    expect(btn).toContain('href="/app/calculator"');
  });

  it("states that every saved calculation is a snapshot", async () => {
    expect(await renderHistory(history([rowA]))).toContain("Every saved calculation is a snapshot");
  });

  it("no edit / delete affordance anywhere in the list", async () => {
    const html = await renderHistory(history([rowA, rowB], 2, 3));
    expect(html).not.toMatch(/delete|remove|edit/i);
  });

  it("pagination, middle page: 'Page 2 of 3' with working Previous and Next links", async () => {
    const html = await renderHistory(history([rowA, rowB], 2, 3));
    expect(html).toContain("Page 2 of 3");
    expect(html).toContain('href="/app/history?page=1"');
    expect(html).toContain('href="/app/history?page=3"');
  });

  it("pagination, first page: Previous is disabled and has no link", async () => {
    const html = await renderHistory(history([rowA], 1, 3));
    const prev = html.match(/<s-button\b[^>]*>Previous<\/s-button>/)![0];
    expect(prev).toContain("disabled");
    expect(prev).not.toContain("href");
    expect(html).toContain('href="/app/history?page=2"');
  });

  it("pagination, last page: Next is disabled and has no link", async () => {
    const html = await renderHistory(history([rowA], 3, 3));
    const next = html.match(/<s-button\b[^>]*>Next<\/s-button>/)![0];
    expect(next).toContain("disabled");
    expect(next).not.toContain("href");
    expect(html).toContain('href="/app/history?page=2"');
  });

  it("a single page shows no pagination controls at all", async () => {
    const html = await renderHistory(history([rowA], 1, 1));
    expect(html).not.toContain("/app/history?page=");
    expect(html).not.toContain("Previous");
  });

  it("the table is not in its loading state at rest", async () => {
    expect(openingTag(await renderHistory(history([rowA])), "s-table", "")).not.toContain("loading");
  });
});

describe("/app/results render", () => {
  const renderResults = (loaderData: unknown, url = "http://localhost/app/results") =>
    renderRoute(ResultsPage, loaderData, url, { passLoaderData: true });

  const encoded = encodeDefaultResult();
  const okData = { result: decodeCalculationResult(encoded), encoded, linkState: "ok" };

  it("header: breadcrumb to the Calculator, Save calculation (primary, opens the modal), Change revenue (secondary)", async () => {
    const html = await renderResults(okData);
    expect(html).toContain('<s-page heading="Results">');
    expect(html).toContain('<s-link slot="breadcrumb-actions" href="/app/calculator">Calculator</s-link>');
    const save = html.match(/<s-button\b[^>]*slot="primary-action"[^>]*>Save calculation<\/s-button>/)?.[0] ?? "";
    expect(save).toContain('commandFor="save-calculation-modal"');
    expect(save).toContain('command="--show"');
    expect(html).toMatch(/<s-button\b[^>]*slot="secondary-actions"[^>]*>Change revenue<\/s-button>/);
  });

  it("'Change revenue' carries revenue + currency back to a FILLED Calculator", async () => {
    const cad = buildDefaultResult(1_234_050, "CAD");
    const enc = encodeDefaultResult(1_234_050, "CAD");
    const html = await renderResults({ result: decodeCalculationResult(enc), encoded: enc, linkState: "ok" });
    expect(cad.revenueMinor).toBe(1_234_050);
    expect(html).toContain('href="/app/calculator?revenue=12340.50&amp;currency=CAD"');
  });

  it("keeps the save modal + the form that posts the transported payload for SERVER re-verification", async () => {
    const html = await renderResults(okData);
    expect(html).toContain('<s-modal id="save-calculation-modal"');
    expect(html).toContain('command="--hide"');
    expect(html).toContain('name="intent" value="save"');
    expect(html).toContain(`name="d" value="${encoded}"`);
  });

  it("states it is an estimate that uses the SAVED rules, with placeholder labelling", async () => {
    const html = await renderResults(okData);
    expect(html).toContain("Estimate only, not saved yet");
    expect(html).toContain("<strong>saved</strong> rules");
    expect(html).toContain("illustrative placeholders");
    expect(html).not.toContain("unsaved edits");
  });

  it("shows Revenue / Total expenses / Net as three tiles laid out by an s-grid inside an s-query-container (R1)", async () => {
    const html = await renderResults(okData);
    expect(html).toContain('gridTemplateColumns="@container (inline-size &gt; 560px) 1fr 1fr 1fr, 1fr"');
    expect(html.indexOf("<s-query-container>")).toBeLessThan(html.indexOf("1fr 1fr 1fr, 1fr"));
    // A comma INSIDE a container-query branch (repeat(3, 1fr)) is mis-parsed by s-grid and leaves one column.
    expect(html).not.toMatch(/gridTemplateColumns="[^"]*repeat\(/);
    expect(html).toContain("Revenue</s-text>");
    expect(html).toContain("Total expenses</s-text>");
    expect(html).toContain("Net</s-text>");
    expect(html).toContain("$50,000.00");
    expect(html).toContain("$36,620.00");
    expect(html).toContain("$13,380.00");
    expect(html).toContain("73.2% of revenue");
    expect(html).not.toContain("Expenses exceed revenue");
  });

  it("the breakdown TABLE comes first, under the 'Expense breakdown' heading; the donut is supplementary and after it (ADR-0004)", async () => {
    const html = await renderResults(okData);
    expect(html.indexOf('heading="Expense breakdown"')).toBeLessThan(html.indexOf("<s-table"));
    expect(openingTag(html, "s-table", "")).not.toContain("aria-label"); // a host aria-label is not exposed as the grid's name
    expect(html.indexOf("<s-table")).toBeLessThan(html.indexOf("<svg"));
    expect(html).toContain("Amount (USD)");
    expect(countTags(html, "s-table-row")).toBe(11); // 10 categories + the total row (the header row is s-table-header-row)
    expect(html).toContain("Cost of Goods");
    expect(html).toContain("<strong>Total expenses</strong>");
  });

  it("the donut has a summarising aria-label naming its basis, decorative children, swatches from the palette, and a legend with 'Left over (net)'", async () => {
    const html = await renderResults(okData);
    const svg = html.match(/<svg[^>]*role="img"[^>]*>/)![0];
    expect(svg).toContain("shown as a share of revenue");
    expect(svg).toContain("Full figures are in the table above.");
    expect(html).toContain("Share of revenue");
    expect(html).toContain("Left over (net)");
    for (const color of Object.values(CATEGORY_COLORS)) expect(html.toLowerCase()).toContain(color.toLowerCase());
    expect(html).not.toContain("#5C6AC4"); // a v1 colour
    for (const c of html.match(/<circle\b[^>]*>/g) ?? []) expect(c).toContain('aria-hidden="true"');
  });

  it("zero revenue: an explaining banner, dashes for %, and the donut plotted by share of total expenses", async () => {
    const zero = calculateExpenses({
      revenueMinor: 0,
      currencyCode: "USD",
      rules: buildDefaultResult().lineItems.map((li) => ({ ...li, enabled: true })),
    });
    const html = await renderResults({ result: zero, encoded, linkState: "ok" });
    expect(html).toContain("Revenue is 0");
    expect(html).toContain("Share of total expenses");
    expect(html).toContain("There is no revenue to compare against");
    expect(html).toContain("<span class=\"tabular\">—</span>");
    expect(html).not.toContain("No data");
    expect(html).not.toContain("Left over (net)");
  });

  it("expenses exceed revenue: warning banner AND a text badge (not colour alone), ring by share of total expenses", async () => {
    const enc = encodeDefaultResult(100_000);
    const html = await renderResults({ result: decodeCalculationResult(enc), encoded: enc, linkState: "ok" });
    expect(html).toContain("Expenses are higher than revenue");
    const badge = html.match(/<s-badge\b[^>]*>Expenses exceed revenue<\/s-badge>/)?.[0] ?? "";
    expect(badge).toContain('icon="alert-circle"');
    expect(html).toContain("Share of total expenses");
    expect(html).toContain("because expenses are higher than revenue");
  });

  it("all rules off: a 'no rules switched on' banner, a table row saying so, and the donut's empty state", async () => {
    const none = { ...buildDefaultResult(), lineItems: [], totalExpensesMinor: 0, netAmountMinor: 5_000_000 };
    const html = await renderResults({ result: none, encoded, linkState: "ok" });
    expect(html).toContain("No expense rules are switched on");
    expect(html).toContain("No expense rules are enabled for this calculation.");
    expect(html).toContain("Nothing to plot");
    expect(html).toContain("No data");
    expect(html).toContain("No expenses to display yet.");
  });

  it("single category: the ring is one full slice", async () => {
    const one = calculateExpenses({
      revenueMinor: 1_000_000,
      currencyCode: "USD",
      rules: [{ categoryKey: "cost_of_goods", enabled: true, ruleType: "percentage", rateBasisPoints: 10_000, fixedAmountMinor: null, formulaKey: null }],
    });
    const html = await renderResults({ result: one, encoded, linkState: "ok" });
    expect((html.match(/<circle\b[^>]*stroke-dasharray=/g) ?? []).length).toBe(1); // one slice (plus the grey track)
    expect(html).toContain('stroke-dasharray="100 0"');
  });

  it("small slices stay visible (floored dash) and the legend lists every category", async () => {
    const res = calculateExpenses({
      revenueMinor: 10_000_000,
      currencyCode: "USD",
      rules: [
        { categoryKey: "cost_of_goods", enabled: true, ruleType: "percentage", rateBasisPoints: 9600, fixedAmountMinor: null, formulaKey: null },
        { categoryKey: "misc", enabled: true, ruleType: "fixed", rateBasisPoints: null, fixedAmountMinor: 100, formulaKey: null },
      ],
    });
    const html = await renderResults({ result: res, encoded, linkState: "ok" });
    expect(html).toMatch(/stroke-dasharray="0\.6 99\.4"/);
    expect(html).toContain("Misc");
  });

  it("invalid link: a critical banner, no save affordance, no table", async () => {
    const html = await renderResults({ result: null, encoded: null, linkState: "invalid" }, "http://localhost/app/results?d=garbage");
    expect(html).toContain("This results link isn&#x27;t valid");
    expect(html).toContain("Run a new calculation");
    expect(html).not.toContain("save-calculation-modal");
    expect(html).not.toContain("Save calculation");
    expect(html).not.toContain("<s-table");
  });

  it("no calculation yet: an info banner pointing back to the Calculator, no save affordance", async () => {
    const html = await renderResults({ result: null, encoded: null, linkState: "none" });
    expect(html).toContain("No calculation yet");
    expect(html).toContain("Go to Calculator");
    expect(html).not.toContain("save-calculation-modal");
  });
});

describe("/app/results loader link states", () => {
  it("distinguishes 'no ?d' from 'a ?d that does not decode' and never throws", async () => {
    const { loader } = await import("~/routes/app.results");
    const { authenticate } = await import("~/shopify.server");
    vi.mocked(authenticate.admin).mockResolvedValue({ session: { shop: "x.myshopify.com" } } as never);
    const load = (qs: string) =>
      loader({ request: new Request(`http://localhost/app/results${qs}`) } as never) as Promise<{ linkState: string; result: unknown; encoded: unknown }>;
    expect((await load("")).linkState).toBe("none");
    for (const bad of ["?d=garbage", "?d=", "?d=e30", "?d=" + "A".repeat(50_000)]) {
      const r = await load(bad);
      expect(["invalid", "none"], bad).toContain(r.linkState);
      expect(r.result).toBeNull();
      expect(r.encoded).toBeNull();
    }
    // an unsupported currency in an otherwise well-formed payload
    const { tamperTransport } = await import("../helpers/calc-fixtures");
    const jpy = tamperTransport(encodeDefaultResult(), (p) => {
      p.c = "JPY";
    });
    expect((await load(`?d=${jpy}`)).linkState).toBe("invalid");
    const ok = await load(`?d=${encodeDefaultResult()}`);
    expect(ok.linkState).toBe("ok");
    expect(ok.encoded).toBe(encodeDefaultResult());
  });
});

describe("saved-calculation detail render - frozen-snapshot signals", () => {
  const result = buildDefaultResult();
  const saved: SavedCalculationView = {
    id: "3f2b8c1e-9a4d-4e0b-8f6a-1c2d3e4f5a6b",
    savedAtIso: "2026-09-17T09:14:00.000Z",
    engineVersion: ENGINE_VERSION,
    result,
  };
  const html = renderToStaticMarkup(createElement(SavedCalculationPage, { saved }));

  it("leads with the explicit-copy banner, before any number", () => {
    expect(html).toContain("This is a saved snapshot");
    expect(html).toContain("Sep 17, 2026, 9:14 AM UTC");
    expect(html.indexOf("This is a saved snapshot")).toBeLessThan(html.indexOf("$50,000.00"));
  });

  it("shows the lock-icon Snapshot badge with the stored engine_version", () => {
    expect(html).toMatch(/<s-badge[^>]*icon="lock"[^>]*>Snapshot<\/s-badge>/);
    expect(html).toContain(`Engine version ${ENGINE_VERSION}`);
  });

  it("has zero editable controls and no Save button", () => {
    expect(html).not.toMatch(/<input|<textarea|<select|<form/i);
    expect(html).not.toMatch(/<s-(text-field|number-field|money-field|select|checkbox|switch)/);
    expect(html).not.toMatch(/Save (this )?calculation/i);
    expect(html).not.toContain('slot="primary-action"');
  });

  it("offers Duplicate as new calculation as a header link to the calculator with the source id", () => {
    expect(html).toMatch(/<s-button[^>]*slot="secondary-actions"[^>]*>Duplicate as new calculation<\/s-button>/);
    expect(html).toContain(`href="/app/calculator?from=${saved.id}"`);
  });

  it("breadcrumbs back to History and links to the CURRENT rules", () => {
    expect(html).toContain('<s-link slot="breadcrumb-actions" href="/app/history">History</s-link>');
    expect(html).toContain('<s-link href="/app/rules">View my current rules</s-link>');
  });

  it("renders the stored figures with 'as saved' labels, the table and the donut", () => {
    expect(html).toContain("Revenue (as saved)");
    expect(html).toContain("Total expenses (as saved)");
    expect(html).toContain("Net (as saved)");
    expect(html).toContain("$50,000.00");
    expect(html).toContain("$36,620.00");
    expect(html).toContain("$13,380.00");
    expect(html).toContain("Rule applied (at save time)");
    expect(html).toContain("Amount (USD)");
    expect(html).toContain("<svg");
  });

  it("only the redirect right after Save shows the 'Calculation saved' banner", () => {
    expect(html).not.toContain("Calculation saved");
    const just = renderToStaticMarkup(createElement(SavedCalculationPage, { saved, justSaved: true }));
    expect(just).toContain('<s-banner tone="success" heading="Calculation saved" dismissible="">');
  });

  it("a saved calculation in another currency states that currency in the tiles and the table", () => {
    const eur = { ...saved, result: buildDefaultResult(5_000_000, "EUR") };
    const eurHtml = renderToStaticMarkup(createElement(SavedCalculationPage, { saved: eur }));
    expect(eurHtml).toContain("Amount (EUR)");
    expect(eurHtml).toContain("€50,000.00");
  });
});

describe("/app/history/:id - loader shape and the identical 404", () => {
  it("renders the snapshot page from loader data", async () => {
    const saved: SavedCalculationView = {
      id: "3f2b8c1e-9a4d-4e0b-8f6a-1c2d3e4f5a6b",
      savedAtIso: "2026-09-17T09:14:00.000Z",
      engineVersion: ENGINE_VERSION,
      result: buildDefaultResult(),
    };
    const page = await renderRoute(HistoryDetailPage, { saved, justSaved: false }, "http://localhost/app/history/x", { passLoaderData: true });
    expect(page).toContain("This is a saved snapshot");
  });

  it("the not-found state is one message that says nothing about WHY (missing, other shop, malformed)", () => {
    const notFound = new Response("Saved calculation not found.", { status: 404 });
    const err = { status: 404, statusText: "", data: "Saved calculation not found.", internal: true };
    void notFound;
    const html = renderToStaticMarkup(
      createElement(HistoryDetailErrorBoundary as unknown as (p: { error: unknown }) => never, { error: err }),
    );
    expect(html).toContain("Saved calculation not found");
    expect(html).toContain("It may have been removed, or the link is wrong.");
    expect(html).toContain('href="/app/history"');
    expect(html).not.toMatch(/other shop|another shop|forbidden|permission|malformed|invalid id/i);
  });
});
