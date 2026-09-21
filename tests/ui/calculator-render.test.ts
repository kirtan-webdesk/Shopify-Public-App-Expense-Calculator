import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

// DB-free tests of the Calculator route (G4-sprint-4.1, G2-revision v2):
//   * server render: revenue + currency + a READ-ONLY summary of the saved rules
//     (no editable rule anywhere on the page)
//   * loader: saved rules, ?from= copies revenue + currency ONLY (J6), ?revenue=&currency=
//   * action (J1): Calculate uses the SAVED rules and ignores any client-supplied rule value
// authenticate / the shop-context service / every repository are stubbed BEFORE the route modules import.

vi.mock("~/shopify.server", () => ({ authenticate: { admin: vi.fn() } }));
vi.mock("~/services/shop-context.service", () => ({ requireShopContext: vi.fn() }));
vi.mock("~/db/repositories/shop.repository", () => ({ findShopContextByDomain: vi.fn(), ensureShopContext: vi.fn() }));
const calcRepo = vi.hoisted(() => ({
  countCalculationsForShop: vi.fn(),
  findCalculationWithLineItems: vi.fn(),
  insertCalculationSnapshot: vi.fn(),
  listCalculationsForShop: vi.fn(),
}));
vi.mock("~/db/repositories/calculation.repository", () => calcRepo);
const ruleRepo = vi.hoisted(() => ({
  listExpenseRulesForShop: vi.fn(),
  replaceExpenseRulesForShop: vi.fn(),
  seedExpenseRulesIfMissing: vi.fn(),
}));
vi.mock("~/db/repositories/expense-rule.repository", () => ruleRepo);

import { authenticate } from "~/shopify.server";
import { requireShopContext } from "~/services/shop-context.service";
import CalculatorPage, { action as calculatorAction, loader as calculatorLoader } from "~/routes/app.calculator";
import type { ExpenseRuleView } from "~/services/expense-rule.service";
import { decodeCalculationResult } from "~/domain/calculation-transport";
import { EXPENSE_CATEGORIES } from "~/domain/expense-categories";
import { DEFAULT_EXPENSE_RULES } from "~/domain/expense-rule-defaults";
import { buildDefaultResult } from "../helpers/calc-fixtures";
import { countTags, openingTag, renderRoute } from "../helpers/render-route";

const ctx = { shopId: "11111111-1111-4111-8111-111111111111", shopDomain: "x.myshopify.com" };

function viewOf(overrides: Partial<Record<string, Partial<ExpenseRuleView>>> = {}): ExpenseRuleView[] {
  return DEFAULT_EXPENSE_RULES.map((d) => {
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
      ...(overrides[d.categoryKey] ?? {}),
    };
  });
}
/** What the repository returns (model-like rows) for the same rules. */
function repoRows(views: readonly ExpenseRuleView[]) {
  return views.map((v) => ({
    categoryKey: v.categoryKey,
    enabled: v.enabled,
    ruleType: v.ruleType,
    rateBasisPoints: v.rateBasisPoints,
    fixedAmountMinor: v.fixedAmountMinor === null ? null : String(v.fixedAmountMinor),
    formulaKey: v.formulaKey,
  }));
}

const NO_PREFILL = { prefill: null, carried: null };
const render = (loaderData: unknown, url = "http://localhost/app/calculator") =>
  renderRoute(CalculatorPage, loaderData, url);

