import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

// Default-CI guard for G4-sprint-3.4 Part B: the opt-in DB suites can NEVER
// touch production. Static (no DB):
//   1. no tests/**/*.db.test.ts or helper references DATABASE_URL /
//      DIRECT_DATABASE_URL (or a POSTGRES_URL* variable) for connecting — the
//      only exception is tests/helpers/test-database.ts, and only to ASSIGN
//      the process-local variable the app singleton reads (pointing it at the
//      TEST database);
//   2. every *.db.test.ts wires the guard (setupTestDatabase) and opens no
//      connection of its own;
//   3. db/config/config.cjs's `test` env reads TEST_DATABASE_URL only (via the
//      guard) and its per-environment blocks are lazy;
// and behaviourally (child node processes with a controlled environment).

const ROOT = process.cwd();
const TESTS_DIR = join(ROOT, "tests");
const HELPER = join("tests", "helpers", "test-database.ts");
const SELF_EXEMPT = new Set([
  // These describe the rule with literal variable names in strings/regexes.
  join("tests", "architecture", "test-db-isolation.test.ts"),
  join("tests", "architecture", "test-db-guard.test.ts"),
]);

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const full = join(dir, e);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

/** Drops // line comments and block comments (not `://` inside strings/URLs). */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:\w"'`])\/\/.*$/gm, "$1");
}

// `\b` after `_` fails, so TEST_DATABASE_URL is NOT matched — only the bare
// and DIRECT_ forms (the production connection strings) and Vercel-style names.
const PROD_URL_REF = /\b(?:DIRECT_)?DATABASE_URL\b|\bPOSTGRES_URL\w*\b|\bPOSTGRES_PRISMA_URL\b/g;

const allTestFiles = walk(TESTS_DIR)
  .map((f) => relative(ROOT, f))
  .filter((f) => /\.(ts|tsx|cjs|js|mjs)$/.test(f));
const dbSuites = allTestFiles.filter((f) => f.endsWith(".db.test.ts"));
const helperFiles = allTestFiles.filter((f) => f.startsWith(join("tests", "helpers") + "\\") || f.startsWith("tests/helpers/"));

