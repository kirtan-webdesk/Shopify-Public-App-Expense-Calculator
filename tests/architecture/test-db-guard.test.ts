import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { testDbGuard as guard } from "../helpers/test-database";

// Default-CI unit tests of the test-database isolation guard
// (db/config/test-db-guard.cjs, G4-sprint-3.4). Pure: synthetic URLs and a
// temp dir standing in for the repo root — no database, no real .env.

const PROD = "postgresql://prod_user:S3cretPassw0rd@ep-cool-name-123456.us-east-2.aws.neon.tech/neondb?sslmode=require";
const PROD_POOLED = "postgresql://prod_user:S3cretPassw0rd@ep-cool-name-123456-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require";
const TEST_LOCAL = "postgres://tester:t3stpw@localhost:5432/expense_calculator_test";

const dirs: string[] = [];
function rootWith(files: Record<string, string> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), "wsa-guard-"));
  dirs.push(dir);
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  return dir;
}
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

function refusal(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    return (e as Error).message;
  }
  throw new Error("expected the guard to throw");
}

describe("resolveTestDatabaseUrl", () => {
  it("fails loudly when TEST_DATABASE_URL is unset — and never falls back to DATABASE_URL", () => {
    const msg = refusal(() => guard.resolveTestDatabaseUrl({ DATABASE_URL: PROD, DIRECT_DATABASE_URL: PROD }, rootWith()));
    expect(msg).toMatch(/TEST_DATABASE_URL is not set/);
    expect(msg).toMatch(/never fall back to DATABASE_URL/);
  });

  it("treats an empty TEST_DATABASE_URL as unset", () => {
    expect(refusal(() => guard.resolveTestDatabaseUrl({ TEST_DATABASE_URL: "" }, rootWith()))).toMatch(/not set/);
  });

  it("accepts a separate database (returns the URL untouched)", () => {
    expect(guard.resolveTestDatabaseUrl({ TEST_DATABASE_URL: TEST_LOCAL, DATABASE_URL: PROD }, rootWith())).toBe(TEST_LOCAL);
  });

  it("refuses a TEST url that is not a postgres URL / has no database", () => {
    expect(refusal(() => guard.resolveTestDatabaseUrl({ TEST_DATABASE_URL: "mysql://u:p@h/db" }, rootWith()))).toMatch(/not a valid postgres/);
    expect(refusal(() => guard.resolveTestDatabaseUrl({ TEST_DATABASE_URL: "postgres://u:p@localhost:5432/" }, rootWith()))).toMatch(/not a valid postgres/);
    expect(refusal(() => guard.resolveTestDatabaseUrl({ TEST_DATABASE_URL: "not a url" }, rootWith()))).toMatch(/not a valid postgres/);
  });
});