describe("/app/calculator server render (v2: revenue + currency + read-only rules summary)", () => {
  it("contains NO editable rule control anywhere (the rules editor lives on /app/rules)", async () => {
    const html = await render({ rules: viewOf(), ...NO_PREFILL });
    expect(html).not.toMatch(/<details|<summary|type="radio"|type="checkbox"/);
    expect(html).not.toContain("data-save-bar");
    expect(html).not.toMatch(/<s-switch|<s-number-field/);
    for (const field of ["enabled", "type", "percent", "fixed", "formula"]) {
      expect(html, `no ${field}- form field`).not.toContain(`name="${field}-`);
    }
    // the only form fields are revenue and currency
    const names = (html.match(/<input[^>]*\sname="([^"]+)"/g) ?? []).map((t) => /name="([^"]+)"/.exec(t)![1]);
    expect(names.sort()).toEqual(["currency", "revenue"]);
  });

  it("lists all 10 categories in order with the SAVED rule text; off rows show an Off badge and no rule", async () => {
    const rules = viewOf({
      marketing: { enabled: false },
      payroll: { ruleType: "formula", rateBasisPoints: null, formulaKey: "tiered_by_revenue_band" },
      shipping: { fixedAmountMinor: 99_900 },
    });
    const html = await render({ rules, ...NO_PREFILL });
    const table = html.match(/<s-table>[\s\S]*<\/s-table>/)![0];
    const rows = table.match(/<s-table-row>[\s\S]*?<\/s-table-row>/g) ?? [];
    expect(rows).toHaveLength(10);
    EXPENSE_CATEGORIES.forEach((c, i) => expect(rows[i]).toContain(`<s-table-cell>${c.label}</s-table-cell>`));
    expect(rows[0]).toContain("32.5% of revenue");
    expect(rows[4]).toContain("$999.00 fixed");
    expect(rows[6]).toContain("Formula: Tiered by revenue band");
    expect(rows[1]).toContain('<s-badge tone="neutral">Off</s-badge>');
    expect(rows[1]).not.toContain("8% of revenue");
    expect(html).toContain("9 of 10 categories on");
  });

  it("labels the rates as placeholders (badge + sentence) and links to the rules page", async () => {
    const html = await render({ rules: viewOf(), ...NO_PREFILL });
    expect(html).toContain('<s-badge tone="warning">Placeholder rates</s-badge>');
    expect(html).toContain("illustrative placeholders");
    expect(html).toContain("Calculate always uses your <strong>saved</strong> rules.");
    expect((html.match(/href="\/app\/rules"/g) ?? []).length).toBeGreaterThanOrEqual(2); // header action + section link
  });

  it("warns when every rule is off", async () => {
    const all = viewOf();
    const off = all.map((r) => ({ ...r, enabled: false }));
    expect(await render({ rules: off, ...NO_PREFILL })).toContain("No expense rules are switched on");
    expect(await render({ rules: all, ...NO_PREFILL })).not.toContain("No expense rules are switched on");
  });

  it("Calculate is the header primary action, enabled and not loading at rest", async () => {
    const html = await render({ rules: viewOf(), ...NO_PREFILL });
    // the HEADER one: an in-body fallback also exists (see the G4-sprint-4.2 block below)
    const calc = (html.match(/<s-button\b[^>]*slot="primary-action"[^>]*>Calculate<\/s-button>/) ?? [""])[0];
    expect(calc).toContain('slot="primary-action"');
    expect(calc).toContain('variant="primary"');
    expect(calc).not.toContain("disabled");
    expect(calc).not.toContain("loading");
  });

  it("R3 currency select: NO value/name attribute; the matching <s-option> carries `selected`; state posts via a hidden input", async () => {
    const html = await render({
      rules: viewOf(),
      prefill: {
        id: "3f2b8c1e-9a4d-4e0b-8f6a-1c2d3e4f5a6b",
        savedAtIso: "2026-09-17T09:14:00.000Z",
        revenueMinor: 5_000_000,
        currencyCode: "CAD",
      },
      carried: null,
    });
    const select = openingTag(html, "s-select", 'label="Currency"');
    expect(select).not.toMatch(/\svalue=/);
    expect(select).not.toMatch(/\sname=/);
    expect(openingTag(html, "s-option", 'value="CAD"')).toMatch(/\sselected(=|\s|>)/);
    for (const other of ["USD", "EUR", "GBP"]) {
      expect(openingTag(html, "s-option", `value="${other}"`)).not.toMatch(/\sselected/);
    }
    expect(html).toContain('<input type="hidden" name="currency" value="CAD"/>');
  });

  it("defaults to USD; revenue starts blank (placeholder 0.00) with the currency code as its prefix", async () => {
    const html = await render({ rules: viewOf(), ...NO_PREFILL });
    expect(openingTag(html, "s-option", 'value="USD"')).toMatch(/\sselected/);
    expect(html).toContain('<input type="hidden" name="revenue" value=""/>');
    const revenue = openingTag(html, "s-text-field", 'label="Revenue"');
    expect(revenue).toContain('prefix="USD"');
    expect(revenue).toContain('placeholder="0.00"');
    expect(revenue).not.toContain("inputMode"); // s-text-field has no such prop (Dev MCP validator)
    expect(revenue).not.toContain("error=");
  });

  it("states that revenue is entered manually as always-visible helper text (J3), not a dismissible banner", async () => {
    const html = await render({ rules: viewOf(), ...NO_PREFILL });
    expect(html).toContain("You type this in yourself; the app never reads your store");
    expect(html).not.toContain("Revenue is entered manually");
  });

  it("the currency help text no longer claims the currency is 'set once'", async () => {
    const html = await render({ rules: viewOf(), ...NO_PREFILL });
    expect(html).not.toContain("Set once");
    expect(html).toContain("Used for this calculation.");
  });

  it("the currency CODE is what distinguishes CAD from USD in the revenue prefix", async () => {
    for (const currencyCode of ["USD", "CAD", "EUR", "GBP"]) {
      const html = await render({ rules: viewOf(), prefill: null, carried: { revenueMinor: 100_000, currencyCode } });
      expect(openingTag(html, "s-text-field", 'label="Revenue"')).toContain(`prefix="${currencyCode}"`);
    }
  });

  it("Duplicate: pre-fills revenue + currency, says the RULES are the current saved ones, and links to the snapshot", async () => {
    const id = "3f2b8c1e-9a4d-4e0b-8f6a-1c2d3e4f5a6b";
    const html = await render({
      rules: viewOf(),
      prefill: { id, savedAtIso: "2026-09-17T09:14:00.000Z", revenueMinor: 5_000_000, currencyCode: "EUR" },
      carried: null,
    });
    expect(html).toContain("New calculation, pre-filled from a saved snapshot");
    expect(html).toContain("Sep 17, 2026, 9:14 AM UTC");
    expect(html).toContain("The rules are your current saved rules, not the ones in that snapshot");
    expect(html).toContain(`href="/app/history/${id}"`);
    expect(html).toContain('<input type="hidden" name="revenue" value="50000.00"/>');
    expect(html).toContain('<input type="hidden" name="currency" value="EUR"/>');
  });

  it("no prefill banner without ?from=", async () => {
    expect(await render({ rules: viewOf(), ...NO_PREFILL })).not.toContain("pre-filled from a saved snapshot");
  });

  it("an unsupported currency in the carried values falls back to USD, never a blank select", async () => {
    const html = await render({ rules: viewOf(), prefill: null, carried: { revenueMinor: 100_000, currencyCode: null } });
    expect(openingTag(html, "s-option", 'value="USD"')).toMatch(/\sselected/);
    expect(countTags(html, "s-option")).toBe(4);
  });
});

describe("/app/calculator loader", () => {
  beforeEach(() => {
    vi.mocked(authenticate.admin).mockReset();
    vi.mocked(authenticate.admin).mockResolvedValue({ session: { shop: ctx.shopDomain } } as never);
    vi.mocked(requireShopContext).mockReset();
    vi.mocked(requireShopContext).mockResolvedValue(ctx as never);
    ruleRepo.listExpenseRulesForShop.mockReset();
    ruleRepo.listExpenseRulesForShop.mockResolvedValue(repoRows(viewOf({ shipping: { fixedAmountMinor: 77_700 } })));
    calcRepo.findCalculationWithLineItems.mockReset();
    calcRepo.findCalculationWithLineItems.mockResolvedValue(null);
  });

  const load = (qs = "") =>
    calculatorLoader({ request: new Request(`http://localhost/app/calculator${qs}`) } as never) as Promise<{
      rules: ExpenseRuleView[];
      prefill: { id: string; savedAtIso: string; revenueMinor: number; currencyCode: string } | null;
      carried: { revenueMinor: number; currencyCode: string | null } | null;
    }>;

  it("returns the shop's SAVED rules, resolved through the authenticated shop context", async () => {
    const data = await load();
    expect(data.rules.find((r) => r.categoryKey === "shipping")!.fixedAmountMinor).toBe(77_700);
    expect(ruleRepo.listExpenseRulesForShop).toHaveBeenCalledWith(ctx);
    expect(data.prefill).toBeNull();
    expect(data.carried).toBeNull();
  });

  it("?from=<id> copies revenue + currency ONLY - no rule value from the snapshot reaches the page", async () => {
    const result = buildDefaultResult(5_000_000, "CAD");
    calcRepo.findCalculationWithLineItems.mockResolvedValue({
      calculation: {
        id: "3f2b8c1e-9a4d-4e0b-8f6a-1c2d3e4f5a6b",
        createdAt: new Date("2026-09-17T09:14:00.000Z"),
        engineVersion: result.engineVersion,
        revenueMinor: String(result.revenueMinor),
        currencyCode: "CAD",
        totalExpensesMinor: String(result.totalExpensesMinor),
        netAmountMinor: String(result.netAmountMinor),
      },
      lineItems: result.lineItems.map((li) => ({
        categoryKey: li.categoryKey,
        categoryLabelAtSave: li.categoryLabel,
        sortOrder: li.sortOrder,
        ruleTypeAtSave: li.ruleType,
        rateBasisPointsAtSave: li.rateBasisPoints,
        fixedAmountMinorAtSave: li.fixedAmountMinor === null ? null : String(li.fixedAmountMinor),
        formulaKeyAtSave: li.formulaKey,
        computedAmountMinor: String(li.computedAmountMinor),
      })),
    });
    const data = await load("?from=3f2b8c1e-9a4d-4e0b-8f6a-1c2d3e4f5a6b");
    expect(data.prefill).toEqual({
      id: "3f2b8c1e-9a4d-4e0b-8f6a-1c2d3e4f5a6b",
      savedAtIso: "2026-09-17T09:14:00.000Z",
      revenueMinor: 5_000_000,
      currencyCode: "CAD",
    });
    // the rules are still the SAVED ones (shipping 777.00), not the snapshot's (450.00)
    expect(data.rules.find((r) => r.categoryKey === "shipping")!.fixedAmountMinor).toBe(77_700);
  });

  it("a malformed / nonexistent / other-shop ?from= yields the plain calculator, revealing nothing", async () => {
    expect((await load("?from=not-a-uuid")).prefill).toBeNull();
    expect((await load("?from=3f2b8c1e-9a4d-4e0b-8f6a-1c2d3e4f5a6b")).prefill).toBeNull(); // repository: null
  });

  it("?revenue=&currency= (Change revenue) carries only values that pass the shared validators", async () => {
    expect((await load("?revenue=1234.50&currency=EUR")).carried).toEqual({ revenueMinor: 123_450, currencyCode: "EUR" });
    expect((await load("?revenue=0.00&currency=USD")).carried).toEqual({ revenueMinor: 0, currencyCode: "USD" });
    expect((await load("?revenue=100&currency=JPY")).carried).toEqual({ revenueMinor: 10_000, currencyCode: null });
    for (const bad of ["-5", "1,5", "1e5", "10.555", "abc", ""]) {
      expect((await load(`?revenue=${encodeURIComponent(bad)}&currency=USD`)).carried, `revenue=${bad}`).toBeNull();
    }
  });
});

describe("/app/calculator action - Calculate uses the SAVED rules (J1)", () => {
  beforeEach(() => {
    vi.mocked(authenticate.admin).mockReset();
    vi.mocked(authenticate.admin).mockResolvedValue({ session: { shop: ctx.shopDomain } } as never);
    vi.mocked(requireShopContext).mockReset();
    vi.mocked(requireShopContext).mockResolvedValue(ctx as never);
    ruleRepo.listExpenseRulesForShop.mockReset();
    ruleRepo.listExpenseRulesForShop.mockResolvedValue(repoRows(viewOf()));
    ruleRepo.replaceExpenseRulesForShop.mockReset();
    ruleRepo.seedExpenseRulesIfMissing.mockReset();
  });

  const run = (fd: FormData) =>
    calculatorAction({ request: new Request("http://localhost/app/calculator", { method: "POST", body: fd }) } as never);
  const form = (fields: Record<string, string>) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.set(k, v);
    return fd;
  };
  const resultOf = (res: unknown) => {
    const location = (res as Response).headers.get("Location")!;
    expect(location).toMatch(/^\/app\/results\?d=/);
    return decodeCalculationResult(location.slice("/app/results?d=".length))!;
  };
  const amount = (r: ReturnType<typeof resultOf>, key: string) =>
    r.lineItems.find((li) => li.categoryKey === key)?.computedAmountMinor;

  it("redirects to Results with the calculation computed from the saved rules", async () => {
    const res = (await run(form({ revenue: "1000.00", currency: "USD" }))) as Response;
    expect(res.status).toBe(302);
    const result = resultOf(res);
    expect(result.revenueMinor).toBe(100_000);
    expect(result.lineItems).toHaveLength(10);
    expect(amount(result, "cost_of_goods")).toBe(32_500); // 32.5% of $1,000.00
    expect(amount(result, "shipping")).toBe(45_000);
  });

  it("uses the shop's saved values, not the placeholder defaults", async () => {
    ruleRepo.listExpenseRulesForShop.mockResolvedValue(
      repoRows(viewOf({ marketing: { rateBasisPoints: 1000 }, shipping: { fixedAmountMinor: 77_700 } })),
    );
    const result = resultOf(await run(form({ revenue: "1000.00", currency: "USD" })));
    expect(amount(result, "marketing")).toBe(10_000);
    expect(amount(result, "shipping")).toBe(77_700);
  });

  it("a saved DISABLED category is left out of the calculation", async () => {
    ruleRepo.listExpenseRulesForShop.mockResolvedValue(repoRows(viewOf({ marketing: { enabled: false } })));
    const result = resultOf(await run(form({ revenue: "1000.00", currency: "USD" })));
    expect(result.lineItems.map((li) => li.categoryKey)).not.toContain("marketing");
    expect(result.lineItems).toHaveLength(9);
  });

  it("IGNORES every client-supplied rule value: the old rule fields, dotted names, an intent, even a forged 'rules' blob", async () => {
    const forged = form({
      revenue: "1000.00",
      currency: "USD",
      intent: "calculate",
      "enabled-cost_of_goods": "on",
      "type-cost_of_goods": "fixed",
      "fixed-cost_of_goods": "999999.00",
      "percent-marketing": "99",
      "type-marketing": "percentage",
      "cost_of_goods.percent": "99",
      "cost_of_goods.type": "fixed",
      rules: JSON.stringify([{ categoryKey: "cost_of_goods", enabled: true, ruleType: "fixed", fixedAmountMinor: 1 }]),
      rateBasisPoints: "9999",
    });
    const result = resultOf(await run(forged));
    expect(amount(result, "cost_of_goods")).toBe(32_500); // saved 32.5%, not the forged fixed 999,999.00
    expect(amount(result, "marketing")).toBe(8_000); // saved 8%, not 99%
    expect(result.lineItems).toHaveLength(10);
    const same = resultOf(await run(form({ revenue: "1000.00", currency: "USD" })));
    expect(result).toEqual(same); // forged fields change nothing at all
  });

  it("client rule values also cannot switch a saved-off category ON or a saved-on one OFF", async () => {
    ruleRepo.listExpenseRulesForShop.mockResolvedValue(repoRows(viewOf({ marketing: { enabled: false } })));
    const result = resultOf(
      await run(form({ revenue: "1000.00", currency: "USD", "enabled-marketing": "on", "enabled-cost_of_goods": "" })),
    );
    expect(result.lineItems.map((li) => li.categoryKey)).not.toContain("marketing");
    expect(result.lineItems.map((li) => li.categoryKey)).toContain("cost_of_goods");
  });

  it("never writes rules: Calculate is read-only for the rules table", async () => {
    await run(form({ revenue: "1000.00", currency: "USD", "type-shipping": "fixed", "fixed-shipping": "1.00" }));
    expect(ruleRepo.replaceExpenseRulesForShop).not.toHaveBeenCalled();
    expect(ruleRepo.seedExpenseRulesIfMissing).not.toHaveBeenCalled();
  });

  it("resolves the shop from the authenticated session, never from the request", async () => {
    await run(form({ revenue: "10", currency: "USD", shop: "evil.myshopify.com", shopId: "22222222-2222-4222-8222-222222222222" }));
    expect(requireShopContext).toHaveBeenCalledWith({ shop: ctx.shopDomain });
    expect(ruleRepo.listExpenseRulesForShop).toHaveBeenCalledWith(ctx);
  });

  it("Calculate with revenue '0' is accepted (zero is a valid revenue)", async () => {
    const res = (await run(form({ revenue: "0", currency: "USD" }))) as Response;
    expect(res.status).toBe(302);
    expect(resultOf(res).revenueMinor).toBe(0);
  });

  it("Calculate with revenue '-5' says 'zero or greater', not 'Enter a revenue amount.'", async () => {
    const res = (await run(form({ revenue: "-5", currency: "USD" }))) as unknown as { ok: boolean; revenueError?: string };
    expect(res.ok).toBe(false);
    expect(res.revenueError).toBe("Revenue amount must be zero or greater.");
  });

  it("Calculate with revenue '1,5' is rejected (not read as 15.00)", async () => {
    const res = (await run(form({ revenue: "1,5", currency: "USD" }))) as unknown as { revenueError?: string };
    expect(res.revenueError).toBe("Commas can only separate thousands, for example 1,234.50.");
  });

  it("Calculate with a blank revenue says 'Enter a revenue amount.'", async () => {
    const res = (await run(form({ revenue: "", currency: "USD" }))) as unknown as { revenueError?: string };
    expect(res.revenueError).toBe("Enter a revenue amount.");
  });

  it("Calculate with a blank / unsupported currency returns a currencyError", async () => {
    for (const currency of ["", "JPY"]) {
      const res = (await run(form({ revenue: "100", currency }))) as unknown as { ok: boolean; currencyError?: string };
      expect(res.ok).toBe(false);
      expect(res.currencyError).toBe("Choose a supported currency.");
    }
  });

  it("if the SAVED rules themselves are invalid the merchant is sent to the rules page, and nothing is calculated", async () => {
    ruleRepo.listExpenseRulesForShop.mockResolvedValue(
      repoRows(viewOf({ shipping: { fixedAmountMinor: null } })), // an enabled fixed rule with no amount
    );
    const res = (await run(form({ revenue: "100", currency: "USD" }))) as unknown as {
      ok: boolean;
      savedRulesInvalid: boolean;
    };
    expect(res.ok).toBe(false);
    expect(res.savedRulesInvalid).toBe(true);
  });

  it("has no 'save' intent any more: rules are not writable through this route", async () => {
    const res = (await run(form({ intent: "save", revenue: "100", currency: "USD" }))) as Response;
    expect(res.status).toBe(302); // treated as Calculate; nothing was written
    expect(ruleRepo.replaceExpenseRulesForShop).not.toHaveBeenCalled();
  });
});