describe("test-DB isolation: nothing under tests/ reads a production connection string", () => {
  it("finds the DB suites and helpers it is meant to police", () => {
    expect(dbSuites.length).toBeGreaterThanOrEqual(3);
    expect(dbSuites.map((f) => f.replace(/\\/g, "/"))).toEqual(
      expect.arrayContaining([
        "tests/db/calculation-history.db.test.ts",
        "tests/db/shop-ensure.db.test.ts",
        "tests/db/expense-rule-seed-race.db.test.ts",
      ]),
    );
    expect(helperFiles.length).toBeGreaterThanOrEqual(2);
  });

  const policed = [...new Set([...dbSuites, ...helperFiles])].filter((f) => f !== HELPER && !SELF_EXEMPT.has(f));
  it.each(policed)("%s does not reference DATABASE_URL / DIRECT_DATABASE_URL / POSTGRES_URL* (code, comments stripped)", (file) => {
    const code = stripComments(readFileSync(join(ROOT, file), "utf8"));
    const hits = [...code.matchAll(PROD_URL_REF)].map((m) => m[0]);
    expect(hits, `${file} must read TEST_DATABASE_URL only, via tests/helpers/test-database.ts`).toEqual([]);
  });

  it("the helper only ASSIGNS DATABASE_URL / DIRECT_DATABASE_URL (redirecting the app at the test DB) — never reads them", () => {
    const code = stripComments(readFileSync(join(ROOT, HELPER), "utf8"));
    const refs = [...code.matchAll(/process\.env\.((?:DIRECT_)?DATABASE_URL)\b(\s*=(?!=))?/g)];
    expect(refs.length).toBeGreaterThan(0);
    // The one legitimate READ is the idempotency comparison against the test
    // URL it already installed; everything else must be an assignment.
    const reads = refs.filter((m) => !m[2]).map((m) => m[0]);
    expect(reads).toEqual(["process.env.DATABASE_URL"]);
    expect(code).toMatch(/process\.env\.DATABASE_URL === url\)/);
    // Any other spelling of those names (bracket access, destructuring, strings) is forbidden.
    const all = [...code.matchAll(PROD_URL_REF)].length;
    expect(all).toBe(refs.length);
  });

  it("the helper resolves the URL through the guard and from TEST_DATABASE_URL only", () => {
    const code = stripComments(readFileSync(join(ROOT, HELPER), "utf8"));
    expect(code).toMatch(/process\.env\.TEST_DATABASE_URL/);
    expect(code).toMatch(/guard\.resolveTestDatabaseUrl\(/);
    expect(code).toMatch(/current_database\(\)/);
  });

  it.each(dbSuites)("%s wires the guard and opens no connection of its own", (file) => {
    const code = stripComments(readFileSync(join(ROOT, file), "utf8"));
    expect(code).toMatch(/from "\.\.\/helpers\/test-database"/);
    expect(code).toMatch(/\bsetupTestDatabase\(\)/);
    expect(code).toMatch(/\bassertConnectedToTestDatabase\(/);
    expect(code, "a DB suite must use the app's own (redirected) sequelize singleton").not.toMatch(/new Sequelize\(/);
    expect(code).not.toMatch(/from ["']pg["']/);
    expect(code).not.toMatch(/process\.env\.RUN_DB_TESTS/); // gating goes through setupTestDatabase()
  });
});

describe("db/config/config.cjs — the test env is TEST_DATABASE_URL only, and per-env values are lazy", () => {
  const cfg = readFileSync(join(ROOT, "db", "config", "config.cjs"), "utf8");
  const testBlock = /get test\(\)[\s\S]*?\n {2}\},\n/.exec(cfg)?.[0] ?? "";

  it("has a `test` getter block", () => {
    expect(testBlock.length).toBeGreaterThan(0);
  });

  it("the test block never references DATABASE_URL / DIRECT_DATABASE_URL", () => {
    expect(stripComments(testBlock).match(PROD_URL_REF) ?? []).toEqual([]);
    expect(testBlock).toMatch(/resolveTestDatabaseUrl\(/);
  });

  it("the module does not fall back to DATABASE_URL for the test env anywhere in an `||` chain", () => {
    expect(cfg).not.toMatch(/TEST_DATABASE_URL\s*\|\|\s*process\.env\.DATABASE_URL/);
    expect(cfg).not.toMatch(/process\.env\.DATABASE_URL\s*\|\|\s*process\.env\.TEST_DATABASE_URL/);
    expect(cfg).not.toMatch(/DIRECT_DATABASE_URL\s*\|\|\s*process\.env\.TEST_DATABASE_URL/);
  });

  it("all three env blocks are getters (lazy), not eagerly evaluated", () => {
    for (const env of ["development", "test", "production"]) {
      expect(cfg, `${env} must be a lazy getter`).toMatch(new RegExp(`\\bget ${env}\\(\\)`));
    }
  });

  // --- behavioural: real config.cjs in a child node with a controlled env ---
  const tmp = mkdtempSync(join(tmpdir(), "wsa-cfg-")); // cwd without a .env, so dotenv injects nothing
  afterAll(() => rmSync(tmp, { recursive: true, force: true }));

  const PROD = "postgresql://prod_user:S3cretPassw0rd@ep-cool-name-123456.us-east-2.aws.neon.tech/neondb?sslmode=require";
  const TEST = "postgres://tester:t3stpw@test-db.invalid:5432/expense_calculator_test";

  function load(env: Record<string, string>, expr: string): { ok: boolean; out: string } {
    const script =
      `const c=require(${JSON.stringify(join(ROOT, "db", "config", "config.cjs"))});` +
      `let r;try{r={ok:true,out:String(${expr})}}catch(e){r={ok:false,out:e.message}}process.stdout.write(JSON.stringify(r))`;
    const stdout = execFileSync(process.execPath, ["-e", script], {
      cwd: tmp,
      env: { PATH: process.env.PATH ?? "", SystemRoot: process.env.SystemRoot ?? "", ...env },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return JSON.parse(stdout.slice(stdout.lastIndexOf("{\"ok\""))) as { ok: boolean; out: string };
  }

  it("requiring the module never throws, whatever is unset (nothing is evaluated eagerly)", () => {
    const r = load({}, "typeof c");
    expect(r).toEqual({ ok: true, out: "object" });
  });

  it("--env test needs ONLY TEST_DATABASE_URL (no DATABASE_URL / DIRECT_DATABASE_URL required)", () => {
    const r = load({ TEST_DATABASE_URL: TEST }, "c.test.url");
    expect(r).toEqual({ ok: true, out: TEST });
  });

  it("--env test with TEST_DATABASE_URL unset FAILS LOUDLY and never falls back to DATABASE_URL / DIRECT_DATABASE_URL", () => {
    const r = load({ DATABASE_URL: PROD, DIRECT_DATABASE_URL: PROD }, "c.test.url");
    expect(r.ok).toBe(false);
    expect(r.out).toMatch(/TEST_DATABASE_URL is not set/);
    expect(r.out).not.toContain("S3cretPassw0rd");
  });

  it("--env test refuses a TEST_DATABASE_URL equal to DATABASE_URL (masked message)", () => {
    const r = load({ DATABASE_URL: PROD, TEST_DATABASE_URL: PROD }, "c.test.url");
    expect(r.ok).toBe(false);
    expect(r.out).toMatch(/REFUSING TO RUN/);
    for (const secret of ["prod_user", "S3cretPassw0rd", "ep-cool-name-123456", "neon.tech"]) expect(r.out).not.toContain(secret);
  });

  it("--env development needs only DATABASE_URL; --env production needs only DIRECT_DATABASE_URL (the known eager-evaluation P3 bug)", () => {
    expect(load({ DATABASE_URL: TEST }, "c.development.url").out).toBe(TEST);
    const prod = load({ DIRECT_DATABASE_URL: PROD }, "c.production.url");
    expect(prod).toEqual({ ok: true, out: PROD });
    // ...and an unset var for ONE env throws only when THAT env is asked for.
    const noDirect = load({ DATABASE_URL: TEST }, "c.production.url");
    expect(noDirect.ok).toBe(false);
    expect(noDirect.out).toMatch(/DIRECT_DATABASE_URL is not set/);
    expect(load({ DATABASE_URL: TEST }, "c.development.url").ok).toBe(true);
  });

  it("TLS for the test env comes from the test URL alone (not an ambient PGSSLMODE)", () => {
    expect(load({ TEST_DATABASE_URL: TEST, PGSSLMODE: "require" }, "JSON.stringify(c.test.dialectOptions)").out).toBe('{"ssl":false}');
    const tls = load(
      { TEST_DATABASE_URL: "postgresql://u:p@branch-host.invalid/neondb?sslmode=require" },
      "JSON.stringify(c.test.dialectOptions.ssl)",
    );
    expect(JSON.parse(tls.out)).toEqual({ require: true, rejectUnauthorized: false });
  });
});
