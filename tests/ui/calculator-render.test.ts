import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createStaticHandler, createStaticRouter, StaticRouterProvider } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

// DB-free tests of the calculator route (G4-sprint-3.5): the server-rendered
// markup (currency/formula selects, hidden submitted values, checkbox label),
// the action (revenue text validation, Save with a disabled blank row), the
// app nav (rel="home") and the /app redirect. authenticate / the shop-context
// service / every repository are stubbed BEFORE the route modules import.

vi.mock("~/shopify.server", () => ({ authenticate: { admin: vi.fn() } }));
vi.mock("~/services/shop-context.service", () => ({ requireShopContext: vi.fn() }));
vi.mock("~/db/repositories/shop.repository", () => ({ findShopContextByDomain: vi.fn(), ensureShopContext: vi.fn() }));
vi.mock("~/db/repositories/calculation.repository", () => ({
  countCalculationsForShop: vi.fn(),
  findCalculationWithLineItems: vi.fn(),
  insertCalculationSnapshot: vi.fn(),
  listCalculationsForShop: vi.fn(),
}));
const ruleRepo = vi.hoisted(() => ({
  listExpenseRulesForShop: vi.fn(),
  replaceExpenseRulesForShop: vi.fn(),
  seedExpenseRulesIfMissing: vi.fn(),
}));
vi.mock("~/db/repositories/expense-rule.repository", () => ruleRepo);

import { authenticate } from "~/shopify.server";
import { requireShopContext } from "~/services/shop-context.service";
import CalculatorPage, { action as calculatorAction } from "~/routes/app.calculator";
import AppLayout from "~/routes/app";
import { loader as appIndexLoader } from "~/routes/app._index";
import { EXPENSE_CATEGORIES } from "~/domain/expense-categories";
import { DEFAULT_EXPENSE_RULES } from "~/domain/expense-rule-defaults";

const asComponent = (c: unknown) => c as ComponentType<Record<string, unknown>>;
const ctx = { shopId: "11111111-1111-4111-8111-111111111111", shopDomain: "x.myshopify.com" };

const rules = DEFAULT_EXPENSE_RULES.map((d) => {
  const c = EXPENSE_CATEGORIES.find((x) => x.key === d.categoryKey)!;
  return {
    categoryKey: d.categoryKey,
    categoryLabel: c.label,
    sortOrder: c.sortOrder,
    enabled: true,
    ruleType: d.ruleType,
    rateBasisPoints: d.rateBasisPoints,
    fixedAmountMinor: d.fixedAmountMinor,
    formulaKey: d.formulaKey,
  };
});

async function renderCalculator(loaderData: unknown, url = "http://localhost/app/calculator"): Promise<string> {
  const handler = createStaticHandler([{ path: "/app/calculator", loader: () => loaderData, Component: asComponent(CalculatorPage) }]);
  const context = await handler.query(new Request(url));
  if (context instanceof Response) throw new Error("unexpected redirect");
  const router = createStaticRouter(handler.dataRoutes, context);
  return renderToStaticMarkup(createElement(StaticRouterProvider, { router, context, hydrate: false }));
}

/** The opening tag of the first element matching `tag` whose attributes contain `contains`. */
function openingTag(html: string, tag: string, contains: string): string {
  const re = new RegExp(`<${tag}\\b[^>]*>`, "g");
  const found = (html.match(re) ?? []).find((t) => t.includes(contains));
  if (!found) throw new Error(`no <${tag}> containing ${contains}`);
  return found;
}

