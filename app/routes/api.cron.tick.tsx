import type { Route } from "./+types/api.cron.tick";
import { isAuthorizedCronRequest } from "~/services/cron-auth.service";
import { drainUpTo, type DrainOutcome } from "~/workers/drain-worker";
import { runSweeper, runWebhookEventPruning, type SweepOutcome } from "~/workers/sweeper";
import { recordHeartbeat } from "~/db/repositories/job-heartbeat.repository";

// /api/cron/tick — ADR-0009 D3/D4/D5. The SLOW TIER: the one thing this
// app's GDPR compliance mechanism actually depends on working. One
// endpoint, one schedule (see vercel.json), drain -> sweep -> prune ->
// heartbeat, in that order, every tick.
//
// ROUTE-AUTH: this is a 5th, non-Shopify route-auth class — internal
// shared-secret (app/services/cron-auth.service.ts), never
// authenticate.admin/authenticate.webhook, never the unauthenticated
// allowlist. Auth is checked FIRST, before any import-triggered or
// query-triggered DB work, and fails closed (401) with zero DB writes on a
// missing/wrong header or an unset CRON_SECRET (ADR-0009 D5 / FT-22).
//
// VERIFY AT BUILD (ADR-0009 §8 item 3): whether Vercel Cron sends a GET or
// POST request, and the exact header shape. Both `loader` (GET) and
// `action` (POST/other) are wired to the identical authenticated handler
// below so getting the verb wrong doesn't turn into "just disable auth to
// unblock the cron job" — the defensive choice is duplicating the wiring,
// not loosening the check.
const CRON_JOB_NAME = "cron_tick";

// Self-imposed wall-clock budget for the WHOLE tick (ADR-0009 D4) — the
// design is deliberately independent of Vercel's actual max function
// duration per plan/compute generation (verify-at-build, ADR-0009 §8 item
// 4), by never trying to get close to it. Default is a conservative
// fraction of the shortest plausible duration limit; tune once the real
// plan/duration is confirmed live.
const TICK_BUDGET_MS = Number(process.env.CRON_TICK_BUDGET_MS || 8000);
// Slow-tier drain cap — larger than the fast tier's K=5 (this IS the
// guarantee, not the optimisation), but still bounded: the wall-clock
// budget above is what actually stops a large backlog in practice, this cap
// is a second, independent bound.
const DRAIN_MAX_ROWS = Number(process.env.CRON_DRAIN_MAX_ROWS || 200);
const SWEEP_LIMIT = Number(process.env.CRON_SWEEP_LIMIT || 50);

interface TickSummary {
  readonly ok: boolean;
  readonly elapsedMs: number;
  readonly drained: DrainOutcome;
  readonly swept: SweepOutcome;
  /** "completed" — runWebhookEventPruning() is unchanged (ADR-0009 D3 step
   * 3) and does not return a count; see sweeper.ts. */
  readonly pruned: "completed" | "skipped" | "failed";
  readonly errors: readonly string[];
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function handleCronTick(request: Request): Promise<Response> {
  // D5 — zero DB work happens above this line. A missing/wrong bearer, or
  // CRON_SECRET unset entirely, returns 401 here and nothing below ever
  // runs (FT-22).
  if (!isAuthorizedCronRequest(request)) {
    return new Response(null, { status: 401 });
  }

  const startedAt = Date.now();
  const remainingBudgetMs = () => Math.max(0, TICK_BUDGET_MS - (Date.now() - startedAt));
  const errors: string[] = [];

  let drained: DrainOutcome = { drained: 0, failed: 0, backlogExhausted: true };
  try {
    drained = await drainUpTo({ maxRows: DRAIN_MAX_ROWS, budgetMs: remainingBudgetMs() });
  } catch (err) {
    errors.push(`drain: ${errorMessage(err)}`);
  }

  let swept: SweepOutcome = {
    consideredCount: 0,
    deletedCount: 0,
    failedCount: 0,
    resumable: false,
  };
  if (remainingBudgetMs() > 0) {
    try {
      swept = await runSweeper({ limit: SWEEP_LIMIT, budgetMs: remainingBudgetMs() });
    } catch (err) {
      errors.push(`sweep: ${errorMessage(err)}`);
    }
  } else {
    swept = { ...swept, resumable: true };
  }

  // Pruning is a single indexed DELETE (unchanged, ADR-0009 D3 step 3) —
  // always attempted regardless of remaining budget; it is not the thing
  // that can run long.
  let pruned: TickSummary["pruned"] = "completed";
  try {
    await runWebhookEventPruning();
  } catch (err) {
    pruned = "failed";
    errors.push(`prune: ${errorMessage(err)}`);
  }

  const lastResult: "ok" | "error" = errors.length === 0 ? "ok" : "error";
  try {
    await recordHeartbeat(
      CRON_JOB_NAME,
      lastResult,
      errors.length ? errors.join("; ").slice(0, 2000) : null,
    );
  } catch (err) {
    // The heartbeat write failing is the one failure worth its own loud log
    // — job_heartbeat IS the dead-man's switch (ADR-0009 D6). If this keeps
    // failing, /healthz's cronStale flag becomes the only remaining signal
    // that anything is wrong.
    console.error("[cron-tick] failed to record job_heartbeat", err);
  }

  const summary: TickSummary = {
    ok: errors.length === 0,
    elapsedMs: Date.now() - startedAt,
    drained,
    swept,
    pruned,
    errors,
  };

  // No shop domains, no shop ids, no webhook payloads in the response —
  // counts and outcome flags only (WebDesk hardening posture, same spirit as
  // the no-PII-in-webhook-response rule, applied here even though this
  // endpoint is authenticated and not public).
  return Response.json(summary, { status: 200 });
}

export async function loader({ request }: Route.LoaderArgs) {
  return handleCronTick(request);
}

export async function action({ request }: Route.ActionArgs) {
  return handleCronTick(request);
}
