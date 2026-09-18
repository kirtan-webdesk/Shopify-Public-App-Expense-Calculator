import { afterEach, describe, expect, it } from "vitest";
import { isAuthorizedCronRequest } from "~/services/cron-auth.service";

// Pure unit coverage for ADR-0009 D5's fail-closed shared-secret check — no
// DB, no HTTP server needed. The live end-to-end probe (real 401 + zero DB
// writes against a running server/Postgres) is gathered separately as live
// evidence (dev-evidence/g1.5-revision-adr0009-0010/); this file locks the
// pure logic down permanently in CI.

function requestWithAuthHeader(value: string | null): Request {
  const headers = new Headers();
  if (value !== null) headers.set("authorization", value);
  return new Request("https://example.test/api/cron/tick", { headers });
}

describe("cron-auth.service (ADR-0009 D5)", () => {
  const ORIGINAL_SECRET = process.env.CRON_SECRET;

  afterEach(() => {
    if (ORIGINAL_SECRET === undefined) {
      delete process.env.CRON_SECRET;
    } else {
      process.env.CRON_SECRET = ORIGINAL_SECRET;
    }
  });

  it("authorizes an exact `Bearer $CRON_SECRET` match", () => {
    process.env.CRON_SECRET = "a-real-looking-secret-value";
    expect(isAuthorizedCronRequest(requestWithAuthHeader("Bearer a-real-looking-secret-value"))).toBe(
      true,
    );
  });

  it("rejects a missing Authorization header", () => {
    process.env.CRON_SECRET = "a-real-looking-secret-value";
    expect(isAuthorizedCronRequest(requestWithAuthHeader(null))).toBe(false);
  });

  it("rejects a wrong secret", () => {
    process.env.CRON_SECRET = "a-real-looking-secret-value";
    expect(isAuthorizedCronRequest(requestWithAuthHeader("Bearer wrong-value"))).toBe(false);
  });

  it("rejects a header missing the 'Bearer ' prefix", () => {
    process.env.CRON_SECRET = "a-real-looking-secret-value";
    expect(isAuthorizedCronRequest(requestWithAuthHeader("a-real-looking-secret-value"))).toBe(
      false,
    );
  });

  it("rejects a header of very different length than expected (no early-return crash)", () => {
    process.env.CRON_SECRET = "a-real-looking-secret-value";
    expect(isAuthorizedCronRequest(requestWithAuthHeader("Bearer x"))).toBe(false);
    expect(isAuthorizedCronRequest(requestWithAuthHeader("Bearer " + "x".repeat(5000)))).toBe(
      false,
    );
  });

  it("FAILS CLOSED when CRON_SECRET is unset — even a header that would otherwise match is rejected", () => {
    delete process.env.CRON_SECRET;
    expect(isAuthorizedCronRequest(requestWithAuthHeader("Bearer undefined"))).toBe(false);
    expect(isAuthorizedCronRequest(requestWithAuthHeader("Bearer "))).toBe(false);
    expect(isAuthorizedCronRequest(requestWithAuthHeader(null))).toBe(false);
  });

  it("FAILS CLOSED when CRON_SECRET is an empty string (falsy, same as unset)", () => {
    process.env.CRON_SECRET = "";
    expect(isAuthorizedCronRequest(requestWithAuthHeader("Bearer "))).toBe(false);
  });
});
