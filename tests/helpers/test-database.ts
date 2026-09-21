import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { join } from "node:path";
import { QueryTypes, type Sequelize } from "sequelize";

// --------------------------------------------------------------------------
// Test-database isolation for the opt-in DB suites (G4-sprint-3.4, P3 fix).
//
// RULE: DB suites can NEVER touch production. They read TEST_DATABASE_URL
// ONLY — never DATABASE_URL — and refuse to run if it points at the same
// host + database as any non-test URL (process env or .env* files). The
// guard itself lives in db/config/test-db-guard.cjs so that
// `sequelize-cli db:migrate --env test` (db/config/config.cjs) enforces the
// exact same rule.
//
// This file is the ONLY place under tests/ that may mention the bare
// connection-string variable name, and only to ASSIGN it: the app's Sequelize
// singleton (app/db/sequelize.ts) reads it at module load, so the helper
// points that process-local variable at the TEST database before any app
// module is imported. tests/architecture/test-db-isolation.test.ts (default
// CI) enforces that nothing else under tests/ reads it for connecting.
//
// All error output is masked: no URL, user, password or full host is ever
// printed.
// --------------------------------------------------------------------------

interface GuardApi {
  parseTarget(url: string): { host: string; database: string } | null;
  sameTarget(a: unknown, b: unknown): boolean;
  describeMasked(t: { host: string; database: string } | null): string;
  resolveTestDatabaseUrl(env: NodeJS.ProcessEnv, root: string): string;
}

const ROOT = process.cwd(); // vitest runs from the repo root (same convention as tests/architecture/*)
const require = createRequire(join(ROOT, "package.json"));
const guard = require(join(ROOT, "db", "config", "test-db-guard.cjs")) as GuardApi;

const INSTALLED_MARKER = "WSA_TEST_DB_INSTALLED";

function fingerprint(url: string): string {
  return createHash("sha256").update(url).digest("hex").slice(0, 16);
}

/**
 * Call ONCE at the top level of every DB suite (before any dynamic import of
 * app modules). Returns whether the DB suite is enabled (RUN_DB_TESTS=1).
 *
 * When enabled: resolves TEST_DATABASE_URL (throws loudly if unset), runs the
 * host+database guard against every non-test URL, then points the app's
 * process-local connection variables at the TEST database — so nothing in
 * this test process can reach any other database — and pins TLS from the
 * test URL rather than any ambient PGSSLMODE.
 */
export function setupTestDatabase(): boolean {
  if (process.env.RUN_DB_TESTS !== "1") return false;

  const url = process.env.TEST_DATABASE_URL;
  // Idempotent within a process: a previous suite file already guarded this
  // exact URL and redirected the app variables at it (re-running the guard
  // would now, correctly, see the redirected variable as "the test DB").
  if (url && process.env[INSTALLED_MARKER] === fingerprint(url) && process.env.DATABASE_URL === url) return true;

  // Must run against the PRISTINE environment (before any redirection below).
  const resolved = guard.resolveTestDatabaseUrl(process.env, ROOT);

  process.env.DATABASE_URL = resolved;
  process.env.DIRECT_DATABASE_URL = resolved;
  process.env.PGSSLMODE = /[?&]sslmode=(require|verify-ca|verify-full)\b/i.test(resolved) ? "require" : "disable";
  process.env[INSTALLED_MARKER] = fingerprint(resolved);
  return true;
}

/**
 * Belt and braces: after the app's Sequelize instance exists, prove it is
 * actually connected to the TEST database (host + database name from its
 * resolved config, then `current_database()` from the server). Throws with a
 * masked message otherwise. Call from beforeAll of every DB suite.
 */
export async function assertConnectedToTestDatabase(sequelize: Sequelize): Promise<void> {
  const wanted = guard.parseTarget(process.env.TEST_DATABASE_URL ?? "");
  if (!wanted) throw new Error("TEST_DATABASE_URL is missing or invalid at connection-verification time.");
  const cfg = sequelize.config as { host?: string; database?: string };
  const actual = guard.parseTarget(`postgres://${cfg.host ?? ""}/${cfg.database ?? ""}`);
  if (!guard.sameTarget(wanted, actual)) {
    throw new Error(
      `REFUSING TO RUN: the app's Sequelize instance is configured for ${guard.describeMasked(actual)}, ` +
        `not the test database (${guard.describeMasked(wanted)}).`,
    );
  }
  const rows = await sequelize.query<{ db: string }>("SELECT current_database() AS db", { type: QueryTypes.SELECT });
  if (rows[0]?.db !== wanted.database) {
    throw new Error(
      `REFUSING TO RUN: the server reports a different current_database() (${guard.describeMasked({ host: "-", database: String(rows[0]?.db) })}) than the test database.`,
    );
  }
}

/** Test seam: the pure guard functions, for tests/architecture/test-db-isolation.test.ts. */
export const testDbGuard: GuardApi = guard;
