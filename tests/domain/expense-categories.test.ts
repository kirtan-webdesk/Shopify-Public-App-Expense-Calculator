import { describe, expect, it } from "vitest";
import {
  EXPENSE_CATEGORIES,
  getExpenseCategory,
  isExpenseCategoryKey,
} from "~/domain/expense-categories";

describe("EXPENSE_CATEGORIES", () => {
  it("has exactly the 10 categories spec.md D5 requires", () => {
    expect(EXPENSE_CATEGORIES).toHaveLength(10);
  });

  it("has stable, unique category keys", () => {
    const keys = EXPENSE_CATEGORIES.map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("has a contiguous zero-based sortOrder matching the migration's CHECK list order", () => {
    const sortOrders = EXPENSE_CATEGORIES.map((c) => c.sortOrder);
    expect(sortOrders).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it("isExpenseCategoryKey accepts a real key and rejects an unknown one", () => {
    expect(isExpenseCategoryKey("cost_of_goods")).toBe(true);
    expect(isExpenseCategoryKey("not_a_real_category")).toBe(false);
  });

  it("getExpenseCategory returns the matching definition", () => {
    expect(getExpenseCategory("shipping").label).toBe("Shipping");
  });

  it("getExpenseCategory throws on an invalid key rather than returning undefined", () => {
    // @ts-expect-error — intentionally passing an invalid key to test the guard
    expect(() => getExpenseCategory("bogus")).toThrow();
  });
});
