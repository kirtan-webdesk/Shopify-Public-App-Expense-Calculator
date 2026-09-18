// calculation-history.service — M4 (D10 save, D11 history + detail).
//
// Routes stay thin; this service owns: verifying a claimed calculation before
// it is persisted, paging the history list, and turning STORED rows into the
// view objects the pages render. It imports repositories only (ADR-0003) —
// never a Sequelize model, and never the expense_rule repository for anything
// on the history read path (FT-14b): a saved calculation is rendered purely
// from its own stored columns.
//
// The one deliberate exception is `buildDuplicatePrefill`, which takes the
// shop's CURRENT rules as an argument (supplied by the calculator loader, the
// route that already owns them) so that categories which were disabled in the
// snapshot still show sensible values in the new, unsaved calculation. That
// function only shapes data it is handed; it does not query.

import type { CalculationLineItemModel } from "~/db/models/calculation-line-item.model";
import type { CalculationModel } from "~/db/models/calculation.model";
import {
  countCalculationsForShop,
  findCalculationWithLineItems,
  insertCalculationSnapshot,
  listCalculationsForShop,
} from "~/db/repositories/calculation.repository";
import type { ShopContext } from "~/db/repositories/shop-context";
import { decodeCalculationResult } from "~/domain/calculation-transport";
import { recomputeAndVerifyClaimedResult } from "~/domain/calculation-verification";
import type { ExpenseCategoryKey } from "~/domain/expense-categories";
import type { EngineLineItem, EngineResult } from "~/domain/expense-engine";
import { isUuid } from "~/domain/ids";
import { toMinorUnits } from "~/domain/money";
import type { ExpenseRuleView } from "~/services/expense-rule.service";

export const HISTORY_PAGE_SIZE = 20;

/** A transported result is ~2 KB at most (10 line items); this is generous
 * headroom, and stops an oversized field from being decoded at all. */
const MAX_TRANSPORT_LENGTH = 16_384;

// --------------------------------------------------------------------------
// Save
// --------------------------------------------------------------------------

export type SaveCalculationOutcome =
  | { readonly ok: true; readonly id: string }
  | { readonly ok: false; readonly message: string };

/**
 * Verifies and persists the calculation carried by the Results page.
 *
 * The transported payload is only a claim about inputs. It is decoded,
 * re-validated, RECOMPUTED by the pure engine, and rejected unless the
 * engine's own output matches the claimed amounts. The rows written are the
 * engine's recomputed result — never client-supplied amounts — and they are
 * written atomically by the repository (one transaction).
 */
export async function saveCalculationFromTransport(
  ctx: ShopContext,
  encoded: string,
): Promise<SaveCalculationOutcome> {
  const invalid: SaveCalculationOutcome = {
    ok: false,
    message:
      "This calculation could not be saved because its inputs are not valid. Run Calculate again from the Calculator page.",
  };
  if (!encoded || encoded.length > MAX_TRANSPORT_LENGTH) return invalid;

  const claimed = decodeCalculationResult(encoded);
  if (!claimed) return invalid;

  const verified = recomputeAndVerifyClaimedResult(claimed);
  if (!verified.ok) return { ok: false, message: verified.message };

  const inserted = await insertCalculationSnapshot(ctx, verified.result);
  return { ok: true, id: inserted.id };
}

// --------------------------------------------------------------------------
// History list
// --------------------------------------------------------------------------

export interface HistoryListItem {
  readonly id: string;
  readonly savedAtIso: string;
  readonly revenueMinor: number;
  readonly totalExpensesMinor: number;
  readonly netAmountMinor: number;
  readonly currencyCode: string;
}

export interface HistoryPage {
  readonly items: readonly HistoryListItem[];
  readonly page: number;
  readonly totalPages: number;
  readonly totalCount: number;
  readonly pageSize: number;
}

/** `?page=` -> a positive integer; anything else (missing, 0, negative,
 * decimal, non-numeric, absurdly long) is page 1. */
export function parsePageParam(raw: string | null): number {
  if (raw === null || !/^\d{1,6}$/.test(raw)) return 1;
  const value = Number.parseInt(raw, 10);
  return value >= 1 ? value : 1;
}

export async function getHistoryPage(ctx: ShopContext, requestedPage: number): Promise<HistoryPage> {
  const totalCount = await countCalculationsForShop(ctx);
  const totalPages = Math.max(1, Math.ceil(totalCount / HISTORY_PAGE_SIZE));
  const page = Math.min(Math.max(1, requestedPage), totalPages);
  const rows =
    totalCount === 0
      ? []
      : await listCalculationsForShop(ctx, HISTORY_PAGE_SIZE, (page - 1) * HISTORY_PAGE_SIZE);

  return {
    items: rows.map(toHistoryListItem),
    page,
    totalPages,
    totalCount,
    pageSize: HISTORY_PAGE_SIZE,
  };
}

