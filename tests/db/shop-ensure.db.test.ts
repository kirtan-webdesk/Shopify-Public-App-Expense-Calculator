import { randomUUID } from "node:crypto";
import { QueryTypes } from "sequelize";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { EXPENSE_CATEGORIES } from "~/domain/expense-categories";
import { encodeDefaultResult } from "../helpers/calc-fixtures";
import { assertConnectedToTestDatabase, setupTestDatabase } from "../helpers/test-database";

// --------------------------------------------------------------------------
// G4-sprint-3.2 (P1 fix) — "no shop row" gap, real Postgres, OPT-IN.
//
// The bug this pins: under Shopify managed installation + token exchange the
// embedded app loads straight at /app/... and nothing ever created the `shop`
// row, so every /app loader/action 404'd ("Shop record not found for this
// session"). The M4 DB suite never saw it because its helper pre-seeded the
// shop row via upsertInstalledShop. THIS suite deliberately never seeds a
// shop row: every scenario starts from a genuinely fresh shop domain with NO
// row (asserted by a raw SELECT before the first request), and rows come into
// existence only as a side effect of the real route loaders/actions.
//
// Runs only with RUN_DB_TESTS=1 (skipped and reported as skipped otherwise;
// the default `npm test` stays DB-free — see tests/README.md) AND a
// TEST_DATABASE_URL pointing at a SEPARATE database (never production —
// tests/helpers/test-database.ts fails loudly if it is unset or matches any
// non-test URL):
//
//   RUN_DB_TESTS=1 TEST_DATABASE_URL=... npx vitest run tests/db/shop-ensure.db.test.ts
//
// Real route loaders/actions -> requireShopContext -> service -> repository ->
// Postgres, under the production pool.max:1. Only `authenticate.admin` is
// replaced (a real Shopify session-token JWT cannot be fabricated), resolving
// to the shop under test exactly as the real one resolves `session.shop`.
// The only non-request-path helpers used are markShopUninstalled /
// hardDeleteShop, which simulate the app/uninstalled and shop/redact
// webhook handlers' repository calls (the real production functions).
// --------------------------------------------------------------------------

// Throws loudly (RUN_DB_TESTS=1 with no/unsafe TEST_DATABASE_URL); redirects the app at the TEST DB.
const RUN_DB = setupTestDatabase();

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const auth = vi.hoisted(() => ({ shop: "" }));
vi.mock("~/shopify.server", () => ({
  authenticate: { admin: async () => ({ session: { shop: auth.shop } }) },
}));

const RUN_ID = randomUUID().slice(0, 8);

let m: {
  sequelize: typeof import("~/db/sequelize").sequelize;
  markShopUninstalled: typeof import("~/db/repositories/shop.repository").markShopUninstalled;
  hardDeleteShop: typeof import("~/db/repositories/shop.repository").hardDeleteShop;
  findShopContextByDomain: typeof import("~/db/repositories/shop.repository").findShopContextByDomain;
  calculatorLoader: typeof import("~/routes/app.calculator").loader;
  calculatorAction: typeof import("~/routes/app.calculator").action;
  resultsLoader: typeof import("~/routes/app.results").loader;
  resultsAction: typeof import("~/routes/app.results").action;
  historyLoader: typeof import("~/routes/app.history").loader;
  detailLoader: typeof import("~/routes/app.history.$id").loader;
  appLayoutLoader: typeof import("~/routes/app").loader;
  authLoader: typeof import("~/routes/auth.$").loader;
};

const usedDomains: string[] = [];

/** A genuinely fresh domain: a string only — NO row is created for it. */
function freshDomain(label: string): string {
  const d = `ensure-${RUN_ID}-${label}-${randomUUID().slice(0, 8)}.myshopify.com`;
  usedDomains.push(d);
  return d;
}

function seqOptions() {
  return (m.sequelize as unknown as {
    options: { pool?: { max?: number }; logging?: ((sql: string) => void) | false };
  }).options;
}

