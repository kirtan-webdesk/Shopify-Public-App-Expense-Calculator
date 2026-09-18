import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createStaticHandler, createStaticRouter, StaticRouterProvider } from "react-router";
import { describe, expect, it, vi } from "vitest";

// DB-free server-render smoke tests for the M4 pages: they render the real
// route components (history list, results with the save modal) from fixture
// loader data. The repository / shopify.server modules are stubbed BEFORE the
// route modules are imported so nothing here touches a database.
vi.mock("~/shopify.server", () => ({ authenticate: { admin: vi.fn() } }));
vi.mock("~/db/repositories/shop.repository", () => ({ findShopContextByDomain: vi.fn() }));
vi.mock("~/db/repositories/calculation.repository", () => ({
  countCalculationsForShop: vi.fn(),
  findCalculationWithLineItems: vi.fn(),
  insertCalculationSnapshot: vi.fn(),
  listCalculationsForShop: vi.fn(),
}));

import HistoryPage from "~/routes/app.history";
import ResultsPage from "~/routes/app.results";
import { SavedCalculationPage } from "~/components/saved-calculation-page";
import type { HistoryPage as HistoryPageData, SavedCalculationView } from "~/services/calculation-history.service";
import { decodeCalculationResult } from "~/domain/calculation-transport";
import { ENGINE_VERSION } from "~/domain/expense-engine";
import { buildDefaultResult, encodeDefaultResult } from "../helpers/calc-fixtures";

// The route components are typed against generated `Route.ComponentProps`;
// these tests supply only the props each component reads.
const asComponent = (c: unknown) => c as ComponentType<Record<string, unknown>>;

function history(items: HistoryPageData["items"], page = 1, totalPages = 1): { history: HistoryPageData } {
  return { history: { items, page, totalPages, totalCount: items.length, pageSize: 20 } };
}

describe("/app/history render", () => {
  it("renders the empty state (and no table) when nothing is saved", () => {
    const html = renderToStaticMarkup(createElement(asComponent(HistoryPage), { loaderData: history([]) }));
    expect(html).toContain("No saved calculations yet");
    expect(html).toContain("Go to calculator");
    expect(html).not.toContain("<table");
  });

  it("renders newest-first rows with View links, stored money, and pagination controls", () => {
    const items = [
      { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", savedAtIso: "2026-09-17T09:14:00.000Z", revenueMinor: 5_000_000, totalExpensesMinor: 3_662_000, netAmountMinor: 1_338_000, currencyCode: "USD" },
      { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", savedAtIso: "2026-09-03T16:02:00.000Z", revenueMinor: 4_200_000, totalExpensesMinor: 3_114_000, netAmountMinor: 1_086_000, currencyCode: "USD" },
    ];
    const html = renderToStaticMarkup(createElement(asComponent(HistoryPage), { loaderData: history(items, 2, 3) }));
    expect(html).toContain("Sep 17, 2026, 9:14 AM UTC");
    expect(html).toContain("$50,000.00");
    expect(html).toContain("$36,620.00");
    expect(html).toContain("$13,380.00");
    expect(html).toContain('href="/app/history/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"');
    expect(html.indexOf("aaaaaaaa-aaaa")).toBeLessThan(html.indexOf("bbbbbbbb-bbbb")); // order preserved
    expect(html).toContain("Page 2 of 3");
    expect(html).toContain('href="/app/history?page=1"'); // Previous
    expect(html).toContain('href="/app/history?page=3"'); // Next
    // No edit/delete affordance anywhere in the list.
    expect(html).not.toMatch(/delete|remove|edit/i);
  });

  it("disables Previous on the first page and Next on the last, without links", () => {
    const one = [{ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", savedAtIso: "2026-09-17T09:14:00.000Z", revenueMinor: 1, totalExpensesMinor: 0, netAmountMinor: 1, currencyCode: "USD" }];
    const html = renderToStaticMarkup(createElement(asComponent(HistoryPage), { loaderData: history(one, 1, 1) }));
    expect(html).not.toContain("/app/history?page=");
    expect(html).toContain("disabled");
  });
});

describe("/app/results render (with the save modal)", () => {
  function renderResults(loaderData: unknown) {
    const routes = [{ path: "/", Component: () => createElement(asComponent(ResultsPage), { loaderData }) }];
    const handler = createStaticHandler(routes);
    return handler.query(new Request("http://localhost/")).then((context) => {
      if (context instanceof Response) throw new Error("unexpected redirect");
      const router = createStaticRouter(handler.dataRoutes, context);
      return renderToStaticMarkup(createElement(StaticRouterProvider, { router, context, hydrate: false }));
    });
  }

  it("renders the Save button, the s-modal confirmation, and a form that posts the verified payload", async () => {
    const encoded = encodeDefaultResult();
    const result = decodeCalculationResult(encoded);
    const html = await renderResults({ result, encoded });
    expect(html).toContain("Save this calculation");
    expect(html).toContain('<s-modal id="save-calculation-modal"');
    expect(html).toContain('command="--show"');
    expect(html).toContain('command="--hide"');
    expect(html).toContain('name="intent" value="save"');
    expect(html).toContain(`name="d" value="${encoded}"`);
    expect(html).toContain("Estimate only — not saved yet");
    expect(html).toContain("Cost of Goods");
  });

  it("renders the no-calculation state without a save affordance", async () => {
    const html = await renderResults({ result: null, encoded: null });
    expect(html).toContain("No calculation yet");
    expect(html).not.toContain("save-calculation-modal");
  });
});

describe("saved-calculation detail render — frozen-snapshot signals", () => {
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
    expect(html).toContain("Snapshot");
    expect(html).toContain(`Engine version ${ENGINE_VERSION}`);
    expect(html).toMatch(/<s-badge[^>]*>.*<svg/);
  });

  it("has zero editable controls and no Save button", () => {
    expect(html).not.toMatch(/<input|<textarea|<select|<form/i);
    expect(html).not.toMatch(/<s-(text-field|number-field|money-field|select|checkbox|switch)/);
    expect(html).not.toMatch(/Save (this )?calculation/i);
  });

  it("offers Duplicate as new calculation as a plain link to the calculator with the source id", () => {
    expect(html).toContain("Duplicate as new calculation");
    expect(html).toContain(`href="/app/calculator?from=${saved.id}"`);
  });

  it("renders the stored figures (revenue, total, net, currency)", () => {
    expect(html).toContain("$50,000.00");
    expect(html).toContain("$36,620.00");
    expect(html).toContain("$13,380.00");
    expect(html).toContain(">USD<");
  });
});