// G4-sprint-4.2: every v2 primary action is an s-page slot button, and it is unverified that Admin's chrome forwards
// clicks into the iframe. The in-body fallbacks below keep the page usable either way.
describe("/app/calculator in-body Calculate fallback (G4-sprint-4.2)", () => {
  const source = readFileSync(resolve(process.cwd(), "app/routes/app.calculator.tsx"), "utf8");
  const calculateButtons = (html: string) => html.match(/<s-button\b[^>]*>Calculate<\/s-button>/g) ?? [];

  it("there are exactly two Calculate buttons: the header primary one (kept) and a non-primary in-body one", async () => {
    const html = await render({ rules: viewOf(), ...NO_PREFILL });
    const buttons = calculateButtons(html);
    expect(buttons).toHaveLength(2);
    const header = buttons.find((b) => b.includes('slot="primary-action"'))!;
    const body = buttons.find((b) => !b.includes("slot="))!;
    expect(header).toContain('variant="primary"');
    expect(header).toContain('type="button"');
    // the fallback is not a second primary action, has no slot (it lives in the page body), and is enabled at rest
    expect(body).toContain('type="button"');
    expect(body).not.toContain("variant=");
    expect(body).not.toMatch(/disabled|loading/);
  });

  it("the in-body Calculate sits AFTER the Revenue and rules sections", async () => {
    const html = await render({ rules: viewOf(), ...NO_PREFILL });
    const body = calculateButtons(html).find((b) => !b.includes("slot="))!;
    expect(html.indexOf(body)).toBeGreaterThan(html.indexOf('heading="Rules used for this estimate"'));
    expect(html.indexOf(body)).toBeGreaterThan(html.indexOf('heading="Revenue"'));
  });

  it("both buttons run the SAME handler and share the SAME pending state (source-level: s-button onClick is not observable in static markup)", () => {
    const buttons = source.match(/<s-button\b[^>]*>\s*Calculate\s*<\/s-button>/g) ?? [];
    expect(buttons).toHaveLength(2);
    for (const b of buttons) {
      expect(b).toContain("onClick={handleCalculate}");
      expect(b).toContain("loading={isCalculating}");
      expect(b).toContain("disabled={isCalculating}");
      expect(b).toContain('type="button"');
    }
  });

  it("the fallback adds NO form field: the only submitted fields are still revenue and currency, no rule value travels", async () => {
    const html = await render({ rules: viewOf(), ...NO_PREFILL });
    const names = (html.match(/<input[^>]*\sname="([^"]+)"/g) ?? []).map((t) => /name="([^"]+)"/.exec(t)![1]);
    expect(names.sort()).toEqual(["currency", "revenue"]);
    // the button itself carries no name/value pair either
    for (const b of calculateButtons(html)) expect(b).not.toMatch(/\s(name|value)=/);
  });
});