interface ShopRow {
  id: string;
  shop_domain: string;
  installed_at: string | null;
  uninstalled_at: string | null;
  created_at: string;
}

async function shopRows(domain: string): Promise<ShopRow[]> {
  return m.sequelize.query<ShopRow>(
    "SELECT id, shop_domain, installed_at::text, uninstalled_at::text, created_at::text FROM shop WHERE shop_domain = :domain",
    { replacements: { domain }, type: QueryTypes.SELECT },
  );
}

async function countFor(table: "expense_rule" | "calculation", shopId: string): Promise<number> {
  const [r] = await m.sequelize.query<{ c: string }>(
    `SELECT count(*)::text AS c FROM ${table} WHERE shop_id = :shopId`,
    { replacements: { shopId }, type: QueryTypes.SELECT },
  );
  return Number(r?.c);
}

/** Asserts the no-pre-existing-row precondition, then hands back nothing. */
async function assertNoRow(domain: string) {
  expect(await shopRows(domain), `precondition: ${domain} must have NO shop row before its first request`).toHaveLength(0);
}

const loaderArgs = (url: string, params: Record<string, string> = {}): any => ({
  request: new Request(url),
  params,
  context: {},
});

function postArgs(url: string, fields: Record<string, string>): any {
  const body = new FormData();
  for (const [k, v] of Object.entries(fields)) body.set(k, v);
  return { request: new Request(url, { method: "POST", body }), params: {}, context: {} };
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

async function withSqlLog<T>(fn: () => Promise<T>): Promise<{ value: T; sql: string[] }> {
  const sql: string[] = [];
  const original = seqOptions().logging;
  seqOptions().logging = (s: string) => {
    sql.push(String(s));
  };
  try {
    return { value: await fn(), sql };
  } finally {
    seqOptions().logging = original;
  }
}

const isShopWrite = (s: string) => /^(Executing \([^)]*\): )?(INSERT INTO "shop"|UPDATE "shop")/i.test(s);

function allRulesForm(): Record<string, string> {
  const f: Record<string, string> = { intent: "save", revenue: "50000.00", currency: "USD" };
  for (const c of EXPENSE_CATEGORIES) {
    f[`enabled-${c.key}`] = "on";
    f[`type-${c.key}`] = "percentage";
    f[`percent-${c.key}`] = "1.00";
    f[`fixed-${c.key}`] = "0.00";
    f[`formula-${c.key}`] = "";
  }
  return f;
}

