import { JobHeartbeatModel, type JobHeartbeatResult } from "~/db/models/job-heartbeat.model";

// job-heartbeat.repository — the ONLY place that touches the job_heartbeat
// table (ADR-0003 layering, same rule as every other repository). Backs
// ADR-0009 D6's dead-man's-switch: the cron tick writes a heartbeat every
// run (success or failure), and /healthz reads only a derived boolean from
// it — never the raw row — keeping the public endpoint's body static-shaped
// (no timestamps, no counts, no shop data).

export interface HeartbeatRow {
  readonly jobName: string;
  readonly lastRunAt: Date;
  readonly lastResult: JobHeartbeatResult;
  readonly lastError: string | null;
}

/**
 * Upsert-by-jobName: one row per job, always the MOST RECENT run. Called by
 * the cron tick (app/routes/api.cron.tick.tsx) at the end of every
 * invocation, success or failure — recording that the tick ran at all is
 * the entire point (ADR-0009 D6: absence of a heartbeat, not the presence of
 * an error, is the failure mode this table exists to catch).
 */
export async function recordHeartbeat(
  jobName: string,
  result: JobHeartbeatResult,
  error: string | null = null,
): Promise<void> {
  const now = new Date();
  await JobHeartbeatModel.upsert({
    jobName,
    lastRunAt: now,
    lastResult: result,
    lastError: error,
  });
}

export async function getHeartbeat(jobName: string): Promise<HeartbeatRow | null> {
  const row = await JobHeartbeatModel.findByPk(jobName);
  if (!row) return null;
  return {
    jobName: row.jobName,
    lastRunAt: row.lastRunAt,
    lastResult: row.lastResult,
    lastError: row.lastError,
  };
}

/**
 * Never-ran (no row yet) counts as stale — the safe default is "unknown ==
 * unhealthy," never "unknown == healthy" (ADR-0009 D6).
 */
export async function isCronStale(jobName: string, staleAfterMs: number): Promise<boolean> {
  const heartbeat = await getHeartbeat(jobName);
  if (!heartbeat) return true;
  return Date.now() - heartbeat.lastRunAt.getTime() > staleAfterMs;
}
