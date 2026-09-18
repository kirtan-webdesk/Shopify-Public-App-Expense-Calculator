#!/usr/bin/env bash
# init-project.sh — scaffold a Shopify-public-app project workspace for the
# webdesk-shopify-apps plugin. Repaired for v0.1.2:
#   - strict client-slug validation
#   - project.json built + validated by a JSON-aware tool (python3 + jsonschema),
#     never string interpolation
#   - schema-conforming IDs
#   - dependency checks (python3 + jsonschema required; node/npm + jq checked)
#   - every path written to CLAUDE.md is created and re-verified to resolve
#
# Usage:
#   ./init-project.sh --client rossy-ai --type app-build \
#       --api-version 2026-07 --data-ownership shared-saas \
#       --hosting long-running [--protected-scopes] [--out ./projects]
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCHEMA="$HERE/../schemas/project-json.schema.json"

CLIENT="" TYPE="" API_VERSION="2026-07" DATA_OWNERSHIP="dedicated" HOSTING="tbd" PROTECTED="false" OUT="./projects" FORCE=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --client) CLIENT="${2:-}"; shift 2;;
    --type) TYPE="${2:-}"; shift 2;;
    --api-version) API_VERSION="${2:-}"; shift 2;;
    --data-ownership) DATA_OWNERSHIP="${2:-}"; shift 2;;
    --hosting) HOSTING="${2:-}"; shift 2;;
    --protected-scopes) PROTECTED="true"; shift;;
    --force) FORCE=1; shift;;
    --out) OUT="${2:-}"; shift 2;;
    *) echo "ERROR: unknown arg: $1" >&2; exit 2;;
  esac
done

# ---- dependency checks -------------------------------------------------------
missing=0
command -v python3 >/dev/null 2>&1 || { echo "ERROR: python3 is required" >&2; missing=1; }
python3 -c "import jsonschema" 2>/dev/null || { echo "ERROR: python 'jsonschema' is required (pip install jsonschema)" >&2; missing=1; }
command -v node >/dev/null 2>&1 || echo "WARN: node not found — needed later to build the Shopify app (React Router 7)." >&2
command -v npm  >/dev/null 2>&1 || echo "WARN: npm not found — needed later for the app toolchain." >&2
command -v jq   >/dev/null 2>&1 || echo "INFO: jq not found (optional; python handles JSON)." >&2
[[ "$missing" -eq 1 ]] && exit 2
[[ -f "$SCHEMA" ]] || { echo "ERROR: schema not found at $SCHEMA" >&2; exit 2; }

# ---- strict input validation -------------------------------------------------
# slug: lowercase alphanumerics + single hyphens, 2-40 chars, no leading/trailing hyphen
if [[ ! "$CLIENT" =~ ^[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])$ ]]; then
  echo "ERROR: --client '$CLIENT' is not a valid slug." >&2
  echo "       Must be 2-40 chars, lowercase a-z 0-9 and hyphens, no leading/trailing hyphen." >&2
  exit 2
fi
case "$TYPE" in
  app-build|feature|maintenance|api-version-upgrade) : ;;
  *) echo "ERROR: --type must be one of: app-build feature maintenance api-version-upgrade" >&2; exit 2;;
esac
case "$DATA_OWNERSHIP" in dedicated|shared-saas) : ;; *) echo "ERROR: --data-ownership must be dedicated|shared-saas" >&2; exit 2;; esac
case "$HOSTING" in long-running|serverless|tbd) : ;; *) echo "ERROR: --hosting must be long-running|serverless|tbd" >&2; exit 2;; esac
if [[ ! "$API_VERSION" =~ ^[0-9]{4}-(01|04|07|10)$ ]]; then
  echo "ERROR: --api-version '$API_VERSION' must be a Shopify quarterly version YYYY-(01|04|07|10), e.g. 2026-07." >&2; exit 2
fi

DIR="$OUT/$CLIENT"
if [[ -d "$DIR" ]] && [[ -n "$(ls -A "$DIR" 2>/dev/null)" ]] && [[ "$FORCE" -ne 1 ]]; then
  echo "ERROR: project '$DIR' already exists and is non-empty. Use --force to overwrite." >&2; exit 4
fi
mkdir -p "$DIR"/{rfcs,decisions,observability,qa-reports,listing-assets,review-readiness,project.json.versions}

# jobs ownership tracks data ownership (shared SaaS => SaaS-side jobs, app owns no queue)
if [[ "$DATA_OWNERSHIP" == "shared-saas" ]]; then JOBS="saas"; QUEUE="saas"; else JOBS="app"; QUEUE="app-host"; fi
STAGE="grooming"; GATE="G0.5"
[[ "$TYPE" == "maintenance" ]] && { STAGE="monitoring"; GATE="M6"; }

