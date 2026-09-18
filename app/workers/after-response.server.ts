import { waitUntil as vercelWaitUntil } from "@vercel/functions";

// after-response.server — ADR-0009 D2's fast tier primitive. The ONE thing
// a webhook route adds beyond ack-and-enqueue: a hint to keep the function
// instance alive after the response has already been flushed, so the drain
// continuation gets a real chance to run before the instance is frozen or
// reclaimed. This is an OPTIMIZATION, not the guarantee — the slow-tier
// cron (app/routes/api.cron.tick.tsx) is the guarantee, and is designed to
// be correct even if this file does nothing at all.
//
// How this actually behaves in each environment (verify-at-build, ADR-0009
// §8 item 1 — @vercel/functions' own waitUntil() implementation, not
// invented here):
//   - On Vercel, with a live request context: `fn()` starts executing
//     immediately (JS runs an async function body eagerly up to its first
//     `await`, regardless of whether anyone reads the returned promise), and
//     registering that promise with the platform's waitUntil() additionally
//     asks Vercel to keep the instance alive until it settles — the part
//     that is NOT provable outside a real deployment (ADR-0009 RV-2).
//   - Off Vercel (local `shopify app dev`, vitest, or if @vercel/functions'
//     waitUntil() finds no request context — it no-ops via optional
//     chaining rather than throwing, confirmed by reading the installed
//     package source at node_modules/@vercel/functions/wait-until.js): `fn()`
//     has ALREADY started running the instant it was called, a line above.
//     The waitUntil() call becomes a harmless no-op wrapper around a promise
//     that is running anyway. This is what ADR-0009 D2 means by "falls back
//     to a direct fire-and-forget" — there is no separate fallback branch to
//     write; invoking fn() eagerly IS the fallback, on every environment.
export function scheduleAfterResponse(fn: () => Promise<void>): void {
  // Never awaited, never allowed to reject into the caller — a failure here
  // must not turn a successful ack into a 500 (ADR-0009 D2). The
  // webhook_event row is already durable; the slow-tier cron tick collects
  // it regardless of what happens to this promise.
  const promise = fn().catch((err) => {
    console.error(
      "[after-response] fast-tier continuation failed — non-fatal, the " +
        "row(s) remain unprocessed and the next cron tick (ADR-0009 D3) " +
        "will collect them.",
      err,
    );
  });

  try {
    vercelWaitUntil(promise);
  } catch (err) {
    // vercelWaitUntil() itself should not throw (it optional-chains into a
    // possibly-absent context), but this call is wrapped defensively per the
    // same "never let the continuation mechanism affect the response" rule
    // above — the promise is already running regardless of this call's
    // outcome.
    console.error("[after-response] registering waitUntil() threw (non-fatal)", err);
  }
}
