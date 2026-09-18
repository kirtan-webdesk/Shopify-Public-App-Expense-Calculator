// Loads .env into process.env for LOCAL DEV ONLY. In production, the
// hosting platform injects real environment variables directly
// (ADR-0001 requirement #5); dotenv silently no-ops if no .env file exists,
// which is the expected production state (.env is gitignored — see
// .env.example).
//
// Imported (for its side effect only) as the FIRST statement in every
// server module that reads process.env at module-evaluation time
// (app/shopify.server.ts, app/db/sequelize.ts, db/config/config.cjs's own
// require("dotenv/config")) — each such module guarantees its own
// prerequisite rather than relying on overall bundle import ordering.
import "dotenv/config";

export {};
