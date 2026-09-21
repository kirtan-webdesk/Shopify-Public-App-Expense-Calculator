import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

// DB-free tests of the Expense rules route (G4-sprint-4.1, G2-revision v2): the
// server render (10 rows, switches, hidden submitted values, save bar, placeholder
// banner, reset modal, error banner), the loader, and the Save action.
// authenticate / the shop-context service / every repository are stubbed BEFORE the route modules import.

vi.mock("~/shopify.server", () => ({ authenticate: { admin: vi.fn() } }));
vi.mock("~/services/shop-context.service", () => ({ requireShopContext: vi.fn() }));
vi.mock("~/db/repositories/shop.repository", () => ({ findShopContextByDomain: vi.fn(), ensureShopContext: vi.fn() }));
const ruleRepo = vi.hoisted(() => ({
  listExpenseRulesForShop: vi.fn(),
  replaceExpenseRulesForShop: vi.fn(),
  seedExpenseRulesIfMissing: vi.fn(),
}));
vi.mock("~/db/repositories/expense-rule.repository", () => ruleRepo);

import { authenticate } from "~/shopify.server";
import { requireShopContext } from "~/services/shop-context.service";
import RulesPage, { action as rulesAction, loader as rulesLoader } from "~/routes/app.rules";
import type { ExpenseRuleView } from "~/services/expense-rule.service";
import { EXPENSE_CATEGORIES } from "~/domain/expense-categories";
import { DEFAULT_EXPENSE_RULES } from "~/domain/expense-rule-defaults";
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

const render = (rules: ExpenseRuleView[], actionData?: unknown) =>
  renderRoute(RulesPage, { rules }, "http://localhost/app/rules", { actionData });

describe("/app/rules server render", () => {
  it("renders all 10 categories: a labelled switch, a rule-type select and ONE value control each", async () => {
    const html = await render(viewOf());
    expect(countTags(html, "s-switch")).toBe(10);
    for (const c of EXPENSE_CATEGORIES) expect(html).toContain(`label="${c.label}"`);
    expect(html).toContain('<s-page heading="Expense rules">');
    expect(countTags(html, "s-select")).toBe(10); // one rule-type select per row, no formula rows
    expect(countTags(html, "s-number-field")).toBe(10); // one value field per row
    expect(html).not.toMatch(/<details|<summary|type="radio"|type="checkbox"/); // the v1 markup is gone
  });

  it("the switch carries the category name as its label and reflects saved on/off (an Off badge for a switched-off row)", async () => {
    const html = await render(viewOf({ marketing: { enabled: false } }));
    expect(openingTag(html, "s-switch", 'label="Cost of Goods"')).toMatch(/\schecked(=|\s|>)/);
    expect(openingTag(html, "s-switch", 'label="Marketing"')).not.toMatch(/\schecked/);
    expect(countTags(html, "s-badge")).toBe(1);
    expect(html).toContain('<s-badge tone="neutral">Off</s-badge>');
  });

  it("uses the App Bridge contextual save bar (data-save-bar) and never the programmatic API", async () => {
    const html = await render(viewOf());
    expect(html).toMatch(/<form[^>]*data-save-bar="true"/);
    expect(html).not.toContain("ui-save-bar");
  });

  it("carries the permanent placeholder-rate banner (J12) and the tax note on the Taxes row only", async () => {
    const html = await render(viewOf());
    expect(html).toContain("Illustrative placeholder defaults");
    expect(html).toContain("not tax or legal advice");
    expect((html.match(/not tax or legal advice/g) ?? []).length).toBe(1);
  });

  it("submits every value from hidden inputs (state), switched-on rows only carry enabled-<key>", async () => {
    const html = await render(viewOf({ marketing: { enabled: false } }));
    expect(html).toContain('<input type="hidden" name="enabled-cost_of_goods" value="on"/>');
    expect(html).not.toContain('name="enabled-marketing"');
    expect(html).toContain('<input type="hidden" name="type-shipping" value="fixed"/>');
    expect(html).toContain('<input type="hidden" name="fixed-shipping" value="450.00"/>');
    expect(html).toContain('<input type="hidden" name="percent-cost_of_goods" value="32.50"/>');
    for (const c of EXPENSE_CATEGORIES) {
      for (const f of ["type", "percent", "fixed", "formula"]) expect(html).toContain(`name="${f}-${c.key}"`);
    }
    // no revenue / currency here: they are not part of the rules form and are never persisted
    expect(html).not.toMatch(/name="(revenue|currency)"/);
  });

  it("selects use the `selected`-on-option pattern and never a `value` on the select (R3, same as the currency select)", async () => {
    const html = await render(viewOf());
    for (const tag of html.match(/<s-select\b[^>]*>/g) ?? []) expect(tag).not.toMatch(/\svalue=/);
    const options = html.match(/<s-option\b[^>]*value="fixed"[^>]*>/g) ?? [];
    expect(options.filter((o) => /\sselected/.test(o))).toHaveLength(3); // shipping, apps, overhead
  });

  it("a formula rule shows the formula select, its currency-neutral note, and no numeric field", async () => {
    const html = await render(
      viewOf({ payroll: { ruleType: "formula", rateBasisPoints: null, formulaKey: "base_fee_plus_marginal_percent" } }),
    );
    expect(openingTag(html, "s-select", 'label="Formula"')).not.toMatch(/\svalue=/);
    expect(openingTag(html, "s-option", 'value="base_fee_plus_marginal_percent"')).toMatch(/\sselected/);
    expect(openingTag(html, "s-option", 'value="tiered_by_revenue_band"')).not.toMatch(/\sselected/);
    expect(countTags(html, "s-number-field")).toBe(9);
    const note = html.match(/PLACEHOLDER pattern[\s\S]*?<\/s-paragraph>/)?.[0] ?? "";
    expect(note).toContain("in the currency you calculate in");
    expect(note).not.toContain("$");
  });

  it("offers the optional 'Reset to placeholder defaults' behind a confirmation modal", async () => {
    const html = await render(viewOf());
    expect(openingTag(html, "s-button", 'commandFor="reset-modal"')).toContain('command="--show"');
    expect(html).toContain('<s-modal id="reset-modal" heading="Reset to placeholder defaults?">');
    expect(html).toContain("Nothing is saved until you select <strong>Save</strong>");
    expect(html).toContain("<strong>Discard</strong> brings your values back");
  });

  it("no error banner on a clean load or after a successful save", async () => {
    expect(await render(viewOf())).not.toContain("Rule changes not saved");
    expect(await render(viewOf(), { ok: true, fieldErrors: {} })).not.toContain("Rule changes not saved");
  });

  it("after a failed Save: a 'Rule changes not saved' banner lists every row, incl. a switched-OFF row, and errors show inline", async () => {
    const rules = viewOf({ marketing: { enabled: false }, shipping: { fixedAmountMinor: null } });
    const html = await render(rules, {
      ok: false,
      fieldErrors: {
        marketing: { rateBasisPoints: "Enter a percentage of 0 or greater." },
        shipping: { fixedAmountMinor: "Enter an amount of 0 or greater." },
      },
    });
    expect(html).toContain('<s-banner tone="critical" heading="Rule changes not saved">');
    expect(html).toContain("Nothing was saved.");
    expect(html).toContain("2 categories need");
    expect(html).toContain("Shipping: Enter an amount of 0 or greater.");
    expect(html).toContain("Marketing: ");
    expect(html).toContain("this rule is off, but its value must still be valid");
    expect(openingTag(html, "s-number-field", 'label="Percentage"')).toBeDefined();
  });
});

