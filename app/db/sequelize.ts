import "~/env.server";
import { Sequelize } from "sequelize";

// --------------------------------------------------------------------------
// The app's own Sequelize connection pool.
//
// ADR-0001: one long-running process, one Sequelize pool — the default pool
// config is correct here (no PgBouncer transaction-mode workarounds needed;
// those only bite under serverless, which this app deliberately isn't).
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
      "string is used for the app's own tables and for PostgreSQLSessionStorage.",
  );
}

export const sequelize = new Sequelize(databaseUrl, {
  dialect: "postgres",
  logging: false,
  pool: {
    max: 10,
    min: 0,
    idle: 10_000,
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
});

export type { Transaction } from "sequelize";
