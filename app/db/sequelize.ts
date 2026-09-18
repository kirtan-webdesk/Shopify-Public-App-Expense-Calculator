import "~/env.server";
import { Sequelize } from "sequelize";

// --------------------------------------------------------------------------
// The app's own Sequelize connection pool.
//
// ADR-0010 (supersedes ADR-0001's connection-model reasoning, G1.5-revision):
// this app runs on Vercel now — EVERY function instance that boots creates
// its OWN Sequelize pool, on top of PostgreSQLSessionStorage's own separate
// connection (ADR-0007 keeps app SQL out of shopify_sessions, which also
// means it's a second client per instance). A handful of concurrent
// instances at the old pool.max:10 can request more backend connections
// than a small managed Postgres allows — and here, that surfaces as a
// FAILED COMPLIANCE DRAIN, not a failed page load.
//
// pool.max: 1, min: 0, short idle — one in-flight query per instance; the
// pooler (DATABASE_URL must be the provider's POOLED/transaction-mode
// endpoint, e.g. Neon's pooled host or a PgBouncer-class front end — a
// human/deploy-config responsibility, ADR-0010 point 1) does the real
// multiplexing. A per-instance pool larger than 1 buys nothing on an
// execution model that handles one request per instance at a time and
// spends backend connections, the scarce resource, to do it.
//
// ADR-0007: this is the SAME Postgres instance as PostgreSQLSessionStorage,
// not a second database — one dependency doing two jobs.
//
// This module is imported ONLY from app/db/models/* and app/db/repositories/*
// (ADR-0003 — repositories are the sole place Sequelize models are touched).
// Routes and services must never import this file directly.
// --------------------------------------------------------------------------

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error(
    "DATABASE_URL is not set. See .env.example — the same connection " +
      "string is used for the app's own tables and for PostgreSQLSessionStorage. " +
      "In production this MUST be the pooled/transaction-mode endpoint " +
      "(ADR-0010) — migrations use DIRECT_DATABASE_URL instead, see " +
      "db/config/config.cjs.",
  );
}

export const sequelize = new Sequelize(databaseUrl, {
  dialect: "postgres",
  logging: false,
  pool: {
    // ADR-0010 point 2 — deliberately 1, not a "just in case" larger number.
    max: 1,
    min: 0,
    idle: 5_000,
    acquire: 30_000,
  },
  dialectOptions:
    process.env.NODE_ENV === "production"
      ? {
          // VERIFY AT BUILD against the hosting provider's managed Postgres
          // SSL requirements (see db/config/config.cjs for the same note).
          ssl: { require: true, rejectUnauthorized: false },
        }
      : {},
  // ADR-0010 point 4 — transaction-mode pooling does not guarantee the same
  // backend session across statements, so named prepared statements must
  // not be used. VERIFIED (not just asserted) for the installed pg@8.23 /
  // sequelize@6.37 pair by reading node_modules/pg/lib/query.js (only names
  // a prepared statement when the query config explicitly sets `name`) and
  // node_modules/sequelize/lib/dialects/postgres/query.js (never sets one on
  // the pg query config it builds) — neither uses named prepared statements
  // by default, so no dialectOptions flag is needed here to disable
  // something that was never enabled. Re-verify if either dependency's major
  // version changes.
});

export type { Transaction } from "sequelize";