function toHistoryListItem(row: CalculationModel): HistoryListItem {
  return {
    id: row.id,
    savedAtIso: row.createdAt.toISOString(),
    revenueMinor: Number(row.revenueMinor),
    totalExpensesMinor: Number(row.totalExpensesMinor),
    netAmountMinor: Number(row.netAmountMinor),
    currencyCode: row.currencyCode,
  };
}

// --------------------------------------------------------------------------
// Detail — the frozen snapshot
// --------------------------------------------------------------------------

export interface SavedCalculationView {
  readonly id: string;
  readonly savedAtIso: string;
  readonly engineVersion: string;
  /** Rebuilt ONLY from the stored columns of the calculation and its line
   * items. The engine is never invoked and no live rule is consulted. */
  readonly result: EngineResult;
}

/**
 * Returns the stored snapshot, or null when the id is malformed, does not
 * exist, or belongs to another shop — the three cases are deliberately
 * indistinguishable to the caller (no existence oracle).
 */
export async function getSavedCalculation(
  ctx: ShopContext,
  id: string,
): Promise<SavedCalculationView | null> {
  if (!isUuid(id)) return null;
  const found = await findCalculationWithLineItems(ctx, id);
  if (!found) return null;
  return toSavedCalculationView(found.calculation, found.lineItems);
}

function toSavedCalculationView(
  calculation: CalculationModel,
  lineItems: readonly CalculationLineItemModel[],
): SavedCalculationView {
  const storedLineItems: EngineLineItem[] = lineItems.map((row) => ({
    categoryKey: row.categoryKey as ExpenseCategoryKey,
    categoryLabel: row.categoryLabelAtSave,
    sortOrder: row.sortOrder,
    ruleType: row.ruleTypeAtSave,
    rateBasisPoints: row.rateBasisPointsAtSave,
    fixedAmountMinor: row.fixedAmountMinorAtSave === null ? null : Number(row.fixedAmountMinorAtSave),
    formulaKey: row.formulaKeyAtSave,
    computedAmountMinor: toMinorUnits(Number(row.computedAmountMinor)),
  }));

  return {
    id: calculation.id,
    savedAtIso: calculation.createdAt.toISOString(),
    engineVersion: calculation.engineVersion,
    result: {
      engineVersion: calculation.engineVersion,
      revenueMinor: toMinorUnits(Number(calculation.revenueMinor)),
      currencyCode: calculation.currencyCode,
      totalExpensesMinor: toMinorUnits(Number(calculation.totalExpensesMinor)),
      netAmountMinor: toMinorUnits(Number(calculation.netAmountMinor)),
      lineItems: storedLineItems,
    },
  };
}

// --------------------------------------------------------------------------
// Duplicate as new calculation (G2 default-accepted addition)
// --------------------------------------------------------------------------

export interface DuplicatePrefill {
  readonly savedAtIso: string;
  readonly revenueMinor: number;
  readonly currencyCode: string;
  /** The calculator's rule rows: every category the snapshot applied is
   * enabled with the snapshot's rule; every category it did not apply is
   * disabled (its value fields come from the shop's current rules). */
  readonly rules: readonly ExpenseRuleView[];
}

/**
 * Loads a saved snapshot's inputs for the calculator as a NEW, UNSAVED
 * calculation. Returns null for a malformed / missing / other-shop id (the
 * calculator then simply renders its normal state — same no-oracle rule as
 * the detail page). Read-only: nothing is written, and the saved record is
 * never modified.
 */
export async function getDuplicatePrefill(
  ctx: ShopContext,
  id: string,
  currentRules: readonly ExpenseRuleView[],
): Promise<DuplicatePrefill | null> {
  const saved = await getSavedCalculation(ctx, id);
  if (!saved) return null;
  return buildDuplicatePrefill(saved, currentRules);
}

export function buildDuplicatePrefill(
  saved: SavedCalculationView,
  currentRules: readonly ExpenseRuleView[],
): DuplicatePrefill {
  const appliedByCategory = new Map(saved.result.lineItems.map((li) => [li.categoryKey, li]));
  const rules: ExpenseRuleView[] = currentRules.map((live) => {
    const applied = appliedByCategory.get(live.categoryKey);
    if (!applied) return { ...live, enabled: false };
    return {
      ...live,
      enabled: true,
      ruleType: applied.ruleType,
      // Only the value that was actually applied is taken from the snapshot;
      // the inactive fields keep the shop's current values, exactly as the
      // calculator keeps them across a rule-type toggle.
      rateBasisPoints: applied.ruleType === "percentage" ? applied.rateBasisPoints : live.rateBasisPoints,
      fixedAmountMinor: applied.ruleType === "fixed" ? applied.fixedAmountMinor : live.fixedAmountMinor,
      formulaKey: applied.ruleType === "formula" ? applied.formulaKey : live.formulaKey,
    };
  });
  return {
    savedAtIso: saved.savedAtIso,
    revenueMinor: saved.result.revenueMinor,
    currencyCode: saved.result.currencyCode,
    rules,
  };
}
