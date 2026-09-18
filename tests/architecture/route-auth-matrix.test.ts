import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Approximates FT-03 (shopify-app-auth-and-routes skill / ADR-0007
// enforcement table): every route file with a loader or action either calls
// the correct authenticate.* for its class, or is in the explicit
// unauthenticated allowlist (healthz only). Static/textual, not an AST
// check — a real FT-03 (AST-based) is fitness-test-plan.md scope.

const ROUTES_DIR = join(process.cwd(), "app", "routes");
const UNAUTHENTICATED_ALLOWLIST = new Set(["healthz.tsx"]);
// Children of the /app layout route (app.tsx) inherit authenticate.admin
// from their PARENT's loader — React Router runs every matched route's
// loader (parent and child) for a given request, so app.tsx's loader
// authenticates every /app/* request including its index/child routes.
// Covered directly by the "the app layout route calls authenticate.admin"
// test below; child routes are not required to re-call it themselves.
const LAYOUT_INHERITS_AUTH_FROM = new Set(["app._index.tsx"]);

function listRouteFiles(): string[] {
  return readdirSync(ROUTES_DIR).filter((f) => f.endsWith(".tsx") || f.endsWith(".ts"));
}

describe("route-authentication matrix (FT-03 approximation)", () => {
  const files = listRouteFiles();

  it("finds at least the expected route files", () => {
    expect(files.length).toBeGreaterThanOrEqual(9);
  });

  it.each(files)("%s either authenticates or is explicitly allowlisted", (file) => {
    const source = readFileSync(join(ROUTES_DIR, file), "utf8");
    const hasLoaderOrAction = /export\s+(async\s+)?function\s+(loader|action)/.test(source);
    if (!hasLoaderOrAction) {
      // A pure UI route (no loader/action) has no server-side auth surface
      // to check here — it inherits its parent layout's authenticate call
      // (app.tsx), which is itself checked below.
      return;
    }

    const isAllowlisted = UNAUTHENTICATED_ALLOWLIST.has(file);
    const inheritsFromLayout = LAYOUT_INHERITS_AUTH_FROM.has(file);
    const callsAdminAuth = /authenticate\.admin\s*\(/.test(source);
    const callsWebhookAuth = /authenticate\.webhook\s*\(/.test(source);

    expect(
      isAllowlisted || inheritsFromLayout || callsAdminAuth || callsWebhookAuth,
      `${file} has a loader/action but calls neither authenticate.admin nor ` +
        "authenticate.webhook, is not on the unauthenticated allowlist, and " +
        "is not a documented layout-inherits-auth exception.",
    ).toBe(true);
  });

  it("webhook route files call authenticate.webhook, not authenticate.admin", () => {
    const webhookFiles = files.filter((f) => f.startsWith("webhooks."));
    expect(webhookFiles.length).toBe(4);
    for (const file of webhookFiles) {
      const source = readFileSync(join(ROUTES_DIR, file), "utf8");
      expect(source, `${file} must call authenticate.webhook`).toMatch(
        /authenticate\.webhook\s*\(/,
      );
      expect(source, `${file} must not call authenticate.admin`).not.toMatch(
        /authenticate\.admin\s*\(/,
      );
    }
  });

  it("the app layout route calls authenticate.admin", () => {
    const source = readFileSync(join(ROUTES_DIR, "app.tsx"), "utf8");
    expect(source).toMatch(/authenticate\.admin\s*\(/);
  });

  it("healthz has no loader/action calling any authenticate.* (stays unauthenticated by design)", () => {
    const source = readFileSync(join(ROUTES_DIR, "healthz.tsx"), "utf8");
    expect(source).not.toMatch(/authenticate\.(admin|webhook)\s*\(/);
  });
});
