import { createHash, timingSafeEqual } from "node:crypto";

// cron-auth.service — the 5th route-authentication class (ADR-0009 D5,
// shopify-app-auth-and-routes skill's matrix extended for this app). NOT
// authenticate.admin (session-token JWT) and NOT authenticate.webhook
// (Shopify HMAC) — this route is never called by Shopify at all, it is
// called by Vercel Cron (or the documented fallback external scheduler,
// ADR-0009 Alternative C), so it needs its own class: an internal shared
// secret, constant-time compared, FAILS CLOSED if unset.
//
// Getting this wrong ships a publicly-triggerable GDPR hard-delete endpoint
// (ADR-0009 D5's own words) — this file is the entire blast-radius boundary
// for that risk and is kept deliberately small and dependency-free.

/**
 * SHA-256 both sides before comparing so the comparison is constant-time
 * REGARDLESS of the caller-supplied header's length (a raw-string
 * timingSafeEqual requires equal-length buffers, which would otherwise leak
 * "your header was even in the right length ballpark" via an early
 * false/throw before any real comparison happens — hashing first removes
 * that leak entirely, at the cost of a cheap hash on every request, which is
 * irrelevant next to a DB round trip).
 */
function constantTimeEquals(a: string, b: string): boolean {
  const digestA = createHash("sha256").update(a).digest();
  const digestB = createHash("sha256").update(b).digest();
  return timingSafeEqual(digestA, digestB);
}

/**
 * Verifies `Authorization: Bearer $CRON_SECRET` in constant time.
 *
 * FAILS CLOSED: if CRON_SECRET is unset in the environment, this returns
 * false for EVERY request, including one that would otherwise match — there
 * is no "unauthenticated fallback" mode. An operator who forgets to set
 * CRON_SECRET gets a permanently-401ing cron endpoint (loud, safe,
 * detectable via the job_heartbeat dead-man's switch this same tick would
 * otherwise write to) rather than an open one (silent, catastrophic).
 *
 * Performs ZERO database work — this function is pure string/crypto
 * comparison against process.env, callable before any repository import is
 * even touched by the caller (ADR-0009 D5 / FT-22: "401 and zero DB writes").
 */
export function isAuthorizedCronRequest(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return false;
  }

  const header = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;

  return constantTimeEquals(header, expected);
}
