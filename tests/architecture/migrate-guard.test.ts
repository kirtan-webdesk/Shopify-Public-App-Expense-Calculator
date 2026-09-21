import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";

// Default-CI guard for G4-sprint-3.6: every `sequelize-cli db:*` command
// REFUSES (before any connection) unless `--env <name>` is passed explicitly,
// and refuses a hosted target for development/test without an explicit
// acknowledgement. No database is used: every case is a real child
// `sequelize-cli` process with a controlled environment whose URLs point at
// `.invalid` hosts / a closed local port, and the success paths run with
// DB_GUARD_CHECK_ONLY=1 (all checks, confirmation line, exit 0, NO connect).

// Each case spawns real child processes (~0.3-1s each); the default 5s is too tight on a busy machine.
vi.setConfig({ testTimeout: 60_000 });

const ROOT = process.cwd();
const CLI = join(ROOT, "node_modules", "sequelize-cli", "lib", "sequelize");
const tmp = mkdtempSync(join(tmpdir(), "wsa-migrate-guard-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const HOSTED = "postgres://hosted_user:H0stedS3cret@ep-cool-name-123456-pooler.us-east-2.aws.neon.invalid/neondb?sslmode=require";
const LOCAL_TEST = "postgres://tester:t3stpw@localhost:1/wsa_migrate_guard_probe";
const HOSTED_TEST = "postgres://tester:t3stpw@branch-host.example.invalid/wsa_hosted_test_branch";
const SECRETS = ["hosted_user", "H0stedS3cret", "t3stpw", "ep-cool-name-123456", "branch-host"];

type Run = { status: number | null; out: string; stdout: string; stderr: string };

/** Runs the REAL sequelize-cli in the repo root (so .sequelizerc loads) with a controlled env. */
function cli(args: string[], env: Record<string, string> = {}, dotenvBody = ""): Run {
  const dotenvPath = join(tmp, `dotenv-${Math.random().toString(36).slice(2)}.env`);
  writeFileSync(dotenvPath, dotenvBody);
  const r = spawnSync(process.execPath, [CLI, ...args], {
    cwd: ROOT,
    env: {
      PATH: process.env.PATH ?? "",
      SystemRoot: process.env.SystemRoot ?? "",
      DOTENV_CONFIG_PATH: dotenvPath,
      DOTENV_CONFIG_QUIET: "true",
      ...env,
    },
    encoding: "utf8",
    timeout: 60_000,
  });
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "", out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

/** Refused = non-zero exit, guard message, and sequelize-cli never even printed its banner / loaded the config. */
function expectRefused(r: Run, re?: RegExp) {
  expect(r.status, r.out).not.toBe(0);
  expect(r.out).toMatch(/\[db-guard\] REFUSING TO RUN/);
  expect(r.out).not.toMatch(/Sequelize CLI \[Node/);
  expect(r.out).not.toMatch(/Loaded configuration file|Using environment/);
  expect(r.out).not.toMatch(/Migrating env=/); // the confirmation line is only for accepted runs
  for (const s of SECRETS) expect(r.out, `secret "${s}" leaked`).not.toContain(s);
  if (re) expect(r.out).toMatch(re);
}

const BASE = { DATABASE_URL: HOSTED, DIRECT_DATABASE_URL: HOSTED, TEST_DATABASE_URL: LOCAL_TEST };
const CHECK = { ...BASE, DB_GUARD_CHECK_ONLY: "1" };

describe("db:* commands refuse without an explicit --env (before any connection)", () => {
  const cmds = [
    "db:migrate",
    "db:migrate:undo",
    "db:migrate:undo:all",
    "db:migrate:status",
    "db:seed:all",
    "db:seed:undo:all",
    "db:create",
    "db:drop",
  ];

  it.each(cmds)("bare `sequelize-cli %s` is refused, with the exact correct usage", (cmd) => {
    const r = cli([cmd], BASE);
    expectRefused(r, /no `--env <name>` on the command line/);
    expect(r.out).toMatch(/--env development/);
    expect(r.out).toMatch(/--env test/);
    expect(r.out).toMatch(/--env production/);
  });

  it("NODE_ENV / ambient variables are NOT accepted as the environment", () => {
    expectRefused(cli(["db:migrate"], { ...BASE, NODE_ENV: "test" }), /NODE_ENV/);
    expectRefused(cli(["db:migrate"], { ...BASE, NODE_ENV: "production" }));
  });

  it("`--env` with a missing value is refused (end of line, or followed by another flag)", () => {
    expectRefused(cli(["db:migrate", "--env"], BASE), /without a value/);
    expectRefused(cli(["db:migrate", "--env", "--debug"], BASE), /without a value/);
    expectRefused(cli(["db:migrate", "--env="], BASE), /without a value/);
  });

  it("an `--env` that only appears after a bare `--` does not count (sequelize-cli would ignore it and use development)", () => {
    expectRefused(cli(["db:migrate", "--", "--env", "test"], BASE), /after a bare `--`/);
  });

  it("unknown, duplicate and negated --env are refused", () => {
    expectRefused(cli(["db:migrate", "--env", "staging"], BASE), /unknown environment/);
    expectRefused(cli(["db:migrate", "--env", "test", "--env", "production"], BASE), /more than once/);
    expectRefused(cli(["db:migrate", "--env", "test", "--no-env"], BASE), /--no-env/);
  });

  it("--url / --config (which would bypass the checks) are refused", () => {
    expectRefused(cli(["db:migrate", "--env", "test", "--url", "postgres://x@y/z"], BASE), /--url is not allowed/);
    expectRefused(cli(["db:migrate", "--env", "test", "--config", "other.json"], BASE), /--config is not allowed/);
  });

  it("--options-path replaces .sequelizerc entirely, so it is caught by the guard inside config.cjs (defence in depth)", () => {
    // An options file that points back at this repo's config.cjs: .sequelizerc never loads, but config.cjs does.
    const opts = join(tmp, "options.json");
    writeFileSync(opts, JSON.stringify({ config: join(ROOT, "db", "config", "config.cjs") }));
    for (const flag of [["--options-path", opts], [`--options-path=${opts}`], ["--optionsPath", opts]]) {
      // Here the refusal comes from config.cjs, i.e. AFTER sequelize-cli's own banner but still before it
      // connects or runs anything, so expectRefused's "no banner" check does not apply.
      const r = cli(["db:migrate", "--env", "test", ...flag], BASE);
      expect(r.status, r.out).not.toBe(0);
      expect(r.out).toMatch(/\[db-guard\] REFUSING TO RUN[\s\S]*--options-?path is not allowed/i);
      expect(r.out).not.toMatch(/Migrating env=|Loaded configuration file|Using environment/);
    }
    // Without a config in the options file sequelize-cli has nothing to connect to and fails on its own, non-zero.
    const noConfig = join(tmp, "options-empty.json");
    writeFileSync(noConfig, "{}");
    const r = cli(["db:migrate", "--env", "test", "--options-path", noConfig], BASE);
    expect(r.status).not.toBe(0);
    expect(r.out).not.toMatch(/Migrating env=|Loaded configuration file/);
  });
});

describe("hosted-target safety for --env development / --env test", () => {
  it("--env development against a non-local host is refused without acknowledgement", () => {
    // development resolves to DIRECT_DATABASE_URL (hosted) here — the exact careless-command scenario.
    const r = cli(["db:migrate", "--env", "development"], BASE);
    expectRefused(r, /HOSTED database/);
    expect(r.out).toMatch(/ALLOW_HOSTED_DB=1/);
    expect(r.out).toMatch(/host ep\*\*\*\.\*\*\*\.neon\.invalid, db neondb/); // masked host, db name only
  });

  it("the refusal suggests ONE-SHOT acknowledgements only (nothing that leaves ALLOW_HOSTED_DB set for the session)", () => {
    const r = cli(["db:migrate", "--env", "development"], BASE);
    expectRefused(r, /HOSTED database/);
    // cmd: cleared again after the command, whether or not it succeeded (`&`, not `&&`, before the clear).
    expect(r.out).toContain('set "ALLOW_HOSTED_DB=1"&& npm run db:migrate -- --env development & set "ALLOW_HOSTED_DB="');
    // PowerShell: try/finally removes the variable even if the command fails.
    expect(r.out).toContain(
      "$env:ALLOW_HOSTED_DB=1; try { npm run db:migrate -- --env development } finally { Remove-Item Env:ALLOW_HOSTED_DB }",
    );
    // bash: a command-scoped prefix assignment.
    expect(r.out).toMatch(/^\s+bash\s+: ALLOW_HOSTED_DB=1 npm run db:migrate -- --env development$/m);
    // The old session-persisting PowerShell suggestion must be gone.
    expect(r.out).not.toContain("$env:ALLOW_HOSTED_DB=1; npm run");
    // ... and the reason is stated.
    expect(r.out).toMatch(/whole terminal session/);
  });

  it("the same for db:migrate:undo, and via a DATABASE_URL-only fallback (no DIRECT_DATABASE_URL)", () => {
    expectRefused(cli(["db:migrate:undo", "--env", "development"], BASE), /HOSTED database/);
    expectRefused(cli(["db:migrate", "--env", "development"], { DATABASE_URL: HOSTED }), /HOSTED database/);
  });

  it("--env test against a non-local test URL is refused without acknowledgement", () => {
    expectRefused(cli(["db:migrate", "--env", "test"], { ...BASE, TEST_DATABASE_URL: HOSTED_TEST }), /HOSTED database/);
  });

  it("the acknowledgement must come from the shell: ALLOW_HOSTED_DB in a .env file is ignored", () => {
    expectRefused(cli(["db:migrate", "--env", "development"], BASE, "ALLOW_HOSTED_DB=1\n"), /HOSTED database/);
    expectRefused(cli(["db:migrate", "--env", "development"], { ...BASE, ALLOW_HOSTED_DB: "yes" }), /HOSTED database/);
  });

  it("with ALLOW_HOSTED_DB=1 the hosted target is accepted (masked confirmation printed, still no connection in check-only mode)", () => {
    const r = cli(["db:migrate", "--env", "development"], { ...CHECK, ALLOW_HOSTED_DB: "1" });
    expect(r.status, r.out).toBe(0);
    expect(r.stdout).toMatch(/^Migrating env=development host=ep\*\*\*\.\*\*\*\.neon\.invalid db=neondb$/m);
    for (const s of SECRETS) expect(r.out).not.toContain(s);
  });

  it("--env production is the intended hosted target: only the explicit --env is needed (no acknowledgement)", () => {
    const r = cli(["db:migrate:status", "--env", "production"], CHECK);
    expect(r.status, r.out).toBe(0);
    expect(r.stdout).toMatch(/^Migrating env=production host=ep\*\*\*\.\*\*\*\.neon\.invalid db=neondb$/m);
    // production still needs DIRECT_DATABASE_URL (existing lazy-getter behaviour, unchanged):
    expectRefused(cli(["db:migrate", "--env", "production"], { DATABASE_URL: HOSTED }), /DIRECT_DATABASE_URL is not set/);
  });
});

describe("success-path parsing: the guard passes up to (not including) connecting", () => {
  it("--env test with a local test URL prints the confirmation line and stops (check-only)", () => {
    const r = cli(["db:migrate", "--env", "test"], CHECK);
    expect(r.status, r.out).toBe(0);
    expect(r.stdout).toMatch(/^Migrating env=test host=localhost db=wsa_migrate_guard_probe$/m);
    expect(r.out).toMatch(/exiting without connecting/);
    expect(r.out).not.toMatch(/Sequelize CLI \[Node|Loaded configuration file/); // never reached sequelize-cli proper
    for (const s of SECRETS) expect(r.out).not.toContain(s);
  });

  it("accepts `--env=test`, flag-before-command order, and every db:* command", () => {
    for (const args of [
      ["db:migrate", "--env=test"],
      ["--env", "test", "db:migrate:undo"],
      ["db:seed:all", "--env", "test"],
      ["db:migrate:undo:all", "--env", "test"],
    ]) {
      const r = cli(args, CHECK);
      expect(r.status, `${args.join(" ")}\n${r.out}`).toBe(0);
      expect(r.stdout).toMatch(/^Migrating env=test host=localhost db=wsa_migrate_guard_probe$/m);
    }
  });

  it("--env development against a LOCAL url needs no acknowledgement", () => {
    const local = "postgres://postgres:postgres@127.0.0.1:1/expense_calculator_dev";
    const r = cli(["db:migrate", "--env", "development"], { ...CHECK, DIRECT_DATABASE_URL: local });
    expect(r.status, r.out).toBe(0);
    expect(r.stdout).toMatch(/^Migrating env=development host=127\.0\.0\.1 db=expense_calculator_dev$/m);
  });

  it("the existing --env test isolation guard still runs (unset / equal-to-production URL are refused)", () => {
    expectRefused(cli(["db:migrate", "--env", "test"], { DIRECT_DATABASE_URL: HOSTED, DATABASE_URL: HOSTED }), /TEST_DATABASE_URL is not set/);
    expectRefused(cli(["db:migrate", "--env", "test"], { ...BASE, TEST_DATABASE_URL: HOSTED }), /same host \+ database/);
  });

  it("non-DB commands (e.g. migration:generate --help) are not guarded", () => {
    const r = cli(["migration:generate", "--help"], BASE);
    expect(r.status, r.out).toBe(0);
    expect(r.out).not.toMatch(/db-guard/);
  });
});

describe("wiring + docs (static)", () => {
  const read = (...p: string[]) => readFileSync(join(ROOT, ...p), "utf8");
  const pkg = JSON.parse(read("package.json")) as { scripts: Record<string, string> };

  it("the npm db scripts still exist and still go straight through sequelize-cli (the guard is in the CLI load path, not the script)", () => {
    expect(pkg.scripts["db:migrate"]).toBe("sequelize-cli db:migrate");
    expect(pkg.scripts["db:migrate:undo"]).toBe("sequelize-cli db:migrate:undo");
  });

  it(".sequelizerc runs the guard, and config.cjs loads it BEFORE dotenv (so .env cannot grant the acknowledgement)", () => {
    expect(read(".sequelizerc")).toMatch(/migrate-guard\.cjs"\)\.enforceForCli\(/);
    const cfg = read("db", "config", "config.cjs");
    expect(cfg).toMatch(/enforceForCli\(/);
    expect(cfg.indexOf("migrate-guard.cjs")).toBeGreaterThan(-1);
    expect(cfg.indexOf("migrate-guard.cjs")).toBeLessThan(cfg.indexOf('require("dotenv/config")'));
    expect(read("db", "config", "migrate-guard.cjs")).toMatch(/const ACK_AT_LOAD = process\.env\.ALLOW_HOSTED_DB;/);
  });

  it("the docs state the explicit-env rule and the hosted acknowledgement (tests/README.md, .env.example)", () => {
    const readme = read("tests", "README.md");
    expect(readme).toMatch(/## Running migrations/);
    for (const needle of ["--env development", "--env test", "--env production", "ALLOW_HOSTED_DB=1", "DB_GUARD_CHECK_ONLY=1", "set \"DIRECT_DATABASE_URL="]) {
      expect(readme, `tests/README.md should mention ${needle}`).toContain(needle);
    }
    expect(readme).toMatch(/explicit\s+`--env/i);
    // The acknowledgement is documented as one-shot (cleared after the command), never a session-persisting variable.
    expect(readme).toContain('set "ALLOW_HOSTED_DB=1"&& npm run db:migrate -- --env development & set "ALLOW_HOSTED_DB="');
    expect(readme).toContain("finally { Remove-Item Env:ALLOW_HOSTED_DB }");
    expect(readme).not.toContain("$env:ALLOW_HOSTED_DB=1; npm run");
    const envExample = read(".env.example");
    expect(envExample).toMatch(/--env <name>/);
    expect(envExample).toMatch(/ALLOW_HOSTED_DB/);
    expect(envExample).toMatch(/refuse/i);
  });
});
