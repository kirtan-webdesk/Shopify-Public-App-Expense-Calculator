// Explicit-environment guard for every `sequelize-cli db:*` command
// (G4-sprint-3.6).
//
// WHY: a bare `npm run db:migrate` / `npx sequelize-cli db:migrate` defaults
// to the `development` env, whose URL falls back to DATABASE_URL — which on
// the maintainer's machine points at the HOSTED (Neon) database that also
// holds the real store. One careless command migrated (or undid) production
// data. This module makes that impossible by ACCIDENT:
//
//  1. Every db:* command must carry an explicit `--env <name>` on the command
//     line (development | test | production). Nothing implicit is accepted:
//     not the sequelize-cli default, not NODE_ENV, not an env var, not an
//     `--env` that only appears after a bare `--`.
//  2. `--url`, `--config` and `--options-path` are refused for db:* commands:
//     they would point sequelize-cli at a target this guard cannot inspect.
//  3. If the resolved target host is not local (localhost / 127.0.0.1 / ::1),
//     `--env development` and `--env test` are refused unless the operator sets
//     ALLOW_HOSTED_DB=1 for that one command. (`--env production` is the
//     intended hosted target and needs only the explicit `--env production`.)
//     sequelize-cli runs yargs in .strict() mode, so an extra `--allow-hosted`
//     flag cannot be used; the acknowledgement is an environment variable read
//     at module load — BEFORE dotenv runs — so a value in .env cannot
//     silently grant it.
//  4. One masked line is printed before anything connects:
//       Migrating env=<env> host=<masked host> db=<name>
//
// It runs from `.sequelizerc` (which sequelize-cli loads before it parses a
// command, so it fires whether or not the npm script was used) and,
// defensively, from the bottom of db/config/config.cjs. The `--env test`
// isolation guard (test-db-guard.cjs) is untouched and still runs when the
// `test` config getter is read.
//
// Secrets: no URL, user, password or full host is ever printed. Diagnostics
// carry env names, a partially masked host, and the database name only.
//
// DB_GUARD_CHECK_ONLY=1: run every check, print the confirmation line, then
// exit 0 WITHOUT connecting. Lets a human (and the default-CI tests) verify
// where a command WOULD point.
"use strict";

// Snapshot BEFORE anything can load dotenv (config.cjs requires this module
// first, then dotenv) — the acknowledgement must come from the real shell
// environment, never from a .env file.
const ACK_AT_LOAD = process.env.ALLOW_HOSTED_DB;

const fs = require("fs");
const { URL } = require("url");

const ENVS = ["development", "test", "production"];
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
const DB_COMMAND = /^db:/;
const ACK_VAR = "ALLOW_HOSTED_DB";

class GuardRefusal extends Error {}

/** Splits argv (already without node + script) at the first bare `--`. */
function splitAtDoubleDash(args) {
  const i = args.indexOf("--");
  return i === -1 ? { before: args, after: [] } : { before: args.slice(0, i), after: args.slice(i + 1) };
}

/**
 * Parses only what the guard needs from the sequelize-cli command line.
 * Returns { dbCommand, envValues, envMissingValue, forbidden, noEnv, afterDashDash }.
 */
function parseArgs(args) {
  const { before, after } = splitAtDoubleDash(args);
  const out = {
    dbCommand: null,
    envValues: [],
    envMissingValue: false,
    forbidden: [],
    noEnv: false,
    afterDashDash: after,
  };
  for (let i = 0; i < before.length; i++) {
    const a = before[i];
    if (!a.startsWith("-") && DB_COMMAND.test(a) && !out.dbCommand) out.dbCommand = a;
    if (a === "--env") {
      const next = before[i + 1];
      if (next === undefined || next.startsWith("-")) {
        out.envMissingValue = true;
      } else {
        out.envValues.push(next);
        i++;
      }
    } else if (a.startsWith("--env=")) {
      out.envValues.push(a.slice("--env=".length));
    } else if (/^--no-env(=|$)/.test(a)) {
      out.noEnv = true;
    } else {
      const m = /^--(url|config|options-?path|options_path)(=|$)/i.exec(a);
      if (m) out.forbidden.push(`--${m[1]}`);
    }
  }
  // A db:* command that only appears after `--` is not a command to yargs
  // either, so it is deliberately not detected there.
  return out;
}

