import { randomUUID } from "node:crypto";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryTypes } from "sequelize";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { DEFAULT_EXPENSE_RULES } from "~/domain/expense-rule-defaults";
import { ENGINE_VERSION, type EngineResult } from "~/domain/expense-engine";
import { buildDefaultResult, encodeDefaultResult, tamperTransport } from "../helpers/calc-fixtures";

// --------------------------------------------------------------------------
// M4 DB-backed tests (real Postgres) — OPT-IN.
//
// vitest.config.ts deliberately keeps the default `npm test` DB-free (no
// DATABASE_URL secret in CI — see tests/README.md). This file therefore runs
// only when RUN_DB_TESTS=1 is set; otherwise every test in it is SKIPPED (and
// reported as skipped — never silently green). Run it against a real database
// with:
//
//   RUN_DB_TESTS=1 npx vitest run tests/db
//
// It uses genuinely fresh shop domains per run (randomUUID) and deletes every
// row it creates. It exercises the REAL route loaders/actions, service and
// repository code; only `authenticate.admin` is replaced (a real Shopify
// session-token JWT cannot be fabricated here) so each request resolves to
// the shop under test — exactly as the real authenticate.admin resolves
// `session.shop`.
//
// Covers: FT-02b (tenant isolation), FT-14a (snapshot immutability,
// byte-identical), FT-14b (no expense_rule in the history read path — query
// log), FT-14c (engine_version + currency stored; UPDATE rejected), save
// atomicity (failure mid-save leaves zero rows), pagination, and the
// pool.max:1 transaction-threading guarantee (every test runs under it).
// --------------------------------------------------------------------------

const RUN_DB = process.env.RUN_DB_TESTS === "1";

// Real network round trips to a serverless Postgres: the 5s default is too
// tight for multi-statement transactions on a cold connection.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const auth = vi.hoisted(() => ({ shop: "" }));
vi.mock("~/shopify.server", () => ({
  authenticate: { admin: async () => ({ session: { shop: auth.shop } }) },
}));

type Ctx = { shopId: string; shopDomain: string };

// Resolved in beforeAll (dynamic imports keep the Sequelize connection from
// loading when the suite is skipped and DATABASE_URL is unset).
let m: {
  sequelize: typeof import("~/db/sequelize").sequelize;
  upsertInstalledShop: typeof import("~/db/repositories/shop.repository").upsertInstalledShop;
  replaceExpenseRulesForShop: typeof import("~/db/repositories/expense-rule.repository").replaceExpenseRulesForShop;
  listExpenseRulesForShop: typeof import("~/db/repositories/expense-rule.repository").listExpenseRulesForShop;
  insertCalculationSnapshot: typeof import("~/db/repositories/calculation.repository").insertCalculationSnapshot;
  countCalculationsForShop: typeof import("~/db/repositories/calculation.repository").countCalculationsForShop;
  getSavedCalculation: typeof import("~/services/calculation-history.service").getSavedCalculation;
  getHistoryPage: typeof import("~/services/calculation-history.service").getHistoryPage;
  saveCalculationFromTransport: typeof import("~/services/calculation-history.service").saveCalculationFromTransport;
  SavedCalculationPage: typeof import("~/components/saved-calculation-page").SavedCalculationPage;
  resultsAction: typeof import("~/routes/app.results").action;
  historyLoader: typeof import("~/routes/app.history").loader;
  detailLoader: typeof import("~/routes/app.history.$id").loader;
  calculatorLoader: typeof import("~/routes/app.calculator").loader;
};

const createdShopIds: string[] = [];
let shopA: Ctx;
let shopB: Ctx;

async function freshShop(label: string): Promise<Ctx> {
  const ctx = await m.upsertInstalledShop(`m4-${label}-${randomUUID()}.myshopify.com`);
  createdShopIds.push(ctx.shopId);
  return ctx;
}

// `options` exists at runtime but is not on Sequelize's public type surface.
function seqOptions() {
  return (m.sequelize as unknown as {
    options: { pool?: { max?: number }; logging?: ((sql: string) => void) | false };
  }).options;
}