describe.skipIf(!RUN_DB)("ensure-shop on the request path (real Postgres, NO pre-seeded shop row)", () => {
  beforeAll(async () => {
    const [seq, shopRepo, calculator, results, history, detail, layout, authRoute] = await Promise.all([
      import("~/db/sequelize"),
      import("~/db/repositories/shop.repository"),
      import("~/routes/app.calculator"),
      import("~/routes/app.results"),
      import("~/routes/app.history"),
      import("~/routes/app.history.$id"),
      import("~/routes/app"),
      import("~/routes/auth.$"),
    ]);
    await assertConnectedToTestDatabase(seq.sequelize);
    m = {
      sequelize: seq.sequelize,
      markShopUninstalled: shopRepo.markShopUninstalled,
      hardDeleteShop: shopRepo.hardDeleteShop,
      findShopContextByDomain: shopRepo.findShopContextByDomain,
      calculatorLoader: calculator.loader,
      calculatorAction: calculator.action,
      resultsLoader: results.loader,
      resultsAction: results.action,
      historyLoader: history.loader,
      detailLoader: detail.loader,
      appLayoutLoader: layout.loader,
      authLoader: authRoute.loader,
    };
  }, 60_000);

  afterAll(async () => {
    if (!m) return;
    // Cleanup: every domain this run touched (+ a run-id LIKE sweep as a
    // safety net for a test that failed mid-way). Cascades remove rules /
    // calculations / line items.
    await m.sequelize.query("DELETE FROM shop WHERE shop_domain IN (:d) OR shop_domain LIKE :p", {
      replacements: { d: usedDomains.length ? usedDomains : ["-"], p: `ensure-${RUN_ID}-%` },
    });
    const [left] = await m.sequelize.query<{ c: string }>(
      "SELECT count(*)::text AS c FROM shop WHERE shop_domain IN (:d) OR shop_domain LIKE :p",
      { replacements: { d: usedDomains.length ? usedDomains : ["-"], p: `ensure-${RUN_ID}-%` }, type: QueryTypes.SELECT },
    );
    expect(Number(left?.c)).toBe(0);
    await m.sequelize.close();
  }, 60_000);

  it("runs under the production pool constraint (pool.max = 1)", () => {
    expect(seqOptions().pool?.max).toBe(1);
  });

  // (a) ---------------------------------------------------------------------
  describe("(a) /app/calculator on a first-ever request", () => {
    it("loader succeeds (no 404), creates the shop row and seeds the default rules", async () => {
      const domain = freshDomain("calc");
      auth.shop = domain;
      await assertNoRow(domain);

      const loaded = (await m.calculatorLoader(loaderArgs("http://localhost/app/calculator"))) as unknown as {
        rules: Array<{ categoryKey: string }>;
        prefill: unknown;
      };
      expect(loaded.rules).toHaveLength(EXPENSE_CATEGORIES.length);
      expect(loaded.prefill).toBeNull();

      const rows = await shopRows(domain);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.uninstalled_at).toBeNull();
      expect(rows[0]!.installed_at).not.toBeNull();
      expect(await countFor("expense_rule", rows[0]!.id)).toBe(EXPENSE_CATEGORIES.length);
    });

    it("action (save intent) succeeds on a first-ever request and persists the rules", async () => {
      const domain = freshDomain("calc-action");
      auth.shop = domain;
      await assertNoRow(domain);

      const result = (await m.calculatorAction(postArgs("http://localhost/app/calculator", allRulesForm()))) as { ok: boolean };
      expect(result.ok).toBe(true);
      const rows = await shopRows(domain);
      expect(rows).toHaveLength(1);
      expect(await countFor("expense_rule", rows[0]!.id)).toBe(EXPENSE_CATEGORIES.length);
    });
  });

  // (b) ---------------------------------------------------------------------
  describe("(b) results / history / history-detail on a first-ever request (each alone, fresh shop)", () => {
    it("/app/results loader succeeds (it does not need a shop row)", async () => {
      const domain = freshDomain("results-loader");
      auth.shop = domain;
      await assertNoRow(domain);
      const loaded = (await m.resultsLoader(loaderArgs("http://localhost/app/results"))) as { result: unknown };
      expect(loaded.result).toBeNull();
    });

    it("/app/results action (save) succeeds on a first-ever request, creating the row and the calculation", async () => {
      const domain = freshDomain("results-action");
      auth.shop = domain;
      await assertNoRow(domain);

      const res = (await m.resultsAction(
        postArgs("http://localhost/app/results", { intent: "save", d: encodeDefaultResult() }),
      )) as Response;
      expect(res.status).toBe(302);
      expect(res.headers.get("Location") ?? "").toMatch(/^\/app\/history\/[0-9a-f-]{36}\?saved=1$/);
      const rows = await shopRows(domain);
      expect(rows).toHaveLength(1);
      expect(await countFor("calculation", rows[0]!.id)).toBe(1);
    });

    it("/app/history loader returns the empty state for a first-ever request (not a 404)", async () => {
      const domain = freshDomain("history");
      auth.shop = domain;
      await assertNoRow(domain);
      const loaded = (await m.historyLoader(loaderArgs("http://localhost/app/history"))) as unknown as {
        history: { items: unknown[]; totalCount: number; page: number };
      };
      expect(loaded.history.items).toHaveLength(0);
      expect(loaded.history.totalCount).toBe(0);
      expect(loaded.history.page).toBe(1);
      expect(await shopRows(domain)).toHaveLength(1);
    });

    it("/app/history/:id loader for a first-ever request gives the ordinary 'Saved calculation not found' 404 — not the old shop-not-found one", async () => {
      const domain = freshDomain("detail");
      auth.shop = domain;
      await assertNoRow(domain);
      const out = await thrownResponse(
        m.detailLoader(loaderArgs("http://localhost/app/history/x", { id: randomUUID() })),
      );
      expect(out).toEqual({ status: 404, body: "Saved calculation not found." });
      expect(out.body).not.toMatch(/reinstall/i);
      expect(await shopRows(domain)).toHaveLength(1);
    });
  });

  // (c) ---------------------------------------------------------------------
  describe("(c) concurrent first requests", () => {
    it("two simultaneous first requests both succeed and exactly ONE shop row exists (conflict path exercised)", async () => {
      const domain = freshDomain("race");
      auth.shop = domain;
      await assertNoRow(domain);

      const { value, sql } = await withSqlLog(() =>
        Promise.all([
          m.calculatorLoader(loaderArgs("http://localhost/app/calculator")),
          m.calculatorLoader(loaderArgs("http://localhost/app/calculator")),
        ]),
      );
      expect(value).toHaveLength(2);
      const rows = await shopRows(domain);
      expect(rows).toHaveLength(1);
      // Prove the losing request really hit the unique(shop_domain) conflict
      // path (two INSERT attempts, one row) instead of the race being
      // sequenced away: both requests read "no row" before either inserted.
      const inserts = sql.filter((s) => /INSERT INTO "shop"/i.test(s));
      expect(inserts.length, `SQL log:\n${sql.join("\n")}`).toBeGreaterThanOrEqual(2);
      expect(inserts.every((s) => /ON CONFLICT DO NOTHING/i.test(s))).toBe(true);
      expect(await countFor("expense_rule", rows[0]!.id)).toBe(EXPENSE_CATEGORIES.length);
    });

    it("five mixed simultaneous first requests (loaders + action) all succeed; still exactly one row", async () => {
      const domain = freshDomain("race5");
      auth.shop = domain;
      await assertNoRow(domain);
      const settled = await Promise.allSettled([
        m.historyLoader(loaderArgs("http://localhost/app/history")),
        m.historyLoader(loaderArgs("http://localhost/app/history?page=2")),
        m.resultsAction(postArgs("http://localhost/app/results", { intent: "save", d: encodeDefaultResult() })),
        m.resultsAction(postArgs("http://localhost/app/results", { intent: "save", d: encodeDefaultResult(1_234_500) })),
        m.detailLoader(loaderArgs("http://localhost/app/history/x", { id: randomUUID() })),
      ]);
      // The detail request's expected outcome is the ordinary 404 Response.
      const unexpected = settled.filter(
        (s, i) => s.status === "rejected" && !(i === 4 && s.reason instanceof Response && s.reason.status === 404),
      );
      expect(unexpected, JSON.stringify(unexpected.map((u) => String((u as PromiseRejectedResult).reason)))).toHaveLength(0);
      const rows = await shopRows(domain);
      expect(rows).toHaveLength(1);
      expect(await countFor("calculation", rows[0]!.id)).toBe(2);
    });
  });

  // (d) ---------------------------------------------------------------------
  describe("(d) reinstall / redact semantics (ADR-0008)", () => {
    it("reinstall after uninstall (row has uninstalled_at set, redact NOT yet run): the next valid session clears uninstalled_at, keeps the SAME row, rules and history", async () => {
      const domain = freshDomain("reinstall");
      auth.shop = domain;
      await assertNoRow(domain);

      // First install -> first request creates the row, seeds rules, saves one calculation.
      await m.calculatorLoader(loaderArgs("http://localhost/app/calculator"));
      const saveRes = (await m.resultsAction(
        postArgs("http://localhost/app/results", { intent: "save", d: encodeDefaultResult() }),
      )) as Response;
      const savedId = /\/app\/history\/([0-9a-f-]{36})/.exec(saveRes.headers.get("Location") ?? "")![1]!;
      const [before] = await shopRows(domain);
      expect(before!.uninstalled_at).toBeNull();

      // app/uninstalled handler's repository call (ADR-0008 step 1): soft-mark.
      await m.sequelize.transaction(async (t) => {
        await m.markShopUninstalled(domain, t);
      });
      const [marked] = await shopRows(domain);
      expect(marked!.uninstalled_at, "precondition: shop must be marked uninstalled").not.toBeNull();
      expect(marked!.id).toBe(before!.id);

      // A valid session arrives again (reinstall / new token exchange).
      const loaded = (await m.historyLoader(loaderArgs("http://localhost/app/history"))) as unknown as {
        history: { items: Array<{ id: string }> };
      };
      const rows = await shopRows(domain);
      expect(rows).toHaveLength(1); // not duplicated
      expect(rows[0]!.id).toBe(before!.id); // same tenant root
      expect(rows[0]!.uninstalled_at).toBeNull(); // ADR-0008 step 2: cleared
      expect(rows[0]!.installed_at).toBe(before!.installed_at); // original install timestamp retained
      expect(await countFor("expense_rule", before!.id)).toBe(EXPENSE_CATEGORIES.length); // rules retained
      expect(loaded.history.items.map((i) => i.id)).toEqual([savedId]); // history retained
    });

    it("auth/* route (upsertInstalledShop) still works and reactivates an uninstalled shop the same way", async () => {
      const domain = freshDomain("reinstall-auth");
      auth.shop = domain;
      await assertNoRow(domain);
      await m.authLoader(loaderArgs("http://localhost/auth/callback")); // creates via the auth path
      const [created] = await shopRows(domain);
      expect(created).toBeDefined();
      await m.sequelize.transaction(async (t) => {
        await m.markShopUninstalled(domain, t);
      });
      await m.authLoader(loaderArgs("http://localhost/auth/callback"));
      const rows = await shopRows(domain);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.id).toBe(created!.id);
      expect(rows[0]!.uninstalled_at).toBeNull();
    });

    it("a session arriving AFTER shop/redact hard-deleted the shop simply recreates a fresh, empty row ('start clean')", async () => {
      const domain = freshDomain("post-redact");
      auth.shop = domain;
      await assertNoRow(domain);
      await m.calculatorLoader(loaderArgs("http://localhost/app/calculator"));
      await m.resultsAction(postArgs("http://localhost/app/results", { intent: "save", d: encodeDefaultResult() }));
      const [old] = await shopRows(domain);
      expect(await countFor("calculation", old!.id)).toBe(1);

      // shop/redact handler's repository call (real hardDeleteShop).
      const ctx = await m.findShopContextByDomain(domain);
      await m.sequelize.transaction(async (t) => {
        await m.hardDeleteShop(ctx!, randomUUID(), t);
      });
      expect(await shopRows(domain), "precondition: redact removed the shop row").toHaveLength(0);

      const loaded = (await m.historyLoader(loaderArgs("http://localhost/app/history"))) as unknown as {
        history: { items: unknown[]; totalCount: number };
      };
      const rows = await shopRows(domain);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.id).not.toBe(old!.id); // a NEW tenant root
      expect(rows[0]!.uninstalled_at).toBeNull();
      expect(loaded.history.totalCount).toBe(0); // no old data resurrected
      expect(await countFor("calculation", old!.id)).toBe(0);
    });
  });

  // (e) ---------------------------------------------------------------------
  describe("(e) created once, never duplicated; hot path is read-only", () => {
    it("repeat requests reuse the one row and issue no shop writes after the first", async () => {
      const domain = freshDomain("repeat");
      auth.shop = domain;
      await assertNoRow(domain);

      const first = await withSqlLog(() => m.historyLoader(loaderArgs("http://localhost/app/history")));
      expect(first.sql.some(isShopWrite), "the first request must create the row").toBe(true);
      const [created] = await shopRows(domain);

      const repeat = await withSqlLog(async () => {
        await m.historyLoader(loaderArgs("http://localhost/app/history"));
        await m.calculatorLoader(loaderArgs("http://localhost/app/calculator"));
        await m.historyLoader(loaderArgs("http://localhost/app/history?page=3"));
        await m.appLayoutLoader(loaderArgs("http://localhost/app"));
      });
      expect(repeat.sql.filter(isShopWrite), `unexpected shop writes on the hot path:\n${repeat.sql.join("\n")}`).toHaveLength(0);
      expect(repeat.sql.filter((s) => /FROM "shop"/i.test(s)).length).toBeGreaterThanOrEqual(3); // SELECT-first

      const rows = await shopRows(domain);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toEqual(created); // id, installed_at, created_at all unchanged
    });
  });

  // (f) ---------------------------------------------------------------------
  describe("(f) tenancy is unchanged", () => {
    it("shop B (also first-ever) cannot read shop A's calculation: identical 404 for a foreign, nonexistent and malformed id", async () => {
      const a = freshDomain("tenant-a");
      const b = freshDomain("tenant-b");
      await assertNoRow(a);
      await assertNoRow(b);

      auth.shop = a;
      const save = (await m.resultsAction(
        postArgs("http://localhost/app/results", { intent: "save", d: encodeDefaultResult(2_468_000) }),
      )) as Response;
      const idOfA = /\/app\/history\/([0-9a-f-]{36})/.exec(save.headers.get("Location") ?? "")![1]!;
      // Sanity: A can read its own.
      const own = (await m.detailLoader(loaderArgs("http://localhost/app/history/x", { id: idOfA }))) as unknown as {
        saved: { result: { revenueMinor: number } };
      };
      expect(own.saved.result.revenueMinor).toBe(2_468_000);

      auth.shop = b;
      await assertNoRow(b);
      const foreign = await thrownResponse(m.detailLoader(loaderArgs("http://localhost/app/history/x", { id: idOfA })));
      const nonexistent = await thrownResponse(m.detailLoader(loaderArgs("http://localhost/app/history/x", { id: randomUUID() })));
      const malformed = await thrownResponse(m.detailLoader(loaderArgs("http://localhost/app/history/x", { id: "not-a-uuid" })));
      expect(foreign.status).toBe(404);
      expect(foreign).toEqual(nonexistent);
      expect(foreign).toEqual(malformed);

      const bHistory = (await m.historyLoader(loaderArgs("http://localhost/app/history"))) as unknown as {
        history: { items: Array<{ id: string }>; totalCount: number };
      };
      expect(bHistory.history.items.map((i) => i.id)).not.toContain(idOfA);
      expect(bHistory.history.totalCount).toBe(0);
      const prefill = (await m.calculatorLoader(loaderArgs(`http://localhost/app/calculator?from=${idOfA}`))) as unknown as {
        prefill: unknown;
      };
      expect(prefill.prefill).toBeNull();
      expect(await shopRows(a)).toHaveLength(1);
      expect(await shopRows(b)).toHaveLength(1);
    });

    it("the shop comes ONLY from the session: shop/shopId in the URL or form create no row and never redirect the tenant", async () => {
      const real = freshDomain("session-only");
      const decoy = freshDomain("decoy");
      auth.shop = real;
      await assertNoRow(real);
      await assertNoRow(decoy);

      await m.calculatorLoader(loaderArgs(`http://localhost/app/calculator?shop=${decoy}&shopId=${randomUUID()}`));
      await m.historyLoader(loaderArgs(`http://localhost/app/history?shop=${decoy}`));
      await m.resultsAction(
        postArgs(`http://localhost/app/results?shop=${decoy}`, { intent: "save", d: encodeDefaultResult(), shop: decoy, shopDomain: decoy }),
      );

      expect(await shopRows(real)).toHaveLength(1);
      expect(await shopRows(decoy), "a request parameter must never create or select a tenant").toHaveLength(0);
      const [row] = await shopRows(real);
      expect(await countFor("calculation", row!.id)).toBe(1);
    });
  });
});