const NPM_SCRIPTS = new Set(["db:migrate", "db:migrate:undo"]);

/** Only db:migrate and db:migrate:undo have npm script aliases. */
function runPrefix(command) {
  return NPM_SCRIPTS.has(command) ? `npm run ${command} --` : `npx sequelize-cli ${command}`;
}

function usage(command) {
  const c = command || "db:migrate";
  const run = runPrefix(c);
  return [
    "Correct usage (the environment must be passed EXPLICITLY; with npm it goes after `--`):",
    `  development (local DB)                  : ${run} --env development`,
    `  test        (TEST_DATABASE_URL only)    : ${run} --env test`,
    `  production  (DIRECT_DATABASE_URL, hosted; deliberate) : ${run} --env production`,
    `  Windows cmd, one-off variable           : set "DIRECT_DATABASE_URL=..."&& ${run} --env production`,
    "  Verify the target without connecting    : set \"DB_GUARD_CHECK_ONLY=1\"&& " + run + " --env <name>",
    "See tests/README.md (\"Running migrations\").",
  ].join("\n");
}

function isIPv4(host) {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
}

/** Partially masked host, safe to print. Local hosts are shown as-is. */
function maskHost(host) {
  if (LOCAL_HOSTS.has(host)) return host;
  if (isIPv4(host)) {
    const o = host.split(".");
    return `${o[0]}.*.*.${o[3]}`;
  }
  if (host.includes(":")) return "***"; // other IPv6
  const labels = host.split(".");
  const first = `${labels[0].slice(0, 2)}***`;
  if (labels.length === 1) return first;
  const tail = labels.slice(-2).join(".");
  return labels.length === 2 ? `${first}.${labels[1]}` : `${first}.***.${tail}`;
}