describe("guard refuses the same host + database as a protected URL", () => {
  it("same URL as DATABASE_URL", () => {
    expect(refusal(() => guard.resolveTestDatabaseUrl({ TEST_DATABASE_URL: PROD, DATABASE_URL: PROD }, rootWith()))).toMatch(
      /REFUSING TO RUN.*environment variable DATABASE_URL/s,
    );
  });

  it("same as DIRECT_DATABASE_URL, and pooled-vs-direct endpoints of one Neon compute compare equal", () => {
    expect(
      refusal(() => guard.resolveTestDatabaseUrl({ TEST_DATABASE_URL: PROD_POOLED, DIRECT_DATABASE_URL: PROD }, rootWith())),
    ).toMatch(/DIRECT_DATABASE_URL/);
  });

  it("differing only in credentials / query string / port is still the same database", () => {
    const sameDbOtherCreds = "postgresql://someone_else:x@ep-cool-name-123456.us-east-2.aws.neon.tech:6543/neondb";
    expect(refusal(() => guard.resolveTestDatabaseUrl({ TEST_DATABASE_URL: sameDbOtherCreds, DATABASE_URL: PROD }, rootWith()))).toMatch(/REFUSING/);
  });

  it("localhost aliases collapse (127.0.0.1 == localhost)", () => {
    expect(
      refusal(() =>
        guard.resolveTestDatabaseUrl(
          { TEST_DATABASE_URL: "postgres://a:b@127.0.0.1:5432/appdb", DATABASE_URL: "postgres://c:d@localhost/appdb" },
          rootWith(),
        ),
      ),
    ).toMatch(/REFUSING/);
  });

  it("same host but a DIFFERENT database name is allowed (e.g. local expense_calculator vs expense_calculator_test)", () => {
    expect(
      guard.resolveTestDatabaseUrl(
        { TEST_DATABASE_URL: TEST_LOCAL, DATABASE_URL: "postgres://c:d@localhost:5432/expense_calculator" },
        rootWith(),
      ),
    ).toBe(TEST_LOCAL);
  });

  it("a different Neon endpoint (a branch) with the same database name is allowed", () => {
    const branch = "postgresql://prod_user:pw@ep-other-branch-999999.us-east-2.aws.neon.tech/neondb?sslmode=require";
    expect(guard.resolveTestDatabaseUrl({ TEST_DATABASE_URL: branch, DATABASE_URL: PROD }, rootWith())).toBe(branch);
  });

  it("any postgres URL in .env — live, staging or COMMENTED OUT — is protected", () => {
    const env = [
      "# some comment",
      "#  Staging URL",
      "# DATABASE_URL=postgres://postgres:pw@localhost:5432/expense_calculator",
      "DATABASE_URL=" + PROD,
      "",
    ].join("\n");
    const root = rootWith({ ".env": env });
    const commented = refusal(() =>
      guard.resolveTestDatabaseUrl({ TEST_DATABASE_URL: "postgres://x:y@localhost:5432/expense_calculator" }, root),
    );
    expect(commented).toMatch(/\.env line 3 \(DATABASE_URL, commented out\)/);
    expect(refusal(() => guard.resolveTestDatabaseUrl({ TEST_DATABASE_URL: PROD }, root))).toMatch(/\.env line 4 \(DATABASE_URL\)/);
    // ...while a distinct test DB on the same local server is fine.
    expect(guard.resolveTestDatabaseUrl({ TEST_DATABASE_URL: TEST_LOCAL }, root)).toBe(TEST_LOCAL);
  });

  it("other .env.* files count (but .env.example does not), and TEST_DATABASE_URL lines inside .env are the test one, not protected", () => {
    const root = rootWith({
      ".env.local": "OTHER_DB_URL=postgres://u:p@db.internal.example/customers\n",
      ".env.example": "DATABASE_URL=postgres://postgres:postgres@localhost:5432/expense_calculator_dev\n",
      ".env": "TEST_DATABASE_URL=" + TEST_LOCAL + "\n",
    });
    expect(refusal(() => guard.resolveTestDatabaseUrl({ TEST_DATABASE_URL: "postgres://z:z@db.internal.example/customers" }, root))).toMatch(
      /\.env\.local line 1 \(OTHER_DB_URL\)/,
    );
    expect(
      guard.resolveTestDatabaseUrl({ TEST_DATABASE_URL: "postgres://z:z@localhost:5432/expense_calculator_dev" }, root),
    ).toBeTruthy(); // .env.example is documentation, not a live database
    expect(guard.resolveTestDatabaseUrl({ TEST_DATABASE_URL: TEST_LOCAL }, root)).toBe(TEST_LOCAL);
  });

  it("any process.env variable holding a postgres URL is protected (e.g. a Vercel-pulled POSTGRES_URL)", () => {
    expect(
      refusal(() => guard.resolveTestDatabaseUrl({ TEST_DATABASE_URL: PROD, POSTGRES_URL: PROD }, rootWith())),
    ).toMatch(/environment variable POSTGRES_URL/);
  });
});

describe("guard output is masked — no URL, user, password or full host ever appears", () => {
  it("refusal message contains none of the secrets", () => {
    const msg = refusal(() => guard.resolveTestDatabaseUrl({ TEST_DATABASE_URL: PROD, DATABASE_URL: PROD }, rootWith()));
    for (const secret of ["prod_user", "S3cretPassw0rd", "ep-cool-name-123456", "neon.tech", "neondb", "postgresql://", "sslmode"]) {
      expect(msg, `message leaked ${secret}`).not.toContain(secret);
    }
    expect(msg).toMatch(/host .{2}\*\*\*\(\d+\) \/ db .{2}\*\*\*\(\d+\)/);
  });

  it("describeMasked never returns a full value", () => {
    const t = guard.parseTarget(PROD)!;
    const masked = guard.describeMasked(t);
    expect(masked).not.toContain("neon");
    expect(masked).not.toContain(t.database);
  });
});
