// Sequelize CLI database config.
//
// ADR-0010 point 5 (supersedes the single-DATABASE_URL note this file used
// to carry under ADR-0001): migrations connect to the DIRECT (unpooled)
// endpoint, never the transaction-mode pooler the running app uses (DDL,
// advisory locks and sequelize-cli's own meta table want a stable session
// that a transaction-mode pooler does not guarantee). Two connection
// strings: DATABASE_URL (pooled, runtime — app/db/sequelize.ts) and
// DIRECT_DATABASE_URL (unpooled, migrations only — this file).
"use strict";

// MUST stay above dotenv: the guard snapshots ALLOW_HOSTED_DB from the real
// shell environment at load time, so a value in .env cannot grant it.
const migrateGuard = require("./migrate-guard.cjs");

require("dotenv/config");

const DEFAULT_DEV_URL =
  "postgres://postgres:postgres@localhost:5432/expense_calculator_dev";

function fromEnv(envVar, fallback) {
  const url = process.env[envVar] || fallback;
  if (!url) {
    throw new Error(
      `${envVar} is not set. Copy .env.example to .env and set it ` +
        "before running migrations.",
    );
  }
  return url;
}

/**
 * Migrations prefer DIRECT_DATABASE_URL (ADR-0010 point 5). Falls back to
 * DATABASE_URL with a loud warning if DIRECT_DATABASE_URL isn't set — this
 * keeps a single-Postgres local dev setup (no separate pooled/direct
 * endpoints, e.g. a bare `postgres://…@localhost` with no pooler in front of
 * it at all) working without a second env var, while making it impossible to
 * silently run production migrations through the pooler by omission.
 */
let warnedDirectFallback = false;

function migrationUrl(envName) {
  if (process.env.DIRECT_DATABASE_URL) {
    return process.env.DIRECT_DATABASE_URL;
  }
  if (envName === "production") {
    throw new Error(
      "DIRECT_DATABASE_URL is not set. Production migrations must use the " +
        "unpooled/direct Postgres endpoint (ADR-0010 point 5) — the pooled " +
        "DATABASE_URL is not a safe fallback here, unlike in development.",
    );
  }
  if (!warnedDirectFallback) {
    warnedDirectFallback = true; // the guard and sequelize-cli both read this getter
    console.warn(
      `[db/config] DIRECT_DATABASE_URL not set for ${envName} — falling back ` +
        "to DATABASE_URL for this migration run. Fine for a local dev DB with " +
        "no pooler in front of it; set DIRECT_DATABASE_URL once one exists " +
        "(ADR-0010 point 5).",
    );
  }
  return fromEnv("DATABASE_URL", DEFAULT_DEV_URL);
}

const common = {
  dialect: "postgres",
  logging: false,
};

// Per-environment values are LAZY (getters): sequelize-cli reads only
// `config[<--env>]`, so `--env test` needs only TEST_DATABASE_URL,
// `--env development` only DATABASE_URL/DIRECT_DATABASE_URL, and
// `--env production` only DIRECT_DATABASE_URL. (Previously all three blocks
// were evaluated eagerly at require time, so a missing var for ONE env threw
// even when migrating another.)
//
// The `test` env reads TEST_DATABASE_URL ONLY — it never falls back to
// DIRECT_DATABASE_URL / DATABASE_URL (which may be production) — and refuses
// a URL whose host + database match any non-test URL (db/config/
// test-db-guard.cjs, G4-sprint-3.4).
const { resolveTestDatabaseUrl } = require("./test-db-guard.cjs");
const path = require("path");

module.exports = {
  get development() {
    return {
      ...common,
      url: migrationUrl("development"),
    };
  },
  get test() {
    const url = resolveTestDatabaseUrl(process.env, path.resolve(__dirname, "..", ".."));
    return {
      ...common,
      url,
      // TLS is decided by the TEST url alone, never by an ambient PGSSLMODE
      // (dotenv loads .env's PGSSLMODE, which is meant for the hosted DB and
      // would make a local test Postgres refuse the connection). A managed
      // test branch (e.g. Neon) carries ?sslmode=require and needs TLS;
      // sequelize-cli does not derive it from ?sslmode= itself.
      dialectOptions: {
        ssl: /[?&]sslmode=(require|verify-ca|verify-full)\b/i.test(url)
          ? { require: true, rejectUnauthorized: false }
          : false,
      },
    };
  },
  get production() {
    return {
      ...common,
      url: migrationUrl("production"),
      dialectOptions: {
        // VERIFY AT BUILD: the hosting provider's managed Postgres SSL
        // requirements (ADR-0010's companion note to ADR-0001's original one).
        // Most managed providers require SSL with a non-self-signed-friendly
        // CA chain; rejectUnauthorized:false is a common but
        // security-relaxing default — confirm the provider's documented
        // setting before shipping to production rather than carrying this
        // placeholder.
        ssl: { require: true, rejectUnauthorized: false },
      },
    };
  },
};

// Defence in depth (G4-sprint-3.6): .sequelizerc already runs the explicit-env
// guard before sequelize-cli parses a command; this covers any path that loads
// this config without going through .sequelizerc. Memoised and inert unless
// the process is a `sequelize-cli db:*` command (db/config/migrate-guard.cjs).
migrateGuard.enforceForCli({ resolveUrl: (envName) => module.exports[envName].url });
