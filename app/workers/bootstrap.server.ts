import { drainOnce } from "~/workers/drain-worker";
import { runSweeper, runWebhookEventPruning } from "~/workers/sweeper";

// --------------------------------------------------------------------------
// Starts the in-process background loops exactly ONCE per server process
// (ADR-0001/ADR-0002). This module has a top-level side effect and is
// imported exactly once, at module scope, from app/entry.server.tsx — the
// true single per-process SSR entry point under @react-router/serve. Node's
// module cache guarantees this file's body runs once no matter how many
// requests the process serves.
//
// Deliberately NOT a custom Express server / separate process: ADR-0001
// chose a single always-on process specifically so this kind of "ack fast,
// work in-process" pattern doesn't need a queue or a second runtime
// (ADR-0002's own reasoning). FT-15a (no module-scope mutable state in
// auth/session/shop paths) does not apply to this module — it is a worker
// scheduler, not a shadow auth/session cache.
//
// VERIFY AT BUILD: confirm @react-router/serve loads entry.server exactly
// once at boot (not per-request) for the installed version — this is the
// documented behaviour of the framework's SSR request handler, but the
// architecture packet flags every framework-version assumption as
// verify-at-build (§9) and this one is load-bearing for "no queue needed".
// --------------------------------------------------------------------------

let started = false;

export function startBackgroundWorkers(): void {
  if (started) return;
  started = true;

  if (process.env.NODE_ENV === "test") {
    // Never run background intervals under the test runner — tests own
    // their own lifecycle and a live DB connection may not exist (see
    // tests/README for the "no local Postgres in this environment" note).
    return;
  }

  const drainIntervalMs = Number(process.env.WEBHOOK_DRAIN_INTERVAL_MS || 5000);
  const sweeperIntervalMs = Number(process.env.SWEEPER_INTERVAL_MS || 3_600_000);

  const drainTimer = setInterval(() => {
    drainOnce().catch((err) => {
      console.error("[bootstrap] drainOnce failed", err);
    });
  }, drainIntervalMs);
  drainTimer.unref?.();

  const sweepTimer = setInterval(() => {
    runSweeper().catch((err) => {
      console.error("[bootstrap] runSweeper failed", err);
    });
    runWebhookEventPruning().catch((err) => {
      console.error("[bootstrap] runWebhookEventPruning failed", err);
    });
  }, sweeperIntervalMs);
  sweepTimer.unref?.();

  console.log(
    `[bootstrap] background workers started (drain every ${drainIntervalMs}ms, ` +
      `sweep every ${sweeperIntervalMs}ms)`,
  );
}
