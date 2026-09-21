// Test-database isolation guard (G4-sprint-3.4, P3 fix).
//
// WHY: the opt-in DB suites (tests/db/*.db.test.ts, RUN_DB_TESTS=1) and
// `sequelize-cli db:migrate --env test` used to fall back to DATABASE_URL —
// the PRODUCTION Neon database that also holds the real store. The rule now
// is: those paths read TEST_DATABASE_URL ONLY, and REFUSE to run if it points
// at the same host + database as any non-test connection string the process
// or the repo's .env* files know about.
//
// Shared (plain CommonJS, no dependencies) so that db/config/config.cjs and
// the vitest helpers (tests/helpers/test-database.ts) enforce the SAME rule.
//
// Secrets: nothing in this file ever puts a URL, user, password, or full host
// into an error message or log line. Only env-var NAMES / .env line numbers
// and a masked host fingerprint are shown.
"use strict";

const fs = require("fs");
const path = require("path");
const { URL } = require("url");

const TEST_VAR = "TEST_DATABASE_URL";
const POSTGRES_URL = /^postgres(?:ql)?:\/\//i;

/** Masks a string: keeps at most the first 2 characters. Never the whole thing. */
function mask(value) {
  const s = String(value || "");
  if (s.length <= 2) return "***";
  return `${s.slice(0, 2)}***(${s.length})`;
}

/**
 * Parses a postgres URL to a comparable { host, database } target, or null
 * when it is not a parseable postgres URL. Normalisation is deliberately
 * strict (i.e. errs towards "these are the same database"):
 *  - host lower-cased; localhost / 127.0.0.1 / ::1 collapse to "localhost"
 *  - a Neon-style "-pooler" suffix on the first host label is dropped, so the
 *    pooled and direct endpoints of one compute compare equal
 *  - the port is IGNORED (same host + db name on another port is still refused)
 *  - the database name is percent-decoded
 */
function parseTarget(url) {
  if (typeof url !== "string" || !POSTGRES_URL.test(url.trim())) return null;
  let u;
  try {
    u = new URL(url.trim());
  } catch {
    return null;
  }
  let host = (u.hostname || "").toLowerCase().replace(/^\[|\]$/g, "");
  if (!host) return null;
  if (host === "127.0.0.1" || host === "::1" || host === "0.0.0.0") host = "localhost";
  const labels = host.split(".");
  labels[0] = labels[0].replace(/-pooler$/, "");
  host = labels.join(".");
  let database;
  try {
    database = decodeURIComponent(u.pathname.replace(/^\//, ""));
  } catch {
    database = u.pathname.replace(/^\//, "");
  }
  if (!database) return null;
  return { host, database };
}

function sameTarget(a, b) {
  return !!a && !!b && a.host === b.host && a.database === b.database;
}

/** "he***(23) / ne***(6)" — a masked fingerprint safe to print. */
function describeMasked(target) {
  if (!target) return "<unparseable>";
  return `host ${mask(target.host)} / db ${mask(target.database)}`;
}

function listEnvFiles(root) {
  let names = [];
  try {
    names = fs.readdirSync(root);
  } catch {
    return [];
  }
  return names
    .filter((n) => n === ".env" || (n.startsWith(".env.") && n !== ".env.example"))
    .sort();
}

/**
 * Every non-test postgres connection string this process/repo knows about:
 *  - every process.env value that is a postgres URL (except TEST_DATABASE_URL)
 *  - every postgres URL in .env / .env.* (except .env.example) — INCLUDING
 *    commented-out lines (a commented staging/live URL is still a real
 *    database someone could point a test at) — except TEST_DATABASE_URL lines.
 * Returns [{ source, target }] where `source` is a human-readable, secret-free
 * label (variable name / file:line).
 */
function collectProtectedTargets(env, root) {
  const out = [];
  for (const [key, value] of Object.entries(env || {})) {
    if (key === TEST_VAR) continue;
    const t = parseTarget(value);
    if (t) out.push({ source: `environment variable ${key}`, target: t });
  }
  for (const file of listEnvFiles(root)) {
    let text = "";
    try {
      text = fs.readFileSync(path.join(root, file), "utf8");
    } catch {
      continue;
    }
    text.split(/\r?\n/).forEach((line, i) => {
      const m = /^\s*(?:#\s*)?(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*["']?(postgres(?:ql)?:\/\/[^\s"']+)/i.exec(line);
      if (!m || m[1] === TEST_VAR) return;
      const t = parseTarget(m[2]);
      if (t) out.push({ source: `${file} line ${i + 1} (${m[1]}${/^\s*#/.test(line) ? ", commented out" : ""})`, target: t });
    });
  }
  return out;
}

/**
 * Throws (masked message) unless `testUrl` is a parseable postgres URL whose
 * host + database differ from EVERY protected target. Returns the parsed
 * target on success.
 */
function assertSafeTestUrl(testUrl, env, root) {
  const target = parseTarget(testUrl);
  if (!target) {
    throw new Error(`${TEST_VAR} is set but is not a valid postgres:// or postgresql:// URL with a database name.`);
  }
  for (const p of collectProtectedTargets(env, root)) {
    if (sameTarget(target, p.target)) {
      throw new Error(
        `REFUSING TO RUN: ${TEST_VAR} points at the same host + database as ${p.source} ` +
          `(${describeMasked(target)}). DB tests and test migrations must use a separate ` +
          "database or branch — never production, staging or dev data. " +
          "See tests/README.md.",
      );
    }
  }
  return target;
}

/**
 * The single entry point: reads TEST_DATABASE_URL ONLY (never DATABASE_URL),
 * fails loudly when it is unset, applies the guard, and returns the URL.
 */
function resolveTestDatabaseUrl(env, root) {
  const url = env && env[TEST_VAR];
  if (!url) {
    throw new Error(
      `${TEST_VAR} is not set. The DB test suites and \`--env test\` migrations read ${TEST_VAR} ONLY ` +
        "and never fall back to DATABASE_URL (which may be the production database). Create a separate " +
        "test database/branch and set it — see tests/README.md and .env.example.",
    );
  }
  assertSafeTestUrl(url, env, root);
  return url;
}

module.exports = {
  TEST_VAR,
  parseTarget,
  sameTarget,
  describeMasked,
  collectProtectedTargets,
  assertSafeTestUrl,
  resolveTestDatabaseUrl,
};