describe("/app/calculator server render", () => {
  it("currency select: NO value attribute; the matching <s-option> carries `selected` (G2 pattern)", async () => {
    const html = await renderCalculator({
      rules,
      prefill: { savedAtIso: "2026-09-17T09:14:00.000Z", revenueMinor: 5_000_000, currencyCode: "CAD" },
    });
    const select = openingTag(html, "s-select", 'label="Currency"');
    expect(select).not.toMatch(/\svalue=/);
    expect(select).not.toMatch(/\sname=/);
    expect(openingTag(html, "s-option", 'value="CAD"')).toMatch(/\sselected(=|\s|>)/);
    expect(openingTag(html, "s-option", 'value="USD"')).not.toMatch(/\sselected/);
    expect(openingTag(html, "s-option", 'value="EUR"')).not.toMatch(/\sselected/);
  });

  it("defaults to USD selected and submits currency/revenue from hidden inputs carrying state", async () => {
    const html = await renderCalculator({ rules, prefill: null });
    expect(openingTag(html, "s-option", 'value="USD"')).toMatch(/\sselected/);
    expect(html).toContain('<input type="hidden" name="currency" value="USD"/>');
    expect(html).toContain('<input type="hidden" name="revenue" value="0.00"/>');
  });

  it("formula select has no value attribute either, and the option for the stored formula is `selected`", async () => {
    const withFormula = rules.map((r) =>
      r.categoryKey === "payroll"
        ? { ...r, ruleType: "formula", rateBasisPoints: null, fixedAmountMinor: null, formulaKey: "base_fee_plus_marginal_percent" }
        : r,
    );
    const html = await renderCalculator({ rules: withFormula, prefill: null });
    const select = openingTag(html, "s-select", 'label="Formula"');
    expect(select).not.toMatch(/\svalue=/);
    expect(openingTag(html, "s-option", 'value="base_fee_plus_marginal_percent"')).toMatch(/\sselected/);
    expect(openingTag(html, "s-option", 'value="tiered_by_revenue_band"')).not.toMatch(/\sselected/);
  });

  it("the currency code is shown next to the revenue and fixed-amount prefixes (USD and CAD are distinguishable)", async () => {
    for (const currencyCode of ["USD", "CAD"]) {
      const html = await renderCalculator({
        rules,
        prefill: { savedAtIso: "2026-09-17T09:14:00.000Z", revenueMinor: 100_000, currencyCode },
      });
      const revenue = openingTag(html, "s-number-field", 'label="Revenue amount"');
      expect(revenue).toContain('prefix="$"');
      expect(revenue).toContain(`suffix="${currencyCode}"`);
      const fixed = openingTag(html, "s-number-field", 'label="Fixed amount"');
      expect(fixed).toContain(`suffix="${currencyCode}"`);
    }
  });

  it("the revenue field has min=0 and shows no error for a valid initial value", async () => {
    const html = await renderCalculator({ rules, prefill: null });
    const revenue = openingTag(html, "s-number-field", 'label="Revenue amount"');
    expect(revenue).toContain('min="0"');
    expect(revenue).not.toContain("error=");
  });

  it("the currency help text no longer claims the currency is 'set once'", async () => {
    const html = await renderCalculator({ rules, prefill: null });
    expect(html).not.toContain("Set once");
    expect(html).toContain("It is not saved with your rules.");
  });

  it("the per-category enable checkbox is labelled on the control itself, with no <label> nested in the summary", async () => {
    const html = await renderCalculator({ rules, prefill: null });
    expect(html).toContain('aria-label="Enable Cost of Goods rule"');
    const summaries = html.match(/<summary[\s\S]*?<\/summary>/g) ?? [];
    expect(summaries.length).toBe(10);
    for (const s of summaries) expect(s).not.toContain("<label");
  });

  it("the Calculate button is enabled and not loading at rest", async () => {
    const html = await renderCalculator({ rules, prefill: null });
    const calc = (html.match(/<s-button\b[^>]*>Calculate<\/s-button>/) ?? [""])[0];
    expect(calc).toContain('variant="primary"');
    expect(calc).not.toContain("disabled");
    expect(calc).not.toContain("loading");
  });

  it("the formula help text is currency-neutral (no hardcoded $)", async () => {
    const withFormula = rules.map((r) =>
      r.categoryKey === "payroll"
        ? { ...r, ruleType: "formula", rateBasisPoints: null, fixedAmountMinor: null, formulaKey: "tiered_by_revenue_band" }
        : r,
    );
    const html = await renderCalculator({ rules: withFormula, prefill: null });
    const note = html.match(/<p class="help-text">PLACEHOLDER pattern[\s\S]*?<\/p>/)?.[0] ?? "";
    expect(note).toContain("in the currency you selected");
    expect(note).not.toContain("$");
  });
});

describe("app nav (app.tsx)", () => {
  async function renderLayout(): Promise<string> {
    const handler = createStaticHandler([{ path: "/app", Component: asComponent(AppLayout) }]);
    const context = await handler.query(new Request("http://localhost/app"));
    if (context instanceof Response) throw new Error("unexpected redirect");
    const router = createStaticRouter(handler.dataRoutes, context);
    return renderToStaticMarkup(createElement(StaticRouterProvider, { router, context, hydrate: false }));
  }

  it("the calculator link is the app HOME (rel=home) and History is the only plain child link", async () => {
    const html = await renderLayout();
    const nav = html.match(/<s-app-nav>[\s\S]*<\/s-app-nav>/)?.[0] ?? "";
    const links = nav.match(/<s-link\b[^>]*>/g) ?? [];
    expect(links).toHaveLength(2);
    expect(links.filter((l) => /\srel="home"/.test(l))).toHaveLength(1); // exactly one home link
    expect(openingTag(nav, "s-link", 'href="/app/calculator"')).toContain('rel="home"');
    expect(openingTag(nav, "s-link", 'href="/app/history"')).not.toContain("rel=");
  });
});

