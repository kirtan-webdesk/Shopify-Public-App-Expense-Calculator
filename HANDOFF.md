# HANDOFF — expense-calculator

_Updated: 2026-09-17 by pm-agent_

## Current stage

`intake` / **G0 — spec validation (auto)**. G0.5 is **passed**
(CONFIRM by `sales@webdesksolution.ca`, 2026-09-17T18:02:16Z, project.json v3).
**G1 artifact is written and awaiting a human decision** — the PM agent authored the
estimate and is therefore not its approver.

## What was done this session

- **spec.md finalized.** `spec_status: draft-pending-G0.5-decision` → `g0.5-confirmed`.
  Frontmatter carries the G0.5 decision, `client_classification: internal`,
  `external_contacts: none`, and `plan_tier: "basic"` resolved as internal engagement
  metadata (not a Shopify-plan constraint).
- **OQ-5 / OQ-9 / OQ-10 closed** and moved to spec.md §13.1. §0.2 records the internal
  classification, the FLAG-004 blocklist as moot/non-authoritative, and the standing
  instruction that neither `webdeskinc.com` address is a verified contact or is to be
  used for anything.
- **§4 protected-scopes determination re-framed from pending to CONFIRMED and LOCKED.**
  Reasoning unchanged. `protected_scopes: false`, `scopes: []`, **G-PCD skipped**.
  §4.3 is now a change-control trigger, not an open ambiguity.
- **§11 rewritten as the G1 plan + estimate**: 5-milestone bottom-up range
  **225–390 hrs**, **LOW confidence**, 8 named assumptions, 11 sprints with testable
  ACs tracing to D1–D16, and a re-baseline recommendation for 2026-10-20.
- **§12 records which conditional gates fire** (G1.5 YES, G-Schema YES, G2 YES /
  reduced-UI candidate, G-PCD skipped).
- `project.json` was **NOT written to** by this agent. The G1 gate record is handed to
  the orchestrator below.

## G1 gate record to be written by the orchestrator (under lock)

- `id: G1` · `type: plan-estimate` · `scope: project` · `status: open`
- `approver: PM lead` (specific name = **OQ-7**, unanswered) · `sla_hours: 48`
- `ticket_id: EXPCALC-G1-EST-001`
- estimate **225–390 hrs**, confidence **LOW**, planning figure ~300 hrs
- conditional gates: G1.5 **fires**, G-Schema **fires**, G2 **fires**,
  G-PCD **skipped**
- recommendation: **RENEGOTIATE the 2026-10-20 launch date**

## Next action (in order)

1. **Orchestrator:** run G0 spec validation; write the G1 gate record under lock and
   open G1 for the human PM lead.
2. **Human PM lead:** decide G1 (CONFIRM / REVISE / RENEGOTIATE). The estimate's
   author is not the approver.
3. **Human PM:** answer **OQ-1 (hosting)** and **OQ-8 (design path)** — these two are
   why confidence is LOW, and OQ-1 blocks G1.5 from concluding.
4. **Human PM:** answer **OQ-2 / OQ-3** (repo + credentials protocol) — they gate G3
   and therefore the build start; every date in spec.md §11.5 slips one-for-one while
   they are open.
5. **G1.5 fires and runs BEFORE G-Schema.**

## Blocked on humans (7 open questions, all in spec.md §13.2)

OQ-1 hosting (**G1.5**) · OQ-2 repo (**G3**) · OQ-3 credentials protocol (**G3**) ·
OQ-4 default expense rates (**S2.1/M2**) · OQ-6 timezone, IANA (**gate SLA timers**) ·
OQ-7 named gate approvers, internal only (**every human gate from G1.5**) ·
OQ-8 design path (**G2**).

**Closed at G0.5:** OQ-5 (internal), OQ-9 (engagement-tier metadata),
OQ-10 (merchant-entered revenue).

Full detail: `projects/expense-calculator/spec.md` §11, §12, §13.
