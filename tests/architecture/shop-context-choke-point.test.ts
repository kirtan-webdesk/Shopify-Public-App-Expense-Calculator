import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Static guard (runs in default CI, no DB) for the G4-sprint-3.2 P1 fix.
//
// Bug it prevents from returning: under Shopify managed installation + token
// exchange /auth/* is never visited, so no `shop` row is created by an
// install hook. An /app route that resolved its ShopContext with the
// lookup-only `findShopContextByDomain` and threw a 404 when the row was
// absent locked EVERY real merchant out ("Shop record not found for this
// session — try reinstalling the app."). Every authenticated /app route must
// obtain its ShopContext through the ensure-shop choke point
// `requireShopContext(session)` (app/services/shop-context.service.ts).
//
// Static/textual (same approximation style as route-auth-matrix.test.ts).

const ROUTES_DIR = join(process.cwd(), "app", "routes");
const appRouteFiles = readdirSync(ROUTES_DIR).filter(
  (f) => /^app(\.|\.tsx$)/.test(f) && (f.endsWith(".tsx") || f.endsWith(".ts")),
);

function read(file: string): string {
  return readFileSync(join(ROUTES_DIR, file), "utf8");
}

describe("shop-context choke point (P1 no-shop-row outage guard)", () => {
  it("finds the /app route files", () => {
    expect(appRouteFiles).toEqual(
      expect.arrayContaining([
        "app.tsx",
        "app._index.tsx",
        "app.calculator.tsx",
        "app.rules.tsx",
        "app.results.tsx",
        "app.history.tsx",
        "app.history.$id.tsx",
      ]),
    );
  });

  it.each(appRouteFiles)("%s never throws the old 'Shop record not found' 404", (file) => {
    expect(read(file)).not.toMatch(/Shop record not found/i);
    expect(read(file)).not.toMatch(/try reinstalling the app/i);
  });

  it.each(appRouteFiles)("%s never uses the lookup-only findShopContextByDomain", (file) => {
    expect(
      read(file),
      `${file} must resolve its ShopContext via requireShopContext(session), which creates the ` +
        "shop row if absent; findShopContextByDomain returns null for a first-request shop.",
    ).not.toMatch(/findShopContextByDomain/);
  });

  it.each(appRouteFiles)("%s never builds a ShopContext by hand or reads the shop from request input", (file) => {
    const source = read(file);
    expect(source).not.toMatch(/createShopContext\s*\(/);
    // The shop identity comes only from the authenticated session.
    expect(source).not.toMatch(/searchParams\.get\(\s*["']shop["']\s*\)/);
    expect(source).not.toMatch(/formData\.get\(\s*["']shop(Id|Domain)?["']\s*\)/);
    expect(source).not.toMatch(/params\.shop/);
  });

  it.each(appRouteFiles)(
    "%s: any route that uses a ctx / ShopContext gets it from requireShopContext(session)",
    (file) => {
      const source = read(file);
      const usesTenantData =
        /\bctx\b/.test(source) && /export\s+(async\s+)?function\s+(loader|action)/.test(source);
      if (!usesTenantData) return;
      expect(source).toMatch(/import\s+\{\s*requireShopContext\s*\}\s+from\s+["']~\/services\/shop-context\.service["']/);
      // Every `const ctx =` in a route is the choke point call, fed the session.
      const assignments = source.match(/const\s+ctx\s*=\s*[^;]+;/g) ?? [];
      expect(assignments.length).toBeGreaterThan(0);
      for (const a of assignments) {
        expect(a).toMatch(/=\s*await\s+requireShopContext\(\s*session\s*\)\s*;/);
      }
    },
  );

  it("every loader/action in the tenant-data routes that authenticates also binds `session` for the choke point", () => {
    for (const file of ["app.calculator.tsx", "app.rules.tsx", "app.history.tsx", "app.history.$id.tsx", "app.results.tsx"]) {
      const source = read(file);
      const calls = (source.match(/requireShopContext\(\s*session\s*\)/g) ?? []).length;
      const sessionBindings = (source.match(/const\s+\{\s*session\s*\}\s*=\s*await\s+authenticate\.admin\(/g) ?? []).length;
      expect(calls, `${file} has no requireShopContext(session) call`).toBeGreaterThan(0);
      expect(sessionBindings, `${file}: each requireShopContext(session) needs the authenticated session`).toBeGreaterThanOrEqual(calls);
    }
  });

  it("the choke point takes the authenticated session (not a bare string) and delegates to ensureShopContext", () => {
    const source = readFileSync(join(process.cwd(), "app", "services", "shop-context.service.ts"), "utf8");
    expect(source).toMatch(/export\s+async\s+function\s+requireShopContext\(\s*session:\s*\{\s*readonly\s+shop:\s*string\s*\}\s*\)/);
    expect(source).toMatch(/ensureShopContext\(\s*session\.shop\s*\)/);
  });

  it("the repository's ensure path is race-safe (ON CONFLICT DO NOTHING) and opens no transaction", () => {
    const source = readFileSync(join(process.cwd(), "app", "db", "repositories", "shop.repository.ts"), "utf8");
    const start = source.indexOf("export async function ensureShopContext");
    const end = source.indexOf("export async function upsertInstalledShop");
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const body = source.slice(start, end);
    expect(body).toMatch(/ignoreDuplicates:\s*true/);
    expect(body).not.toMatch(/\.transaction\s*\(/);
    expect(body).not.toMatch(/findOrCreate/); // findOrCreate opens its own transaction/savepoint
    expect(body).not.toMatch(/ShopModel\.create\s*\(/); // a bare create() throws on the unique(shop_domain) race
  });

  it("auth.$ route still creates/reactivates the shop row", () => {
    expect(read("auth.$.tsx")).toMatch(/upsertInstalledShop\(\s*session\.shop\s*\)/);
  });
});