describe("/app and / land on the calculator", () => {
  it("/app redirects to /app/calculator and forwards the embedded-app query string unchanged", async () => {
    const res = (await appIndexLoader({ request: new Request("http://localhost/app?host=abc&shop=x.myshopify.com&id_token=t") } as never)) as Response;
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/app/calculator?host=abc&shop=x.myshopify.com&id_token=t");
  });

  it("/app with no query redirects to plain /app/calculator", async () => {
    const res = (await appIndexLoader({ request: new Request("http://localhost/app") } as never)) as Response;
    expect(res.headers.get("Location")).toBe("/app/calculator");
  });
});

describe("/app/calculator action", () => {
  beforeEach(() => {
    vi.mocked(authenticate.admin).mockReset();
    vi.mocked(authenticate.admin).mockResolvedValue({ session: { shop: ctx.shopDomain } } as never);
    vi.mocked(requireShopContext).mockReset();
    vi.mocked(requireShopContext).mockResolvedValue(ctx as never);
    ruleRepo.replaceExpenseRulesForShop.mockReset();
    ruleRepo.replaceExpenseRulesForShop.mockResolvedValue(undefined);
  });

  function form(overrides: Record<string, string | null> = {}, intent = "calculate"): FormData {
    const fd = new FormData();
    fd.set("intent", intent);
    fd.set("revenue", "1000.00");
    fd.set("currency", "USD");
    for (const d of DEFAULT_EXPENSE_RULES) {
      fd.set(`enabled-${d.categoryKey}`, "on");
      fd.set(`type-${d.categoryKey}`, d.ruleType);
      fd.set(`percent-${d.categoryKey}`, d.rateBasisPoints === null ? "0.00" : (d.rateBasisPoints / 100).toFixed(2));
      fd.set(`fixed-${d.categoryKey}`, d.fixedAmountMinor === null ? "0.00" : (d.fixedAmountMinor / 100).toFixed(2));
      fd.set(`formula-${d.categoryKey}`, d.formulaKey ?? "tiered_by_revenue_band");
    }
    for (const [k, v] of Object.entries(overrides)) {
      if (v === null) fd.delete(k);
      else fd.set(k, v);
    }
    return fd;
  }

  const run = (fd: FormData) =>
    calculatorAction({ request: new Request("http://localhost/app/calculator", { method: "POST", body: fd }) } as never);

  it("Calculate with a valid revenue redirects to the results page", async () => {
    const res = (await run(form())) as Response;
    expect(res).toBeInstanceOf(Response);
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toMatch(/^\/app\/results\?d=/);
  });

  it("Calculate with revenue '0' is accepted (zero is a valid revenue)", async () => {
    const res = (await run(form({ revenue: "0" }))) as Response;
    expect(res.status).toBe(302);
  });

  it("Calculate with revenue '-5' says 'zero or greater', not 'Enter a revenue amount.'", async () => {
    const res = (await run(form({ revenue: "-5" }))) as { ok: boolean; revenueError?: string };
    expect(res.ok).toBe(false);
    expect(res.revenueError).toBe("Revenue amount must be zero or greater.");
  });

  it("Calculate with revenue '1,5' is rejected (not read as 15.00)", async () => {
    const res = (await run(form({ revenue: "1,5" }))) as { ok: boolean; revenueError?: string };
    expect(res.ok).toBe(false);
    expect(res.revenueError).toBe("Commas can only separate thousands, for example 1,234.50.");
  });

  it("Calculate with a blank revenue says 'Enter a revenue amount.'", async () => {
    const res = (await run(form({ revenue: "" }))) as { revenueError?: string };
    expect(res.revenueError).toBe("Enter a revenue amount.");
  });

  it("Calculate with a blank currency returns a currencyError (rendered on the currency select)", async () => {
    const res = (await run(form({ currency: "" }))) as { ok: boolean; currencyError?: string };
    expect(res.ok).toBe(false);
    expect(res.currencyError).toBe("Choose a supported currency.");
  });

  it("Save with a category cleared AND unticked returns fieldErrors and writes nothing (was: NULL -> DB check violation -> 500)", async () => {
    const res = (await run(
      form({ "enabled-shipping": null, "type-shipping": "fixed", "fixed-shipping": "" }, "save"),
    )) as { intent: string; ok: boolean; fieldErrors: Record<string, { fixedAmountMinor?: string }> };
    expect(res.intent).toBe("save");
    expect(res.ok).toBe(false);
    expect(res.fieldErrors.shipping?.fixedAmountMinor).toBe("Enter an amount of 0 or greater.");
    expect(ruleRepo.replaceExpenseRulesForShop).not.toHaveBeenCalled();
  });

  it("Save with valid values writes the rules once and reports ok", async () => {
    const res = (await run(form({}, "save"))) as { ok: boolean };
    expect(res.ok).toBe(true);
    expect(ruleRepo.replaceExpenseRulesForShop).toHaveBeenCalledTimes(1);
  });

  it("Save ignores the revenue/currency fields (they are not persisted)", async () => {
    const res = (await run(form({ revenue: "-5", currency: "" }, "save"))) as { ok: boolean };
    expect(res.ok).toBe(true);
  });
});
