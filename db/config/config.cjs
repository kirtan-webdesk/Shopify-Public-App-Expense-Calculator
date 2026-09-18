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
  console.warn(
    `[db/config] DIRECT_DATABASE_URL not set for ${envName} — falling back ` +
      "to DATABASE_URL for this migration run. Fine for a local dev DB with " +
      "no pooler in front of it; set DIRECT_DATABASE_URL once one exists " +
      "(ADR-0010 point 5).",
  );
  return fromEnv("DATABASE_URL", DEFAULT_DEV_URL);
}

const common = {
  dialect: "postgres",
  logging: false,
};

module.exports = {
  development: {
    ...common,
    url: migrationUrl("development"),
  },
  test: {
    ...common,
    url: process.env.DIRECT_DATABASE_URL || process.env.TEST_DATABASE_URL || process.env.DATABASE_URL,
  },
  production: {
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
  },
};