async function rowCounts(shopId: string) {
  const [calc] = await m.sequelize.query<{ c: string }>(
    "SELECT count(*)::text AS c FROM calculation WHERE shop_id = :shopId",
    { replacements: { shopId }, type: QueryTypes.SELECT },
  );
  const [items] = await m.sequelize.query<{ c: string }>(
    "SELECT count(*)::text AS c FROM calculation_line_item WHERE shop_id = :shopId",
    { replacements: { shopId }, type: QueryTypes.SELECT },
  );
  return { calculations: Number(calc?.c), lineItems: Number(items?.c) };
}

const loaderArgs = (url: string, params: Record<string, string> = {}): any => ({
  request: new Request(url),
  params,
  context: {},
});

async function postSave(d: string) {
  const body = new FormData();
  body.set("intent", "save");
  body.set("d", d);
  const args: any = {
    request: new Request("http://localhost/app/results", { method: "POST", body }),
    params: {},
    context: {},
  };
  return m.resultsAction(args);
}

async function thrownResponse(promise: Promise<unknown>): Promise<{ status: number; body: string }> {
  try {
    await promise;
  } catch (e) {
    if (e instanceof Response) return { status: e.status, body: await e.text() };
    throw e;
  }
  throw new Error("expected the call to throw a Response, but it resolved");
}

