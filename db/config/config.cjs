// Sequelize CLI database config. Deliberately reads a single DATABASE_URL
// (same variable app/db/sequelize.ts uses) rather than maintaining a second,
// divergent set of host/user/password fields — one source of truth for the
// connection string, per ADR-0001 (same-region managed Postgres, one pool).
"use strict";

require("dotenv/config");

const DEFAULT_DEV_URL =
  "postgres://postgres:postgres@localhost:5432/expense_calculator_dev";

function fromEnv(envVar, fallback) {
  const url = process.env[envVar] || fallback;
  if (!url) {
    throw new Error(
      `${envVar} is not set. Copy .env.example to .env and set DATABASE_URL ` +
        "(or the environment-specific override) before running migrations.",
    );
  }
  return url;
}

const common = {
  dialect: "postgres",
  logging: false,
};

module.exports = {
  development: {
    ...common,
    url: fromEnv("DATABASE_URL", DEFAULT_DEV_URL),
  },
  test: {
    ...common,
    url: fromEnv("TEST_DATABASE_URL", process.env.DATABASE_URL),
  },
  production: {
    ...common,
    url: fromEnv("DATABASE_URL"),
    dialectOptions: {
      // VERIFY AT BUILD: the hosting provider's managed Postgres SSL
      // requirements (ADR-0001 §"Recommended shortlist"). Most managed
      // providers require SSL with a non-self-signed-friendly CA chain;
      // rejectUnauthorized:false is a common but security-relaxing
      // default — confirm the provider's documented setting before
      // shipping to production rather than carrying this placeholder.
      ssl: { require: true, rejectUnauthorized: false },
    },
  },
};
