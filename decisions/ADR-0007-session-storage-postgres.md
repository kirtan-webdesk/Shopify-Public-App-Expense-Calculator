# ADR-0007 — The library-managed PostgreSQL session store is the sole auth state; no custom session mechanism

| | |
|---|---|
| **Status** | PROPOSED — pending G1.5 approval (Tech lead). Not self-approved. |
| **Date** | 2026-09-17 |
| **Gate** | G1.5 |
| **Related** | ADR-0001 (hosting), ADR-0008 (deletion), spec.md §9, D2 |

---

## Context

G1.5 must confirm the session-storage decision explicitly, because "session
storage beyond the default Postgres store" is itself an architecture trigger. It
is also where embedded apps most often grow a shadow auth system — a signed
cookie "so we don't have to re-authenticate", a cached shop in module scope, a
bespoke JWT — each of which breaks embedding, breaks restarts, or breaks GDPR
deletion.

Auth model is **token exchange + managed installation** (no OAuth redirect flow).

## Decision

**Use `@shopify/shopify-app-session-storage-postgresql`
(`PostgreSQLSessionStorage`) against the app's own PostgreSQL database, and treat
the session table as the *only* place authentication state lives.**

1. **No second auth mechanism.** No app-authored session cookie, no app-issued
   JWT, no `localStorage` auth artefact, no in-memory session cache, no
   module-scope shop map. Authorisation on every request derives from
   `authenticate.admin(request)` (session token) or, on webhook paths, from
   `authenticate.webhook(request)` — per the route matrix.
2. **Same database, one dependency.** The session store shares the app's Postgres
   instance. No Redis.
3. **Expiring offline tokens are on from day one:**
   `future: { expiringOfflineAccessTokens: true }`. Offline tokens expire
   (60-minute) and carry a `refresh_token`; the `Session` holds `refreshToken` /
   `refreshTokenExpires` and the library refreshes. Required for new public apps
   since 2026-04-01 and for all public apps by 2027-01-01 — building with it now
   avoids a forced migration later. **Verify at build** whether the installed
   major line already defaults this on (in which case the flag is redundant but
   harmless).
4. **The session schema is library-owned.** No app columns are added to it, and
   no app migration alters it. App state about a shop lives on the app's own
   `shop` table.
5. **Lifecycle:**
   - *Install* — token exchange writes the session.
   - *Steady state* — offline token refresh is the library's job; the app never
     hand-rolls a refresh.
   - *`app/uninstalled`* — delete all session rows for the shop (the access token
     is dead anyway; leaving rows is stale credential material). App data is
     retained at this point — see ADR-0008.
   - *`shop/redact`* — session rows for the shop must be gone, asserted by FT-08's
     table enumeration.
   - Webhook handlers must tolerate `session === undefined` (already uninstalled).
6. **CSP:** `addDocumentResponseHeaders` is wired in `entry.server` so every
   document response carries `frame-ancestors` and the app can embed. The App
   Bridge API-key `<meta>` precedes `app-bridge.js` in `<head>` of **every** page,
   produced by `<AppProvider embedded apiKey={apiKey}>` — not hand-rolled.

## Alternative considered: a dedicated session store (Redis, or a separate database)

The usual reasons to do this are cross-process session sharing at scale, sub-
millisecond session reads, and isolating session write load from application
queries. **None apply**: ADR-0001 gives one process, volume is low, and the
Postgres instance is region-local and idle. Redis would add a fourth external
dependency (architecture packet §2), a second thing to back up, monitor and
patch, and a new failure mode where sessions are available but app data is not —
for zero measurable benefit at this scale.

Cost of rejecting it: session reads compete with app queries on one pool. At
low-hundreds-of-shops volume this is not measurable. **Revisit trigger:** if the
app ever runs multiple instances under sustained load and session reads show up
in query profiling.

**Alternative also considered: the template's default Prisma/SQLite store.**
Rejected — SQLite on an ephemeral container filesystem loses sessions on every
redeploy, and WebDesk standard is Postgres + Sequelize, not Prisma. This is a
documented, deliberate deviation from the template default.

## Consequences

- **Restart- and redeploy-safe by construction.** ADR-0001's single instance can
  be replaced at will because nothing authentication-related lives in the process.
  This is also what makes any future scale-out a configuration change.
- **GDPR deletion has exactly one place to look for credentials.**
- **Accepted cost: a database round trip on the session path.** Negligible
  region-local; and it is the same database the request is about to query anyway.
- **Accepted cost: the library owns the session schema**, so a library upgrade
  can change it. Treat `@shopify/shopify-app-*` upgrades as deliberate, tested
  changes (the same discipline as the API-version pin), not as routine dependency
  bumps.
- Embedding works without third-party cookies, because session tokens — not
  cookies — carry identity.

## Enforcement

| Mechanism | What it catches |
|---|---|
| **FT-03** custom AST/route check: every route with a loader or action either calls the correct `authenticate.*` for its class or appears in an explicit unauthenticated allowlist (`healthz` only) | An unauthenticated sensitive route shipping — the app-review failure this exists to prevent |
| **FT-15a** custom check: no module-scope mutable state in `auth`/`session`/`shop` paths; no `Set-Cookie` written by app code; no app-issued JWT signing | A shadow auth mechanism |
| **FT-15b** vitest integration: install, restart the server process, assert the session still resolves and the app renders | SQLite-style or in-memory session storage sneaking back in |
| **FT-12** document test: API-key `<meta>` precedes `app-bridge.js`, and both `app-bridge.js` and `polaris.js` are present in `<head>` of **every** route's document; `addDocumentResponseHeaders` applied | Broken embedding and Req 2.2.3 (always-latest App Bridge); a page that forgot the scripts |
| **FT-12b** dependency check: `@shopify/polaris` (Polaris React, archived) absent; App Bridge/Polaris not vendored, pinned, or self-hosted | Req 2.2.3 regression |
| Gated at **G5**, run on every PR | |