describe("/app/rules source guards", () => {
  it("the enable switch listens to `input` (React onChange did not fire for s-switch in a real browser)", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync("app/routes/app.rules.tsx", "utf8");
    const sw = source.slice(source.indexOf("<s-switch"), source.indexOf("</s-switch>"));
    expect(sw).toMatch(/onInput=/);
  });
});

describe("/app/rules loader", () => {
  beforeEach(() => {
    vi.mocked(authenticate.admin).mockReset();
    vi.mocked(authenticate.admin).mockResolvedValue({ session: { shop: ctx.shopDomain } } as never);
    vi.mocked(requireShopContext).mockReset();
    vi.mocked(requireShopContext).mockResolvedValue(ctx as never);
    ruleRepo.listExpenseRulesForShop.mockReset();
    ruleRepo.seedExpenseRulesIfMissing.mockReset();
  });

  const load = () => rulesLoader({ request: new Request("http://localhost/app/rules") } as never) as Promise<{ rules: ExpenseRuleView[] }>;

  it("returns the shop's saved rules in category order via the authenticated shop context", async () => {
    ruleRepo.listExpenseRulesForShop.mockResolvedValue(repoRows(viewOf({ shipping: { fixedAmountMinor: 77_700 } })));
    const { rules } = await load();
    expect(rules.map((r) => r.categoryKey)).toEqual(EXPENSE_CATEGORIES.map((c) => c.key));
    expect(rules.find((r) => r.categoryKey === "shipping")!.fixedAmountMinor).toBe(77_700);
    expect(requireShopContext).toHaveBeenCalledWith({ shop: ctx.shopDomain });
    expect(ruleRepo.listExpenseRulesForShop).toHaveBeenCalledWith(ctx);
    expect(ruleRepo.seedExpenseRulesIfMissing).not.toHaveBeenCalled();
  });

  it("seeds the placeholder defaults on a shop's first visit", async () => {
    ruleRepo.listExpenseRulesForShop.mockResolvedValueOnce([]).mockResolvedValueOnce(repoRows(viewOf()));
    ruleRepo.seedExpenseRulesIfMissing.mockResolvedValue(undefined);
    const { rules } = await load();
    expect(ruleRepo.seedExpenseRulesIfMissing).toHaveBeenCalledTimes(1);
    expect(rules).toHaveLength(10);
  });
});