describe.skipIf(!RUN_DB)("M4 save + history (real Postgres)", () => {
  beforeAll(async () => {
    const [seq, shopRepo, ruleRepo, calcRepo, service, page, results, history, detail, calculator] =
      await Promise.all([
        import("~/db/sequelize"),
        import("~/db/repositories/shop.repository"),
        import("~/db/repositories/expense-rule.repository"),
        import("~/db/repositories/calculation.repository"),
        import("~/services/calculation-history.service"),
        import("~/components/saved-calculation-page"),
        import("~/routes/app.results"),
        import("~/routes/app.history"),
        import("~/routes/app.history.$id"),
        import("~/routes/app.calculator"),
      ]);
    m = {
      sequelize: seq.sequelize,
      upsertInstalledShop: shopRepo.upsertInstalledShop,
      replaceExpenseRulesForShop: ruleRepo.replaceExpenseRulesForShop,
      listExpenseRulesForShop: ruleRepo.listExpenseRulesForShop,
      insertCalculationSnapshot: calcRepo.insertCalculationSnapshot,
      countCalculationsForShop: calcRepo.countCalculationsForShop,
      getSavedCalculation: service.getSavedCalculation,
      getHistoryPage: service.getHistoryPage,
      saveCalculationFromTransport: service.saveCalculationFromTransport,
      SavedCalculationPage: page.SavedCalculationPage,
      resultsAction: results.action,
      historyLoader: history.loader,
      detailLoader: detail.loader,
      calculatorLoader: calculator.loader,
    };
    shopA = await freshShop("a");
    shopB = await freshShop("b");
    await m.replaceExpenseRulesForShop(
      shopA,
      DEFAULT_EXPENSE_RULES.map((r) => ({ ...r, ruleType: r.ruleType, enabled: true })),
    );
  }, 60_000);

  afterAll(async () => {
    if (!m) return;
    await m.sequelize.query("DELETE FROM shop WHERE id IN (:ids)", { replacements: { ids: createdShopIds } });
    const [left] = await m.sequelize.query<{ c: string }>(
      "SELECT (SELECT count(*) FROM shop WHERE id IN (:ids)) + (SELECT count(*) FROM calculation WHERE shop_id IN (:ids)) + (SELECT count(*) FROM calculation_line_item WHERE shop_id IN (:ids)) + (SELECT count(*) FROM expense_rule WHERE shop_id IN (:ids)) AS c",
      { replacements: { ids: createdShopIds }, type: QueryTypes.SELECT },
    );
    expect(Number((left as { c: string }).c)).toBe(0);
    await m.sequelize.close();
  }, 60_000);

  it("runs under the production pool constraint (pool.max = 1)", () => {
    expect(seqOptions().pool?.max).toBe(1);
  });

  // ------------------------------------------------------------------------
  describe("save (route action -> service -> repository)", () => {
    let savedId = "";

    it("persists one calculation + one line item per applied category, redirects to the detail page", async () => {
      auth.shop = shopA.shopDomain;
      const res = (await postSave(encodeDefaultResult())) as Response;
      expect(res.status).toBe(302);
      const location = res.headers.get("Location") ?? "";
      const match = /^\/app\/history\/([0-9a-f-]{36})\?saved=1$/.exec(location);
      expect(match, `unexpected redirect target: ${location}`).not.toBeNull();
      savedId = match![1]!;

      const [calc] = await m.sequelize.query<Record<string, string>>(
        "SELECT shop_id, revenue_minor::text, currency_code, total_expenses_minor::text, net_amount_minor::text, engine_version FROM calculation WHERE id = :id",
        { replacements: { id: savedId }, type: QueryTypes.SELECT },
      );
      const expected = buildDefaultResult();
      expect(calc?.shop_id).toBe(shopA.shopId);
      expect(calc?.revenue_minor).toBe(String(expected.revenueMinor));
      expect(calc?.currency_code).toBe("USD");
      expect(calc?.total_expenses_minor).toBe(String(expected.totalExpensesMinor));
      expect(calc?.net_amount_minor).toBe(String(expected.netAmountMinor));
      expect(calc?.engine_version).toBe(ENGINE_VERSION); // FT-14c

      const items = await m.sequelize.query<Record<string, unknown>>(
        "SELECT category_key, category_label_at_save, rule_type_at_save, rate_basis_points_at_save, fixed_amount_minor_at_save::text AS fixed_at_save, formula_key_at_save, computed_amount_minor::text AS amount, sort_order, rule_snapshot FROM calculation_line_item WHERE calculation_id = :id ORDER BY sort_order",
        { replacements: { id: savedId }, type: QueryTypes.SELECT },
      );
      expect(items).toHaveLength(expected.lineItems.length);
      expected.lineItems.forEach((li, i) => {
        const row = items[i]!;
        expect(row.category_key).toBe(li.categoryKey);
        expect(row.category_label_at_save).toBe(li.categoryLabel);
        expect(row.rule_type_at_save).toBe(li.ruleType);
        expect(row.rate_basis_points_at_save).toBe(li.rateBasisPoints);
        expect(row.fixed_at_save).toBe(li.fixedAmountMinor === null ? null : String(li.fixedAmountMinor));
        expect(row.amount).toBe(String(li.computedAmountMinor));
        expect(row.sort_order).toBe(li.sortOrder);
        expect((row.rule_snapshot as { ruleType: string }).ruleType).toBe(li.ruleType);
      });
      const sum = items.reduce((acc, r) => acc + Number(r.amount), 0);
      expect(sum).toBe(expected.totalExpensesMinor);
    });

    it("has NO foreign key from any saved-calculation table to expense_rule", async () => {
      const fks = await m.sequelize.query<{ table_name: string; referenced: string }>(
        `SELECT cl.relname AS table_name, rf.relname AS referenced
           FROM pg_constraint c
           JOIN pg_class cl ON cl.oid = c.conrelid
           JOIN pg_class rf ON rf.oid = c.confrelid
          WHERE c.contype = 'f' AND cl.relname IN ('calculation', 'calculation_line_item')`,
        { type: QueryTypes.SELECT },
      );
      expect(fks.length).toBeGreaterThan(0);
      for (const fk of fks) expect(fk.referenced).not.toBe("expense_rule");
    });

    it("rejects a tampered payload through the real action and writes nothing", async () => {
      auth.shop = shopA.shopDomain;
      const before = await rowCounts(shopA.shopId);
      const tampered = tamperTransport(encodeDefaultResult(), (p) => {
        (p.li as Array<{ amt: number }>)[0]!.amt += 1;
      });
      const outcome = (await postSave(tampered)) as { ok: boolean; message: string };
      expect(outcome.ok).toBe(false);
      expect(outcome.message).toMatch(/could not be saved/);
      expect(await rowCounts(shopA.shopId)).toEqual(before);
    });

    it("cannot save under another shop's identity: the shop comes from the session, not the form", async () => {
      auth.shop = shopB.shopDomain;
      const beforeA = await rowCounts(shopA.shopId);
      const body = new FormData();
      body.set("intent", "save");
      body.set("d", encodeDefaultResult(1_000_000));
      body.set("shopId", shopA.shopId); // attacker-supplied, must be ignored
      body.set("shop", shopA.shopDomain);
          const args: any = { request: new Request("http://localhost/app/results", { method: "POST", body }), params: {}, context: {} };
      const res = (await m.resultsAction(args)) as Response;
      expect(res.status).toBe(302);
      expect(await rowCounts(shopA.shopId)).toEqual(beforeA); // A untouched
      expect((await rowCounts(shopB.shopId)).calculations).toBe(1); // landed on B
    });

    it("keeps a saved calculation reachable as the saved id for later tests", () => {
      expect(savedId).toMatch(/^[0-9a-f-]{36}$/);
    });

    // -- FT-14a -----------------------------------------------------------
    it("FT-14a: editing every live rule afterwards leaves the saved detail byte-identical", async () => {
      auth.shop = shopA.shopDomain;
      const renderDetail = async () => {
        const loaded = (await m.detailLoader(loaderArgs(`http://localhost/app/history/${savedId}`, { id: savedId }))) as {
          saved: NonNullable<Awaited<ReturnType<typeof m.getSavedCalculation>>>;
        };
        return {
          json: JSON.stringify(loaded),
          html: renderToStaticMarkup(createElement(m.SavedCalculationPage, { saved: loaded.saved })),
        };
      };

      const before = await renderDetail();
      const liveBefore = JSON.stringify(
        (await m.listExpenseRulesForShop(shopA)).map((r) => [r.categoryKey, r.ruleType, r.rateBasisPoints, r.fixedAmountMinor, r.formulaKey, r.enabled]),
      );

      // Mutate EVERY live rule: different type, different value, all disabled.
      await m.replaceExpenseRulesForShop(
        shopA,
        DEFAULT_EXPENSE_RULES.map((r, i) =>
          i % 2 === 0
            ? { categoryKey: r.categoryKey, ruleType: "fixed" as const, rateBasisPoints: null, fixedAmountMinor: 777_777 + i, formulaKey: null, enabled: false }
            : { categoryKey: r.categoryKey, ruleType: "percentage" as const, rateBasisPoints: 9_999 - i, fixedAmountMinor: null, formulaKey: null, enabled: false },
        ),
      );
      const liveAfter = JSON.stringify(
        (await m.listExpenseRulesForShop(shopA)).map((r) => [r.categoryKey, r.ruleType, r.rateBasisPoints, r.fixedAmountMinor, r.formulaKey, r.enabled]),
      );
      expect(liveAfter, "the live rules must actually have changed for this test to mean anything").not.toBe(liveBefore);

      const after = await renderDetail();
      expect(after.json).toBe(before.json);
      expect(after.html).toBe(before.html);
      expect(before.html).toContain("32.5% of revenue"); // the rule as saved, not the mutated live rule
      expect(before.html).not.toContain("777777");
    });

    it("FT-14a: the detail renders the STORED label/rule, not anything current", async () => {
      const result = buildDefaultResult();
      const legacy: EngineResult = {
        ...result,
        lineItems: result.lineItems.map((li, i) =>
          i === 0 ? { ...li, categoryLabel: "Legacy Label Zzz" } : li,
        ),
      };
      const inserted = await m.insertCalculationSnapshot(shopA, legacy);
      const saved = await m.getSavedCalculation(shopA, inserted.id);
      expect(saved).not.toBeNull();
      const html = renderToStaticMarkup(createElement(m.SavedCalculationPage, { saved: saved! }));
      expect(html).toContain("Legacy Label Zzz");
      expect(html).not.toContain(">Cost of Goods<");
    });

    // -- FT-14b -----------------------------------------------------------
    it("FT-14b: reading the history list and a detail issues no query that touches expense_rule", async () => {
      const queries: string[] = [];
      const original = seqOptions().logging;
      seqOptions().logging = (sql: string) => {
        queries.push(String(sql));
      };
      try {
        await m.getHistoryPage(shopA, 1);
        await m.getSavedCalculation(shopA, savedId);
      } finally {
        seqOptions().logging = original;
      }
      expect(queries.length, "the query log must have captured the reads").toBeGreaterThan(0);
      for (const q of queries) expect(q.toLowerCase()).not.toContain("expense_rule");
    });

    // -- FT-14c -----------------------------------------------------------
    it("FT-14c: UPDATE against calculation / calculation_line_item is rejected by the database (append-only)", async () => {
      await expect(
        m.sequelize.query("UPDATE calculation SET revenue_minor = 1 WHERE id = :id", { replacements: { id: savedId } }),
      ).rejects.toThrow(/append-only/i);
      await expect(
        m.sequelize.query("UPDATE calculation_line_item SET computed_amount_minor = 1 WHERE calculation_id = :id", {
          replacements: { id: savedId },
        }),
      ).rejects.toThrow(/append-only/i);
      const saved = await m.getSavedCalculation(shopA, savedId);
      expect(saved?.result.revenueMinor).toBe(5_000_000);
    });
  });

  // ------------------------------------------------------------------------
  describe("tenant isolation (FT-02b)", () => {
    let idOfA = "";

    it("seeds a calculation for shop A", async () => {
      const inserted = await m.insertCalculationSnapshot(shopA, buildDefaultResult(2_468_000));
      idOfA = inserted.id;
      auth.shop = shopA.shopDomain;
      const loaded = (await m.detailLoader(loaderArgs(`http://localhost/app/history/${idOfA}`, { id: idOfA }))) as {
        saved: { result: { revenueMinor: number } };
      };
      expect(loaded.saved.result.revenueMinor).toBe(2_468_000);
    });

    it("shop B cannot read shop A's calculation by id; the 404 is identical to a nonexistent id's", async () => {
      auth.shop = shopB.shopDomain;
      expect(await m.getSavedCalculation(shopB, idOfA)).toBeNull();

      const otherShops = await thrownResponse(
        m.detailLoader(loaderArgs(`http://localhost/app/history/${idOfA}`, { id: idOfA })),
      );
      const nonexistent = await thrownResponse(
        m.detailLoader(loaderArgs(`http://localhost/app/history/x`, { id: randomUUID() })),
      );
      const malformed = await thrownResponse(
        m.detailLoader(loaderArgs(`http://localhost/app/history/x`, { id: "not-a-uuid" })),
      );
      expect(otherShops.status).toBe(404);
      expect(otherShops).toEqual(nonexistent); // no existence oracle: same status AND body
      expect(otherShops).toEqual(malformed);
    });

    it("shop B's history list never contains shop A's rows", async () => {
      auth.shop = shopB.shopDomain;
      const page = await m.getHistoryPage(shopB, 1);
      expect(page.items.map((i) => i.id)).not.toContain(idOfA);
      const aPage = await m.getHistoryPage(shopA, 1);
      expect(aPage.items.map((i) => i.id)).toContain(idOfA);
      expect(aPage.totalCount).toBeGreaterThan(page.totalCount);
    });

    it("the duplicate-as-new-calculation loader ignores another shop's id (no prefill, no leak)", async () => {
      auth.shop = shopB.shopDomain;
      const loaded = (await m.calculatorLoader(
        loaderArgs(`http://localhost/app/calculator?from=${idOfA}`),
      )) as { prefill: unknown };
      expect(loaded.prefill).toBeNull();
    });
  });

  // ------------------------------------------------------------------------
  describe("save atomicity — a failure mid-save leaves zero rows", () => {
    it("a CHECK violation on a later line item rolls back the calculation row and the earlier line items", async () => {
      const shop = await freshShop("atomic-check");
      const bad = buildDefaultResult();
      const broken: EngineResult = {
        ...bad,
        // 4th line item violates chk_cli_amount_nonneg AFTER the calculation
        // row and (in one multi-row insert) the earlier items were sent.
        lineItems: bad.lineItems.map((li, i) => (i === 3 ? { ...li, computedAmountMinor: -5 as never } : li)),
      };
      await expect(m.insertCalculationSnapshot(shop, broken)).rejects.toThrow();
      expect(await rowCounts(shop.shopId)).toEqual({ calculations: 0, lineItems: 0 });
    });

    it("a duplicate category (unique violation) rolls everything back", async () => {
      const shop = await freshShop("atomic-dup");
      const ok = buildDefaultResult();
      const dup: EngineResult = { ...ok, lineItems: [...ok.lineItems, ok.lineItems[0]!] };
      await expect(m.insertCalculationSnapshot(shop, dup)).rejects.toThrow();
      expect(await rowCounts(shop.shopId)).toEqual({ calculations: 0, lineItems: 0 });
    });

    it("a reconciliation failure caught by the deferred DB trigger at commit rolls everything back", async () => {
      const shop = await freshShop("atomic-recon");
      const ok = buildDefaultResult();
      // Every CHECK passes (all amounts >= 0) but total != sum(line items):
      // only the deferred reconciliation trigger can catch this, at COMMIT.
      const off: EngineResult = { ...ok, totalExpensesMinor: (ok.totalExpensesMinor + 1) as never };
      await expect(m.insertCalculationSnapshot(shop, off)).rejects.toThrow(/reconcile/i);
      expect(await rowCounts(shop.shopId)).toEqual({ calculations: 0, lineItems: 0 });
    });

    it("the pool is not wedged by failures: a valid save afterwards succeeds under pool.max = 1", async () => {
      const shop = await freshShop("atomic-after");
      const bad = buildDefaultResult();
      await expect(
        m.insertCalculationSnapshot(shop, { ...bad, totalExpensesMinor: (bad.totalExpensesMinor + 7) as never }),
      ).rejects.toThrow();
      const inserted = await m.insertCalculationSnapshot(shop, buildDefaultResult());
      expect(inserted.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(await rowCounts(shop.shopId)).toEqual({ calculations: 1, lineItems: 10 });
    });

    it("an all-disabled calculation (zero line items) saves atomically as a single row", async () => {
      const shop = await freshShop("atomic-empty");
      const ok = buildDefaultResult();
      const empty: EngineResult = { ...ok, lineItems: [], totalExpensesMinor: 0 as never, netAmountMinor: ok.revenueMinor };
      await m.insertCalculationSnapshot(shop, empty);
      expect(await rowCounts(shop.shopId)).toEqual({ calculations: 1, lineItems: 0 });
    });
  });

  // ------------------------------------------------------------------------
  describe("history list: newest first, pagination, empty state", () => {
    it("a shop with no saved calculations gets an empty first page", async () => {
      const shop = await freshShop("empty");
      auth.shop = shop.shopDomain;
      const loaded = (await m.historyLoader(loaderArgs("http://localhost/app/history"))) as unknown as {
        history: { items: unknown[]; page: number; totalPages: number; totalCount: number };
      };
      expect(loaded.history.items).toHaveLength(0);
      expect(loaded.history.totalCount).toBe(0);
      expect(loaded.history.totalPages).toBe(1);
      expect(loaded.history.page).toBe(1);
    });

    it("pages 25 saved calculations as 20 + 5, newest first, with no overlap", async () => {
      const shop = await freshShop("paging");
      auth.shop = shop.shopDomain;
      const expectedNewestFirst: string[] = [];
      for (let i = 0; i < 25; i += 1) {
        // Distinct revenue per row so each is identifiable; sequential saves
        // give strictly increasing created_at.
        const inserted = await m.insertCalculationSnapshot(shop, buildDefaultResult(1_000_000 + i * 1000));
        expectedNewestFirst.unshift(inserted.id);
      }

      const p1 = (await m.historyLoader(loaderArgs("http://localhost/app/history"))) as {
        history: Awaited<ReturnType<typeof m.getHistoryPage>>;
      };
      const p2 = (await m.historyLoader(loaderArgs("http://localhost/app/history?page=2"))) as typeof p1;

      expect(p1.history.totalCount).toBe(25);
      expect(p1.history.totalPages).toBe(2);
      expect(p1.history.items).toHaveLength(20);
      expect(p2.history.items).toHaveLength(5);
      expect(p2.history.page).toBe(2);

      const ids = [...p1.history.items, ...p2.history.items].map((i) => i.id);
      expect(ids).toEqual(expectedNewestFirst); // newest first, contiguous, no overlap/gap
      expect(new Set(ids).size).toBe(25);

      // Out-of-range / junk page params never error and never leak beyond the data.
      const far = (await m.historyLoader(loaderArgs("http://localhost/app/history?page=99"))) as typeof p1;
      expect(far.history.page).toBe(2);
      const junk = (await m.historyLoader(loaderArgs("http://localhost/app/history?page=abc"))) as typeof p1;
      expect(junk.history.page).toBe(1);
    }, 180_000);
  });

  // ------------------------------------------------------------------------
  describe("duplicate as new calculation", () => {
    it("pre-fills from the SNAPSHOT (not the live rules) and writes nothing", async () => {
      const shop = await freshShop("dup");
      auth.shop = shop.shopDomain;
      await m.replaceExpenseRulesForShop(
        shop,
        DEFAULT_EXPENSE_RULES.map((r) => ({ ...r, ruleType: r.ruleType, enabled: true })),
      );
      const inserted = await m.insertCalculationSnapshot(shop, buildDefaultResult(3_333_300, "CAD"));

      // Change the live rules after saving.
      await m.replaceExpenseRulesForShop(
        shop,
        DEFAULT_EXPENSE_RULES.map((r) => ({
          categoryKey: r.categoryKey,
          ruleType: "percentage" as const,
          rateBasisPoints: 100,
          fixedAmountMinor: null,
          formulaKey: null,
          enabled: true,
        })),
      );
      const rulesBefore = JSON.stringify((await m.listExpenseRulesForShop(shop)).map((r) => r.toJSON()));
      const countBefore = await m.countCalculationsForShop(shop);

      const loaded = (await m.calculatorLoader(
        loaderArgs(`http://localhost/app/calculator?from=${inserted.id}`),
      )) as unknown as {
        rules: Array<{ categoryKey: string; ruleType: string; rateBasisPoints: number | null; fixedAmountMinor: number | null; enabled: boolean }>;
        prefill: { revenueMinor: number; currencyCode: string } | null;
      };
      expect(loaded.prefill?.revenueMinor).toBe(3_333_300);
      expect(loaded.prefill?.currencyCode).toBe("CAD");
      const cogs = loaded.rules.find((r) => r.categoryKey === "cost_of_goods")!;
      expect(cogs.rateBasisPoints).toBe(3250); // snapshot's 32.5%, not the live 1%
      const shipping = loaded.rules.find((r) => r.categoryKey === "shipping")!;
      expect(shipping.ruleType).toBe("fixed"); // snapshot's rule type, not the live percentage
      expect(shipping.fixedAmountMinor).toBe(45_000);

      // Read-only: neither the live rules nor the saved history changed.
      expect(JSON.stringify((await m.listExpenseRulesForShop(shop)).map((r) => r.toJSON()))).toBe(rulesBefore);
      expect(await m.countCalculationsForShop(shop)).toBe(countBefore);
    }, 60_000);
  });
});
