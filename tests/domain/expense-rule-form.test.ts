import { describe, expect, it } from "vitest";
import { EXPENSE_CATEGORIES } from "~/domain/expense-categories";
import { DEFAULT_EXPENSE_RULES } from "~/domain/expense-rule-defaults";
import {
  parseRuleRowsFromFormData,
  placeholderDefaultRowStates,
  rowStatesEqual,
  rowStatesFromRules,
  toFormInput,
  type RuleSource,
} from "~/domain/expense-rule-form";
import { validateExpenseRuleRow } from "~/domain/expense-rule-validation";

const saved: RuleSource[] = DEFAULT_EXPENSE_RULES.map((d) => ({
  ...d,
  enabled: true,
  // a "merchant-edited" set: marketing switched off, payroll changed to a formula, shipping edited
  ...(d.categoryKey === "marketing" ? { enabled: false } : {}),
  ...(d.categoryKey === "payroll"
    ? { ruleType: "formula" as const, rateBasisPoints: null, formulaKey: "tiered_by_revenue_band" }
    : {}),
  ...(d.categoryKey === "shipping" ? { fixedAmountMinor: 99_900 } : {}),
}));

describe("placeholderDefaultRowStates (J5 Reset to placeholder defaults)", () => {
  it("produces one row per category, every one switched ON, with the placeholder values", () => {
    const rows = placeholderDefaultRowStates();
    expect(Object.keys(rows).sort()).toEqual(EXPENSE_CATEGORIES.map((c) => c.key).sort());
    for (const d of DEFAULT_EXPENSE_RULES) {
      const row = rows[d.categoryKey]!;
      expect(row.enabled).toBe(true);
      expect(row.ruleType).toBe(d.ruleType);
    }
    expect(rows.cost_of_goods!.percentText).toBe("32.50");
    expect(rows.shipping!.fixedText).toBe("450.00");
  });

  it("every default row is a valid rule (Save would accept it)", () => {
    for (const row of Object.values(placeholderDefaultRowStates())) {
      expect(validateExpenseRuleRow({ ...toFormInput(row), enabled: true })).toEqual({});
    }
  });

  it("only PRODUCES form values: it does not touch the saved rows it is compared against (Discard can restore them)", () => {
    const loaded = rowStatesFromRules(saved);
    const before = JSON.stringify(loaded);
    const defaults = placeholderDefaultRowStates();
    expect(JSON.stringify(loaded)).toBe(before);
    // ... and the two really differ, so applying the defaults is a change the save bar must offer to save or discard
    expect(rowStatesEqual(loaded, defaults)).toBe(false);
    expect(loaded.marketing!.enabled).toBe(false);
    expect(defaults.marketing!.enabled).toBe(true);
  });

  it("returns a fresh object each call (no shared mutable state between resets)", () => {
    expect(placeholderDefaultRowStates()).not.toBe(placeholderDefaultRowStates());
    expect(placeholderDefaultRowStates()).toEqual(placeholderDefaultRowStates());
  });

  it("defaults applied on top of already-default saved rules is NOT a change", () => {
    const defaultsAsSaved = rowStatesFromRules(DEFAULT_EXPENSE_RULES.map((d) => ({ ...d, enabled: true })));
    expect(rowStatesEqual(defaultsAsSaved, placeholderDefaultRowStates())).toBe(true);
  });
});

describe("parseRuleRowsFromFormData", () => {
  function formFor(rows: ReturnType<typeof rowStatesFromRules>): FormData {
    const fd = new FormData();
    for (const row of Object.values(rows)) {
      if (row.enabled) fd.set(`enabled-${row.categoryKey}`, "on");
      fd.set(`type-${row.categoryKey}`, row.ruleType);
      fd.set(`percent-${row.categoryKey}`, row.percentText);
      fd.set(`fixed-${row.categoryKey}`, row.fixedText);
      fd.set(`formula-${row.categoryKey}`, row.formulaKey);
    }
    return fd;
  }

  it("round-trips the editor's rows to the exact rule inputs", () => {
    const rows = rowStatesFromRules(saved);
    const parsed = parseRuleRowsFromFormData(formFor(rows));
    expect(parsed).toHaveLength(EXPENSE_CATEGORIES.length);
    const byKey = Object.fromEntries(parsed.map((p) => [p.categoryKey, p]));
    expect(byKey.marketing!.enabled).toBe(false);
    expect(byKey.marketing!.rateBasisPoints).toBe(800); // a switched-off row still carries its value
    expect(byKey.shipping!.fixedAmountMinor).toBe(99_900);
    expect(byKey.payroll).toMatchObject({ ruleType: "formula", formulaKey: "tiered_by_revenue_band", rateBasisPoints: null });
    expect(byKey.cost_of_goods).toMatchObject({ enabled: true, ruleType: "percentage", rateBasisPoints: 3250 });
  });

  it("a completely empty form yields ten rows that validation rejects (nothing is silently skipped)", () => {
    const parsed = parseRuleRowsFromFormData(new FormData());
    expect(parsed).toHaveLength(EXPENSE_CATEGORIES.length);
    for (const p of parsed) {
      expect(p.enabled).toBe(false);
      expect(Object.keys(validateExpenseRuleRow({ ...p, enabled: true })).length).toBeGreaterThan(0);
    }
  });

  it("an unknown rule type is passed through so validation names it", () => {
    const fd = new FormData();
    fd.set("type-shipping", "cubic");
    const shipping = parseRuleRowsFromFormData(fd).find((p) => p.categoryKey === "shipping")!;
    expect(shipping.ruleType).toBe("cubic");
    expect(validateExpenseRuleRow(shipping).ruleType).toBe("Choose a rule type.");
  });
});