/** { host, database } from a postgres URL, or null. Never throws, never echoes the URL. */
function targetOf(url) {
  if (typeof url !== "string" || !/^postgres(?:ql)?:\/\//i.test(url.trim())) return null;
  let u;
  try {
    u = new URL(url.trim());
  } catch {
    return null;
  }
  const host = (u.hostname || "").toLowerCase().replace(/^\[|\]$/g, "");
  if (!host) return null;
  let database = u.pathname.replace(/^\//, "");
  try {
    database = decodeURIComponent(database);
  } catch {
    /* keep the raw path */
  }
  if (!database) return null;
  return { host, database };
}

/**
 * Pure decision function (unit-testable). Throws GuardRefusal with a masked,
 * secret-free message, or returns:
 *   { applies: false }                                   not a db:* command
 *   { applies: true, command, envName, host, database, hosted, line }
 */
function evaluate(argv, opts) {
  const args = argv.slice(2);
  const p = parseArgs(args);
  if (!p.dbCommand) return { applies: false };

  const command = p.dbCommand;
  const u = usage(command);
  const refuse = (what) => {
    throw new GuardRefusal(`REFUSING TO RUN \`${command}\`: ${what}\n\n${u}`);
  };

  if (p.forbidden.length) {
    refuse(
      `${[...new Set(p.forbidden)].join(", ")} is not allowed for db:* commands in this repo — it would bypass ` +
        "the environment/host checks. Use --env with the configured environments instead.",
    );
  }
  if (p.noEnv) refuse("`--no-env` is not accepted; pass --env <name> explicitly.");
  if (p.envMissingValue || p.envValues.some((v) => !v)) {
    refuse("`--env` was given without a value.");
  }
  if (p.envValues.length > 1) refuse("`--env` was given more than once; pass exactly one.");
  if (p.envValues.length === 0) {
    const stray = p.afterDashDash.some((a) => a === "--env" || a.startsWith("--env="));
    refuse(
      "no `--env <name>` on the command line. sequelize-cli would silently default to `development`, " +
        "whose URL can fall back to DATABASE_URL (the hosted production database on the maintainer's machine). " +
        "NODE_ENV and other variables are deliberately NOT accepted as the environment." +
        (stray ? " (An `--env` after a bare `--` is ignored by sequelize-cli itself.)" : "") +
        " With npm, pass it after `--`: `npm run db:migrate -- --env <name>`.",
    );
  }
  const envName = p.envValues[0];
  if (!ENVS.includes(envName)) {
    refuse(`unknown environment "${String(envName).slice(0, 40)}"; expected one of: ${ENVS.join(", ")}.`);
  }

  let url;
  try {
    url = opts.resolveUrl(envName);
  } catch (e) {
    // Config-level refusals (TEST_DATABASE_URL unset / equals production /
    // DIRECT_DATABASE_URL unset for production, ...) — already secret-free.
    refuse(`cannot resolve the ${envName} database: ${e && e.message ? e.message : String(e)}`);
  }
  const target = targetOf(url);
  if (!target) {
    refuse(`the ${envName} connection string is missing or is not a valid postgres:// URL with a database name.`);
  }

  const hosted = !LOCAL_HOSTS.has(target.host);
  const acked = opts.ack === "1";
  if (hosted && envName !== "production" && !acked) {
    refuse(
      `env=${envName} resolves to a HOSTED database (host ${maskHost(target.host)}, db ${target.database}) — not ` +
        "localhost / 127.0.0.1 / ::1. This is exactly how a bare command ends up on production data. If you " +
        "really mean to run against that hosted database, acknowledge it explicitly for this one command:\n" +
        `  Windows cmd : set "${ACK_VAR}=1"&& ${runPrefix(command)} --env ${envName} & set "${ACK_VAR}="\n` +
        `  PowerShell  : $env:${ACK_VAR}=1; try { ${runPrefix(command)} --env ${envName} } finally { Remove-Item Env:${ACK_VAR} }\n` +
        `  bash        : ${ACK_VAR}=1 ${runPrefix(command)} --env ${envName}\n` +
        "(Use the one-shot forms above: in cmd and PowerShell a plain `set` / `$env:` assignment stays in force for the " +
        "whole terminal session, so every LATER --env development / --env test command would pass this guard silently " +
        "against the hosted database. The trailing clear / `finally` removes it even if the command fails; the bash form " +
        "only lasts for that one command. The variable is read from the shell only — a value in .env is ignored on " +
        "purpose. If the target is production, prefer `--env production`.)",
    );
  }

  return {
    applies: true,
    command,
    envName,
    host: target.host,
    database: target.database,
    hosted,
    line: `Migrating env=${envName} host=${maskHost(target.host)} db=${target.database}`,
  };
}

function writeErr(text) {
  try {
    fs.writeSync(2, text.endsWith("\n") ? text : `${text}\n`);
  } catch {
    process.stderr.write(text);
  }
}

let state = "idle"; // idle -> running -> done (memoised: rc + config.cjs may both call)

/**
 * Side-effecting entry point used by .sequelizerc and config.cjs. Exits the
 * process (code 1) on refusal; otherwise prints the confirmation line once.
 * Inert for anything that is not a `db:*` sequelize-cli command.
 * `opts.resolveUrl(envName)` returns the connection string for that env.
 */
function enforceForCli(opts) {
  if (state !== "idle") return;
  state = "running";
  let result;
  try {
    result = evaluate(process.argv, { resolveUrl: opts.resolveUrl, ack: ACK_AT_LOAD });
  } catch (e) {
    if (!(e instanceof GuardRefusal)) throw e;
    writeErr(`\n[db-guard] ${e.message}\n`);
    process.exit(1);
  }
  state = "done";
  if (!result.applies) return;
  console.log(result.line);
  if (process.env.DB_GUARD_CHECK_ONLY === "1") {
    console.log("[db-guard] DB_GUARD_CHECK_ONLY=1: all checks passed; exiting without connecting.");
    process.exit(0);
  }
}

module.exports = {
  ACK_VAR,
  ENVS,
  GuardRefusal,
  parseArgs,
  maskHost,
  targetOf,
  evaluate,
  enforceForCli,
};