describe("/app/rules action (Save)", () => {
  beforeEach(() => {
    vi.mocked(authenticate.admin).mockReset();
    vi.mocked(authenticate.admin).mockResolvedValue({ session: { shop: ctx.shopDomain } } as never);
    vi.mocked(requireShopContext).mockReset();
    vi.mocked(requireShopContext).mockResolvedValue(ctx as never);
    ruleRepo.replaceExpenseRulesForShop.mockReset();
    ruleRepo.replaceExpenseRulesForShop.mockResolvedValue(undefined);
  });

  function form(overrides: Record<string, string | null> = {}): FormData {
    const fd = new FormData();
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
    rulesAction({ request: new Request("http://localhost/app/rules", { method: "POST", body: fd }) } as never) as Promise<{
      ok: boolean;
      fieldErrors: Record<string, { rateBasisPoints?: string; fixedAmountMinor?: string; formulaKey?: string; ruleType?: string }>;
    }>;

  it("valid values: writes all ten rules once, for the authenticated shop, and reports ok", async () => {
    const res = await run(form());
    expect(res).toEqual({ ok: true, fieldErrors: {} });
    expect(ruleRepo.replaceExpenseRulesForShop).toHaveBeenCalledTimes(1);
    const [calledCtx, inputs] = ruleRepo.replaceExpenseRulesForShop.mock.calls[0]!;
    expect(calledCtx).toBe(ctx);
    expect(inputs).toHaveLength(10);
  });

  it("persists an edited value exactly (percent -> basis points, fixed -> minor units, off stays off)", async () => {
    await run(form({ "percent-marketing": "9.75", "fixed-shipping": "1,234.50", "enabled-taxes": null }));
    const inputs = ruleRepo.replaceExpenseRulesForShop.mock.calls[0]![1] as Array<Record<string, unknown>>;
    const by = (k: string) => inputs.find((i) => i.categoryKey === k)!;
    expect(by("marketing")).toMatchObject({ ruleType: "percentage", rateBasisPoints: 975, enabled: true });
    expect(by("shipping")).toMatchObject({ ruleType: "fixed", fixedAmountMinor: 123_450 });
    expect(by("taxes")).toMatchObject({ enabled: false, rateBasisPoints: 600 }); // switched off, value kept
  });

  it("a category cleared AND switched off is rejected as a field error and nothing is written (disabled-row rule, J11)", async () => {
    const res = await run(form({ "enabled-shipping": null, "type-shipping": "fixed", "fixed-shipping": "" }));
    expect(res.ok).toBe(false);
    expect(res.fieldErrors.shipping?.fixedAmountMinor).toBe("Enter an amount of 0 or greater.");
    expect(ruleRepo.replaceExpenseRulesForShop).not.toHaveBeenCalled();
  });

  it("rejects negative, over-limit and malformed values, all in one response, writing nothing", async () => {
    const res = await run(form({ "percent-marketing": "-1", "fixed-shipping": "abc", "percent-taxes": "1,5" }));
    expect(res.ok).toBe(false);
    expect(Object.keys(res.fieldErrors).sort()).toEqual(["marketing", "shipping", "taxes"]);
    expect(ruleRepo.replaceExpenseRulesForShop).not.toHaveBeenCalled();
  });

  it("rejects an unknown rule type and an unknown formula", async () => {
    const a = await run(form({ "type-misc": "cubic" }));
    expect(a.fieldErrors.misc?.ruleType).toBe("Choose a rule type.");
    const b = await run(form({ "type-misc": "formula", "formula-misc": "eval_this" }));
    expect(b.ok).toBe(false);
    expect(b.fieldErrors.misc?.formulaKey).toBeDefined();
    expect(ruleRepo.replaceExpenseRulesForShop).not.toHaveBeenCalled();
  });

  it("an empty submission is rejected wholesale (no category silently skipped)", async () => {
    const res = await run(new FormData());
    expect(res.ok).toBe(false);
    expect(Object.keys(res.fieldErrors)).toHaveLength(10);
    expect(ruleRepo.replaceExpenseRulesForShop).not.toHaveBeenCalled();
  });

  it("ignores revenue / currency / shop fields entirely (not persisted, shop comes from the session)", async () => {
    const res = await run(form({ revenue: "-5", currency: "", shop: "evil.myshopify.com", shopId: "22222222-2222-4222-8222-222222222222" }));
    expect(res.ok).toBe(true);
    expect(requireShopContext).toHaveBeenCalledWith({ shop: ctx.shopDomain });
    expect(ruleRepo.replaceExpenseRulesForShop.mock.calls[0]![0]).toBe(ctx);
  });

  it("the dotted control names the page puts on its s-* fields are NOT read by the server", async () => {
    const res = await run(form({ "cost_of_goods.percent": "99", "cost_of_goods.enabled": "" }));
    expect(res.ok).toBe(true);
    const inputs = ruleRepo.replaceExpenseRulesForShop.mock.calls[0]![1] as Array<Record<string, unknown>>;
    expect(inputs.find((i) => i.categoryKey === "cost_of_goods")).toMatchObject({ rateBasisPoints: 3250, enabled: true });
  });
});

// G4-sprint-4.2: the App Bridge contextual save bar only appears when its change detection sees an edit (dotted-name shadow-DOM
// controls, programmatic hidden inputs and a remount on the saved values can all defeat it) and stays hidden after a failed
// Save. In-body Save / Discard buttons work regardless.
describe("/app/rules in-body Save / Discard fallback (G4-sprint-4.2)", () => {
  const source = readFileSync(resolve(process.cwd(), "app/routes/app.rules.tsx"), "utf8");
  const formOf = (html: string) => html.match(/<form\b[^>]*data-save-bar="true"[^>]*>[\s\S]*<\/form>/)![0];
  const button = (html: string, text: string) => (html.match(new RegExp(`<s-button\\b[^>]*>${text}</s-button>`)) ?? [""])[0];

  it("a type=submit Save and a Discard button sit INSIDE the same data-save-bar form, after the ten rules", async () => {
    const html = await render(viewOf());
    const form = formOf(html);
    const save = button(form, "Save");
    const discard = button(form, "Discard");
    expect(save).toContain('type="submit"');
    expect(save).toContain('variant="primary"');
    expect(discard).toContain('type="button"');
    expect(discard).not.toContain('type="submit"');
    expect(form.indexOf(save)).toBeGreaterThan(form.lastIndexOf('label="Misc"'));
    // one form only: the fallback posts the very same form/action as the save bar
    expect((html.match(/<form\b/g) ?? []).length).toBe(1);
    expect(html).not.toContain("ui-save-bar"); // still no programmatic save-bar API next to data-save-bar
  });

  it("Save is enabled and not loading at rest; the fallback needs no edit first (so a failed Save can be retried)", async () => {
    const html = await render(viewOf());
    for (const text of ["Save", "Discard"]) expect(button(html, text)).not.toMatch(/disabled|loading/);
  });

  it("after a FAILED save the error banner shows and the in-body Save is still there and enabled for a retry", async () => {
    const html = await render(viewOf(), {
      ok: false,
      fieldErrors: { cost_of_goods: { rateBasisPoints: "Enter a percentage." } },
    });
    expect(html).toContain("Rule changes not saved");
    const save = button(formOf(html), "Save");
    expect(save).toContain('type="submit"');
    expect(save).not.toMatch(/disabled|loading/);
  });

  it("the fallback adds no form field and does not change what is submitted", async () => {
    const inputs = (await render(viewOf())).match(/<input\b[^>]*>/g) ?? [];
    expect(inputs.every((i) => /type="hidden"/.test(i))).toBe(true);
    for (const i of inputs) expect(i).not.toMatch(/name="(save|discard|intent)/);
  });

  it("Discard resets THIS form (form.reset() fires onReset={discard}, as the bar's Discard does); Save is the native submit with an in-flight guard (source-level)", () => {
    expect(source).toMatch(/<Form method="post" ref=\{formRef\} data-save-bar="true" onReset=\{discard\}>/);
    expect(source).toMatch(/<s-button type="button" onClick=\{\(\) => formRef\.current\?\.reset\(\)\} disabled=\{isSaving\}>\s*Discard/);
    expect(source).toMatch(/<s-button type="submit" variant="primary" loading=\{isSaving\} disabled=\{isSaving\}>\s*Save/);
    // no second submit path (no requestSubmit / programmatic save bar API) that could double-fire with the bar's Save
    expect(source).not.toContain("requestSubmit");
    expect(source).not.toMatch(/\.saveBar\.(show|hide|toggle|leaveConfirmation)\(/);
  });
});
