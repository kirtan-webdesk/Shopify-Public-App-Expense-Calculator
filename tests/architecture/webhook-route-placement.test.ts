import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Approximates FT-04 (ADR-0002): webhook routes must NOT be nested under the
// `app` layout route. Static check on app/routes.ts's route-config source —
// a real FT-04 (per fitness-test-plan.md) may instead introspect the built
// route manifest; this is the textual equivalent for M1.

describe("webhook route placement (FT-04 approximation)", () => {
  it("webhook routes are declared as siblings of, not children within, the app layout route() call", () => {
    const source = readFileSync(join(process.cwd(), "app", "routes.ts"), "utf8");

    const appLayoutMatch = source.match(/route\("app",\s*"routes\/app\.tsx",\s*\[([\s\S]*?)\]\)/);
    expect(appLayoutMatch, "could not find the /app layout route() block").not.toBeNull();

    const appLayoutBody = appLayoutMatch?.[1] ?? "";
    expect(appLayoutBody).not.toMatch(/webhooks\./);

    for (const webhookRoute of [
      "webhooks/app-uninstalled",
      "webhooks/customers-data-request",
      "webhooks/customers-redact",
      "webhooks/shop-redact",
    ]) {
      expect(source).toContain(webhookRoute);
    }
  });
});
