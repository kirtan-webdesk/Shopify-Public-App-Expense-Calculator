import { isCronStale } from "~/db/repositories/job-heartbeat.repository";

// healthz — the one intentionally unauthenticated route (route-auth matrix,
// shopify-app-auth-and-routes skill). Still static-SHAPED (ADR-0009 D6: the
// body's fields never change), still no Shopify auth call, no shop
// identifiers. Used by the hosting platform's health-check-gated rolling
// deploys AND, as of ADR-0009 D6, doubles as the dead-man's-switch endpoint
// for the serverless cron mechanism: an external uptime check on this URL
// alerts on `cronStale: true` without needing its own scheduler or its own
// DB credentials.
//
// cronStale is a BOOLEAN ONLY — deliberately no timestamp, no run count, no
// shop data (ADR-0009 D6): a timestamp would be needlessly precise
// operational intelligence on a public endpoint, and a count would leak
// merchant/shop volume.
const CRON_JOB_NAME = "cron_tick";

// How often the cron tick is EXPECTED to run — must match vercel.json's
// cron schedule (kept as an env var, not a literal, so the two can be
// changed together deliberately rather than drifting — see .env.example and
// vercel.json's own comment-equivalent note). ADR-0009 D3: daily is
// architecturally sufficient and is the safe default here.
const CRON_INTERVAL_MINUTES = Number(process.env.CRON_INTERVAL_MINUTES || 1440);

// ADR-0009 D6: re-tuned from ADR-0002's 15-minute alert threshold to
// max(2 x cron interval, 30 min).
const CRON_STALE_THRESHOLD_MS = Math.max(
  2 * CRON_INTERVAL_MINUTES * 60 * 1000,
  30 * 60 * 1000,
);

export async function loader() {
  // Fail-safe default: if the job_heartbeat read itself fails (DB
  // unreachable, table missing, anything), report cronStale:true rather
  // than throwing a 500 or — worse — silently reporting healthy. "Unknown"
  // must never read as "healthy" for a dead-man's switch.
  let cronStale = true;
  try {
    cronStale = await isCronStale(CRON_JOB_NAME, CRON_STALE_THRESHOLD_MS);
  } catch (err) {
    console.error(
      "[healthz] failed to read job_heartbeat — reporting cronStale:true (fail-safe)",
      err,
    );
  }

  return Response.json({ status: "ok", cronStale }, { status: 200 });
}