# ---- build + schema-validate project.json with python (values via env, NOT interpolation)
export WSA_CLIENT="$CLIENT" WSA_TYPE="$TYPE" WSA_API="$API_VERSION" WSA_DATA="$DATA_OWNERSHIP" \
       WSA_HOSTING="$HOSTING" WSA_PROTECTED="$PROTECTED" WSA_STAGE="$STAGE" WSA_GATE="$GATE" \
       WSA_JOBS="$JOBS" WSA_QUEUE="$QUEUE"
python3 - "$SCHEMA" "$DIR/project.json" <<'PY'
import json, os, sys, uuid, jsonschema
schema_path, out_path = sys.argv[1], sys.argv[2]
schema = json.load(open(schema_path))
e = os.environ
data_ownership = e["WSA_DATA"]
doc = {
  "project": {
    "id": str(uuid.uuid4()),
    "name": e["WSA_CLIENT"],
    "client_slug": e["WSA_CLIENT"],
    "project_type": e["WSA_TYPE"],
    "build_context": "shopify-app",
    "stage": e["WSA_STAGE"],
    "current_gate": e["WSA_GATE"],
    "schema_version": "1.0.0",
    "shopify": {
      "distribution": "public",
      "api_version": e["WSA_API"],
      "scopes": [],
      "protected_scopes": (e["WSA_PROTECTED"] == "true"),
      "app_pricing": {"model": "recurring+usage"},
      "data_ownership": data_ownership,
      "jobs_ownership": e["WSA_JOBS"],
      "hosting": e["WSA_HOSTING"],
      "extensions": [],
      "built_for_shopify": False
    }
  },
  "tech_stack": {
    "runtime": "node@22",
    "framework": "react-router-7",
    "ui": "polaris-web-components",
    "database": "postgresql",
    "orm": "sequelize",
    "session_storage": "postgresql",
    "auth": "token-exchange",
    "admin_api": "graphql",
    "billing": "app-pricing",
    "queue": e["WSA_QUEUE"]
  },
  "gates": [],
  "budget": {"token_used": 0, "token_cap": 0, "hours_burned": 0, "hours_budget": 0},
  "audit_log": [],
  "lock": {"locked": False, "locked_by": None},
  "rfcs": [],
  "health_score": None,
  "shared_data_contract": ({"status": "draft", "note": "produce at G-Schema"} if data_ownership == "shared-saas" else None)
}
jsonschema.validate(doc, schema)   # raises if the generated doc is not schema-valid
json.dump(doc, open(out_path, "w"), indent=2)
print("project.json generated and schema-VALID")
PY

# ---- workspace files referenced by CLAUDE.md (must exist) --------------------
cat > "$DIR/spec.md" <<MD
# ${CLIENT} — spec

_Grooming output. Fill during Grooming (G0.5). Capture: app purpose, scopes
(flag protected/order/customer scopes → G-PCD), API version pin (${API_VERSION}),
App Pricing plans, data+jobs ownership (${DATA_OWNERSHIP}), hosting (${HOSTING})._
MD

cat > "$DIR/HANDOFF.md" <<MD
# HANDOFF — ${CLIENT}

## Current stage
${STAGE} (${GATE})

## What's next
Run Grooming via the orchestrator agent; the delivery flow is described by the
\`shopify-public-app-delivery\` skill.
MD

touch "$DIR/audit-log.jsonl"

# ---- CLAUDE.md: reference plugin skills by NAME + workspace files by PATH -----
cat > "$DIR/CLAUDE.md" <<MD
# Project: ${CLIENT} (Shopify public app)

Built with the **webdesk-shopify-apps** Claude Code plugin. Skills are discovered
by description — no manual load list. Start with the \`orchestrator\` agent.

- project_type: \`${TYPE}\`
- api_version: \`${API_VERSION}\` (pinned; quarterly review)
- data_ownership: \`${DATA_OWNERSHIP}\` · jobs: \`${JOBS}\`
- hosting: \`${HOSTING}\`

## Relevant plugin skills (invoked by description)
shopify-public-app-delivery, shopify-app-scaffold, shopify-app-auth-and-routes,
shopify-admin-graphql, shopify-polaris-app-bridge, shopify-app-billing,
shopify-webhooks-compliance, shopify-protected-customer-data,
shopify-data-jobs-ownership, shopify-app-review-readiness, shopify-built-for-shopify

## Workspace files
- project.json   (state; single source of truth for gate status)
- spec.md        (grooming output)
- HANDOFF.md     (session handoff)
MD

# ---- verify every workspace file path referenced in CLAUDE.md resolves -------
resolve_fail=0
for f in project.json spec.md HANDOFF.md; do
  if [[ ! -f "$DIR/$f" ]]; then echo "ERROR: CLAUDE.md references '$f' but it does not exist" >&2; resolve_fail=1; fi
done
[[ "$resolve_fail" -eq 1 ]] && exit 3

# ---- make scripts executable -------------------------------------------------
chmod +x "$HERE"/*.sh "$HERE"/*.py 2>/dev/null || true

echo "Scaffolded schema-valid workspace at: $DIR"
echo "Next: invoke the orchestrator agent; grooming (G0.5) is the first gate."
