# RFC-001 — Reverse ADR-0001: move hosting from long-running always-on Node to Vercel serverless

| | |
|---|---|
| **Status** | PROPOSED — awaiting human decision. Not self-approved. PM does not approve gates. |
| **Date** | 2026-09-18 |
| **Author** | pm-agent (on instruction from orchestrator) |
| **Type** | Architecture reversal (RFC → ADR supersession) |
| **Reverses** | ADR-0001 — *Host the app as a long-running always-on Node process, not serverless* (CONFIRMED at G1.5, 2026-09-18T07:02:32Z) |
| **Impacts** | ADR-0002 (in-process durable webhook inbox + drain worker), ADR-0008 (45-day GDPR safety sweeper), ADR-0007 (Postgres session storage — connection model only), FT-06, FT-08, FT-08b, FT-15b, FT-17 |
| **Gate** | G1.5-revision (open, `scope: hosting-serverless-redesign`) |
| **Triggers G1 RENEGOTIATE** | **YES — recommended.** See §5. |
| **Protected-data impact** | **None.** `scopes: []`, `protected_scopes: false` unchanged. G-PCD stays **skipped**. Confirmed at G0.5 and re-checked here. |
| **project.json** | Not written by this RFC. Orchestrator records under lock. |

---

## 1. The original decision and why it was made

**ADR-0001** (proposed by the architect at G1.5 on 2026-09-17, CONFIRMED by
`sales@webdesksolution.ca` on 2026-09-18T07:02:32Z) decided:

> Deploy the app as a single, always-on, long-running Node 22 process with
> `min instances = 1`, co-located in the same region as its managed PostgreSQL.

It named a shortlist (Render, DigitalOcean App Platform, Railway, Fly.io with
auto-stop disabled, Heroku) and an **explicitly rejected class**: *"Vercel,
Netlify, Cloudflare Workers, raw AWS Lambda / API Gateway."*

Four grounds were recorded for rejecting serverless, in the ADR's own order of
weight:

1. **Webhook delivery continuity, on a provably cold container.** `shop/redact`
   arrives ~48 hours after uninstall — it *always* lands on a cold app under
   serverless, and it is the one endpoint whose failure is a **GDPR and
   app-review failure**, not a dropped pageview, against a documented 1s
   connect / 5s total delivery budget.
2. **Ack-fast-then-work-async.** A long-running process returns 2xx and keeps
   working. Serverless freezes or kills the execution context at response time,
   so the same pattern requires a queue, a durable-function primitive, or a
   scheduled trigger — *more* moving parts for an app whose entire background
   workload is one deletion job, and `jobs_ownership: app` means we own and
   operate them.
3. **Connection model.** Sequelize expects a stable pool; serverless forces a
   pooler/proxy, and transaction-mode pooling has known friction with prepared
   statements and session-level features.
4. **Embedded-admin first paint.** Cold start lands on the worst part of the
   critical path, and infrequent usage means *most* sessions would pay it.

ADR-0001 also priced its own reversal, in writing:

> *"Reversal is not free. Moving to serverless later is A6 (+10–25hr: webhook-ack
> and pooling rework)."*

and set the procedure that this RFC is executing:

> *"A change of hosting class is an **RFC → ADR supersession**, and if effort
> moves, a **G1 RENEGOTIATE** (A6)."*

**Implementation then proceeded on that basis, and was verified on that basis.**
The G3 scaffold and M1 Foundation shipped an in-process durable webhook inbox
(`app/services/webhook-inbox.service.ts`), an in-process drain worker
(`app/workers/drain-worker.ts`), a 45-day GDPR safety sweeper
(`app/workers/sweeper.ts`), and a per-process scheduler
(`app/workers/bootstrap.server.ts`, two `setInterval` timers started once from
`app/entry.server.tsx`). That scheduler file carries a comment stating it is
*"deliberately NOT a custom Express server / separate process: ADR-0001 chose a
single always-on process specifically so this kind of 'ack fast, work
in-process' pattern doesn't need a queue or a second runtime."*

G4-sprint-1.1 then spent **four rounds of live-Postgres QA re-verification**
making exactly that mechanism correct: **BUG-1** (webhook topic normalization vs
DB CHECK constraint — 500 on all four webhook routes), **BUG-2**
(`deleteSessions([])` rolling back the entire redact transaction — GDPR
hard-deletion broken for every real merchant), **BUG-4** (same defect in
`app/uninstalled`, worse blast radius, plus shared-transaction plumbing through
the drain worker), **BUG-5** (same defect in the sweeper, aborting the whole
sweep pass and defeating ADR-0008's R2 safety net). Final QA verdict:
**PASS_WITH_FLAGS**, zero open P1/P2, with live evidence in four generations
(`dev-evidence/g4-sprint-1.1-live-evidence` through `-v4`).

That is the asset this reversal is being taken against. It is not a paper
decision being changed before anyone built on it.

## 2. Trigger for the reversal — recorded accurately, not tidied up

This change **did not originate in grooming, in a gate, or in a technical
finding.** It originated as a *fait accompli*:

1. **2026-09-18T09:58:10Z** — the human answered OQ-2 (git remote
   `git@github.com:kirtan-webdesk/Shopify-Public-App-Expense-Calculator.git`,
   origin added locally, not pushed at that time) and, in the same message,
   proposed deploying to Vercel on a free account **already connected to that
   repo on Vercel's side**. The orchestrator flagged the direct conflict with
   ADR-0001 and asked for an explicit choice rather than silently complying or
   silently refusing. A sub-question — whether `kirtan-webdesk` is an internal
   WebDesk-controlled account or reopens the OQ-5 external-contact question —
   **was asked and has never been answered.** It remains open (see §6).
2. **Independently of this process**, the app was deployed to
   `https://shopify-public-app-expense-calculat.vercel.app/`. It served a
   **blank white screen**.
3. **2026-09-18T11:29:03Z** — the developer diagnosed it (diagnosis only, no fix,
   no commit): (a) **no `vercel.json` and no React Router 7 Vercel adapter exists
   anywhere in the repo**; `package.json`'s start script (`react-router-serve`)
   assumes a persistent Node process, matching ADR-0001 and
   `startBackgroundWorkers()` in `app/entry.server.tsx`. Best-evidence hypothesis:
   the SSR server is not running at all. And (b) the larger problem — the
   background-worker compliance architecture **fundamentally cannot function on
   Vercel's per-invocation model at all**, which is precisely what ADR-0001
   predicted when it rejected the platform by name.
4. The developer presented both paths, recommending Path 1:
   - **Path 1** — move to an ADR-0001-conformant host. **Zero code changes.**
     Hours of work. Existing architecture and all four rounds of BUG-1/2/4/5
     verification remain valid.
   - **Path 2** — stay on Vercel. Config-only render fix is low-medium effort;
     making the background workers actually function is a **separate, materially
     larger redesign** already priced in ADR-0001 at +10–25hr and rejected there
     for this exact reason.
5. **2026-09-18T11:31:38Z** — the human **explicitly chose Path 2: stay on
   Vercel.** Recorded in `audit_log` as `hosting_decision_reversal`.

**For the record:** the deployment preceded the decision. The architecture gate
is being reopened to ratify and redesign around a platform choice that was
already executed outside the gate sequence. That is the human's call to make and
it is logged as made — but the sequence is recorded as it actually happened, not
as if grooming or G1.5 originated it.

## 3. What is actually being proposed

**Supersede ADR-0001.** Change `project.shopify.hosting` from `tbd` (its current
literal value; the confirmed long-running decision was never written back to that
field) to a serverless/Vercel value, and commission the architect under the
already-open **G1.5-revision** gate to produce a real redesign of webhook
background processing.

**This RFC does not decide the replacement mechanism.** That is the architect's
work at G1.5-revision, not the PM's. What this RFC does is state that a
replacement mechanism is *mandatory* and that "add a Vercel adapter so it
renders" **does not satisfy this RFC**. A page that renders while the GDPR
compliance mechanism silently does not run is a worse outcome than a blank
screen, because it looks like success.

### 3.1 The real cost — the parts beyond the adapter

**(a) Platform enablement — the easy part, and the only part currently visible.**
React Router 7 Vercel preset/adapter + `vercel.json`, build-output and script
changes, environment variables set on Vercel (`DATABASE_URL`, `SHOPIFY_API_KEY`,
`SHOPIFY_API_SECRET`, `SHOPIFY_APP_URL`), `application_url` and `[auth]
redirect_urls` in `shopify.app.toml` repointed at the Vercel domain, Partner
Dashboard URLs updated. Genuinely config-only.

**(b) Background processing — the redesign that ADR-0001 priced.**
`app/workers/bootstrap.server.ts` starts two `setInterval` loops per process:
drain every **5s** (`WEBHOOK_DRAIN_INTERVAL_MS`) and sweep every **1 hour**
(`SWEEPER_INTERVAL_MS`). Neither survives a per-invocation model. The architect
must design and ADR the replacement — Vercel Cron Functions hitting an
authenticated internal drain route, an external queue, or post-response
continuation — and must answer, at minimum:

- **Cron cadence vs. plan tier.** A 5s drain loop has no cron equivalent.
  Vercel's minimum cron granularity, and the sharply tighter limits on the free
  tier specifically, directly govern how long a redact sits unprocessed.
  **Verify-at-build** — but if the free tier's cron floor is coarse (daily-order),
  the ADR-0002 ack-fast-then-work contract degrades from seconds to a day, and
  that must be an explicit, accepted, documented consequence rather than a
  discovery in production.
- **Function max duration vs. sweep loops.** The sweeper iterates eligible shops.
  Under an always-on process that loop simply runs. Under a time-boxed function
  it can be **cut off mid-pass** — a failure mode that did not exist before and
  that BUG-5's fix (per-shop try/catch isolation) does not address. Resumability
  and partial-pass semantics are new design work.
- **Concurrency.** Overlapping cron invocations racing the inbox claim. The
  existing claim transaction may already cover it; it must be *verified* under
  the new trigger, not assumed.
- **Endpoint authentication.** An internal drain route reachable over the public
  internet is a new attack surface that did not exist when the drain was
  in-process only.
- **Connection model (ADR-0001 ground 3).** Sequelize's stable pool vs. N
  concurrent invocations. A pooler or serverless driver is likely required, and
  transaction-mode pooling has known friction with the savepoint/transaction
  plumbing that the BUG-4 fix deliberately added to `drain-worker.ts` and
  `shop.repository.ts`. This is not hypothetical for this codebase.
- **Migrations (FT-17).** ADR-0001's acceptance criterion 3 was a release/pre-deploy
  command hook so migrations never run at request time. Vercel has no equivalent
  release step in the same shape. A safe migration-execution mechanism must be
  designed, or FT-17 must be rewritten. Running migrations from the build step or
  from a request path are both unacceptable.
- **No hosted database exists yet.** All live evidence to date was produced
  against a **local** Postgres. Vercel does not supply one by default, and
  ADR-0001's disqualification of sleeping/idle free tiers applies to the database
  as much as to the app. This is an unresolved procurement item that Path 2 does
  not remove.

**(c) Re-verification of BUG-1 / BUG-2 / BUG-4 / BUG-5 — do not assume it carries
over.** The *guards themselves* are ordinary source code and survive the move.
The **evidence does not.** Every one of the four live-evidence generations was
produced against a long-running process with in-process timers, a single
Sequelize pool, and transaction/savepoint semantics that a connection pooler may
change. Specifically:

- **BUG-1** (raw `X-Shopify-Topic` header handling) must be re-probed through a
  serverless function invocation, not a local Node server.
- **BUG-2 / BUG-4** (session-deletion guards inside the redact and uninstall
  transactions) must be re-proven end-to-end where the transaction now runs under
  a pooled/serverless connection and a cron-triggered drain.
- **BUG-5** must be re-proven *and extended*: the original proof was "the sweep
  loop continues to a second eligible shop in the same pass." Under a time-boxed
  function, "the same pass" may not exist. The equivalent proof is now "the
  backlog is fully processed across passes, with no shop starved."
- **FT-06** (ack < 500ms with work still pending) must be re-measured **with cold
  start included** — this was ADR-0001's number-one rejection ground and is now
  a measurement obligation rather than a design guarantee.
- **FT-08 / FT-08b** (the flagship redact-then-enumerate-every-table proof) must
  be re-run under the new drain trigger.
- **FT-15b** (restart survival) is reframed rather than re-run; per-invocation
  statelessness makes it cheaper, and that is the one genuine credit in this
  column.

Same rigor as before — live evidence against a real database, independently
QA-verified. Not assumed to transfer, not signed off by analogy.

**(d) ADR churn.** ADR-0001 superseded. ADR-0002 (in-process durable inbox +
drain) materially amended or superseded — its central claim, that no queue or
second runtime is needed, no longer holds. ADR-0008 (45-day sweeper) amended for
trigger and partial-pass semantics. ADR-0007 revisited for the connection model
only. `decisions/architecture-packet.md` and `decisions/fitness-test-plan.md`
updated accordingly.

### 3.2 What is explicitly *not* changing

- Scopes remain `[]`; `protected_scopes` remains `false`; **G-PCD remains
  skipped**. This reversal has no protected-customer-data consequence.
- `distribution: public`, `api_version: 2026-07`, `app_pricing.model: free`,
  `data_ownership: dedicated`, `jobs_ownership: app` — unchanged.
- The G-Schema-confirmed data model — unchanged.
- The G2-confirmed UX — unchanged.
- G-Review and G6 remain ahead and are unaffected in *status*; the hosting change
  adds items to the G-Review checklist but does not move the gate.

## 4. Impact on already-passed gates

| Gate | Current | Impact |
|---|---|---|
| G0.5, G0 | passed | None. |
| G1 | passed (`EXPCALC-G1-EST-001`, 225–390hr, LOW) | **Estimate invalidated in part.** M1 Foundation's webhook-processing line is now partly rework. **RENEGOTIATE recommended — see §5.** |
| G1.5 | passed | **Reversed by this RFC.** Superseded by G1.5-revision. |
| G-Schema | passed | None — schema is hosting-independent. |
| G2 | passed | None. |
| G3 | passed | Scaffold verification was performed against a `react-router-serve` long-running target. Not reopened, but the scaffold's runtime assumption no longer holds and a G3-equivalent spot-check of the Vercel build output is a reasonable addition to G1.5-revision's exit criteria. |
| G4-sprint-1.1 | **open**, QA verdict PASS_WITH_FLAGS awaiting human CONFIRM | See §4.1. |
| G1.5-revision | **open** | This RFC is its input. |

### 4.1 Recommendation on G4-sprint-1.1

Do **not** void it, and do **not** let it be cited later as proving something it
does not. Recommended handling:

- Present it to the human for CONFIRM on its own terms, with an explicit note
  recorded in the gate that **its live evidence is execution-model-bound to the
  long-running architecture and does not transfer to the serverless redesign.**
- Carry a **new, named re-verification obligation** forward (a second sprint-QA
  pass scoped to the replacement mechanism) rather than reopening this gate.
  Four rounds of legitimate defect-finding should be recorded as done, because
  they were done.
- The existing carried-forward flags stand and are now **more** urgent, not less:
  **F3** (`.env` realistic-format Shopify key/secret, still unrotated, escalated
  twice) now coexists with a **live public deployment URL** — rotate it;
  **F5** (no CI, all evidence developer-self-produced) becomes harder to defer,
  because the re-verification in §3.1(c) will otherwise also be self-produced,
  and G5 requires authorized-executor artifacts.

## 5. Re-estimate and the G1 RENEGOTIATE recommendation

**Recommendation: YES — trigger a formal G1 RENEGOTIATE and present it to the
human before implementation work resumes.**

This is not a discretionary call. ADR-0001's own Enforcement section states the
rule: *"A change of hosting class is an RFC → ADR supersession, and if effort
moves, a G1 RENEGOTIATE (A6)."* Effort moves. The condition is met on the ADR's
own terms.

### 5.1 Bottom-up delta estimate

| # | Line | Low | High |
|---|---|---:|---:|
| A | Vercel platform enablement — adapter/`vercel.json`, build + scripts, env vars, `shopify.app.toml` + Partner Dashboard URL repoint | 3 | 6 |
| B | Connection-model rework — pooler/serverless driver selection, Sequelize config, re-validating transaction + savepoint semantics under transaction-mode pooling, hosted-Postgres procurement | 6 | 14 |
| C1 | G1.5-revision architecture: design + ADRs for the replacement background mechanism (cron/queue, cadence, concurrency, endpoint auth, partial-pass semantics), packet + fitness-plan updates | 6 | 12 |
| C2 | Implementation of the replacement mechanism (retire `bootstrap.server.ts` timers; drain + sweeper re-triggered; authenticated internal route; resumability) | 8 | 16 |
| D1 | **Re-verification of BUG-1/2/4/5 to the same standard** — live evidence against a deployed serverless target + hosted Postgres, independent QA passes | 8 | 16 |
| D2 | FT-17 migration-execution mechanism for a platform with no release-command hook; FT-06/FT-08/FT-08b re-baselined, FT-15b reframed | 3 | 6 |
| E | Extra gate/coordination cycles — G1.5-revision presentation, RENEGOTIATE, additional QA re-verification round-trips | 4 | 8 |
| | **Delta total** | **38** | **78** |

**Call it 40–85 hr. Planning figure ~60 hr. Confidence: LOW.**

Confidence is LOW for the same reasons G1's original estimate was LOW — no
historical actuals, no estimation spreadsheet — plus three specific unknowns that
sit directly on the cost drivers here: the free-tier cron cadence floor (could
force a queue instead of cron, pushing line C2 toward and past its high end),
the pooler's interaction with the savepoint plumbing added by the BUG-4 fix
(line B), and the absence of any hosted Postgres decision (line B). Ranges, not
points.

**Sanity-check against ADR-0001's own A6 figure:** ADR-0001 priced reversal at
+10–25hr for "webhook-ack and pooling rework". Lines **B + C2 = 14–30 hr**, which
brackets that number closely — the architect's original figure holds up. The
delta beyond it is the part A6 did not price, because A6 assumed reversal *before*
implementation: platform enablement (A), the architecture gate cycle itself (C1),
**re-verification of four P1 bug fixes that were only proven under the old
execution model (D1)**, migration/fitness rebaselining (D2), and the extra gate
round-trips (E). That is **26–48 hr of cost that exists solely because the
reversal comes after implementation and after four rounds of live QA**, not
because the redesign itself got harder.

**Against the G1 baseline:** 40–85 hr on a 225–390 hr band is a **10–38% increase**
— far outside estimating noise, and it lands entirely on M1, the milestone that
was otherwise complete. The previously renegotiated submission-readiness range
(2026-10-24 → 2026-11-27 at 2 devs; 2026-11-17 → 2026-12-29 at 1 dev) moves out
by roughly **1–2 weeks at 2 devs, 2–3 weeks at 1 dev**. Launch date remains a
function of submission date plus Shopify's external G6 review, which has no
internal SLA and no committed date.

### 5.2 Recommended RENEGOTIATE shape

Present it in two steps rather than pretending to precision we do not have:

1. **Now — provisional RENEGOTIATE.** Put 40–85 hr (LOW) in front of the human as
   a *decision-quality* number: this is what Path 2 costs versus Path 1's
   near-zero, and the choice to spend it has already been made. Get it recorded
   against `EXPCALC-G1-EST-001` as a revision, with a new ticket ref.
2. **At G1.5-revision close — refine.** Once the architect's design exists and
   the cron-cadence and pooler questions are answered with real platform facts,
   narrow the band and re-confirm. Confidence should rise from LOW to MEDIUM at
   that point; if it does not, that is itself a signal worth surfacing.

Implementation must not resume before step 1 is decided. That is the point of
RENEGOTIATE — it beats overrun.

## 6. For the record — process notes

Captured accurately rather than smoothed over. **None of these is a blocker.**

1. **OQ-2 was never formally closed.** The human supplied the remote
   (`kirtan-webdesk/Shopify-Public-App-Expense-Calculator`) at 2026-09-18T09:58:10Z,
   but the orchestrator's follow-up — whether `kirtan-webdesk` is an internal
   WebDesk-controlled account, or whether it reopens the OQ-5 external-contact
   question settled at G0.5 (`kirtan@webdeskinc.com` was a prior on-file external
   contact before the project was reconfirmed internal) — **was asked and never
   answered.** OQ-2 should be recorded as *partially answered*, not closed.
2. **The Vercel deployment happened outside the gate sequence.** The repo was
   connected to Vercel on Vercel's side and deployed before any gate authorized a
   hosting change, and before the architecture that governs hosting was reopened.
   The white-screen failure was then diagnosed *reactively*. This RFC exists to
   bring that back inside the process, not to retroactively imply it went through
   it.
3. **A public deployment URL now exists** (`https://shopify-public-app-expense-calculat.vercel.app/`)
   for an app that has not reached G-Review or G6. Not a submission problem — it
   is not a listed app — but it raises the priority of the unrotated F3 secret and
   means the app's public surface is live ahead of the observability and runbook
   work at G5.5.
4. **Vercel free/Hobby tier terms are a commercial question, not just a technical
   one.** A public Shopify App Store app distributed by a company is commercial
   use even when the app itself is free to merchants. **Verify-at-build** against
   Vercel's current plan terms before this becomes a launch-blocking surprise.
   Flagged, not asserted.
5. **`project.shopify.hosting` still literally reads `"tbd"`.** The
   G1.5-confirmed long-running decision was never written back to that field.
   Whatever value G1.5-revision produces should be written there so the field
   stops disagreeing with the decision record.

## 7. Requested decision

Decisions required from the human, recorded by the orchestrator under lock:

1. **Accept / reject this RFC** (accept = ADR-0001 superseded, hosting class
   changes to serverless/Vercel, architect commissioned under G1.5-revision).
2. **Accept / reject the provisional G1 RENEGOTIATE** at **+40–85 hr (LOW
   confidence)**, with refinement at G1.5-revision close.
3. **Direct the handling of G4-sprint-1.1** per §4.1 — CONFIRM on its own terms
   with the evidence explicitly scoped to the retired execution model, plus a
   named re-verification obligation carried forward.
4. **Answer the outstanding OQ-2 sub-question** (§6.1).

On acceptance, this RFC produces a superseding ADR (expected **ADR-0009**,
numbered by the architect) as the output of G1.5-revision — not as an output of
this RFC.

---

### Proposed `project.json.rfcs[]` entry (for the orchestrator to write under lock — PM does not write project.json)

```json
{
  "id": "RFC-001",
  "title": "Reverse ADR-0001: move hosting from long-running always-on Node to Vercel serverless",
  "status": "proposed",
  "ref": "rfcs/RFC-001-hosting-reversal-vercel-serverless.md",
  "triggers_reestimate": true
}
```

`resulting_adr` is left unset until G1.5-revision produces the superseding ADR.
