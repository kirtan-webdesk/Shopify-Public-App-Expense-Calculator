#!/usr/bin/env bash
# Acceptance tests for the webdesk-shopify-apps plugin (v0.1.8-beta.6).
# Reports PASSED / FAILED / SKIPPED separately.
# MANDATORY local tests must run: if a mandatory test's dependency (Claude CLI,
# python jsonschema/pyyaml) is missing, it is recorded as FAILED — not skipped.
# The ONLY allowed skips are the two external-environment tests (live Shopify dev
# store; real end-user cold Claude Code session), which are documented .md plans
# in this directory and never run here.
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"; cd "$ROOT"
P=0; F=0; S=0
# per-run scratch dir + cleanup trap (no fixed /tmp/t1,/tmp/t2 collisions)
WORK="$(mktemp -d "${TMPDIR:-/tmp}/wsa-accept.XXXXXX")"
cleanup(){ rm -rf "$WORK" 2>/dev/null || true; }
trap cleanup EXIT INT TERM
pass(){ echo "  PASS : $1"; P=$((P+1)); }
fail(){ echo "  FAIL : $1"; F=$((F+1)); }
skip(){ echo "  SKIP : $1"; S=$((S+1)); }
# mandatory-dep guard: if a required tool is missing, FAIL (do not skip)
require(){ command -v "$1" >/dev/null 2>&1 || { fail "mandatory dependency '$1' missing — cannot run $2"; return 1; }; }

echo "===== MANDATORY LOCAL TESTS ====="

echo "T1: claude plugin validate --strict (manifest)"
if require claude "T1"; then
  if claude plugin validate . --strict >"$WORK/t1" 2>&1; then pass "manifest valid (strict)"; else fail "manifest invalid"; sed 's/^/      /' "$WORK/t1"; fi
fi

echo "T2: validate-plugin.py — YAML frontmatter + refs + agent wiring + dir refs"
if require python3 "T2" && python3 -c "import yaml,jsonschema" 2>/dev/null; then
  if python3 tools/scripts/validate-plugin.py . >"$WORK/t2" 2>&1; then pass "validate-plugin: zero errors"; else fail "validate-plugin errors"; sed 's/^/      /' "$WORK/t2"; fi
else fail "python jsonschema/pyyaml missing — cannot run T2"; fi

echo "T3: every skill/agent has name+description (discoverable)"
bad=0
for f in $(find skills -name SKILL.md; ls agents/*.md 2>/dev/null); do
  case "$f" in *_*|*/.*) continue;; esac
  python3 - "$f" <<'PY' || bad=1
import sys,yaml
t=open(sys.argv[1]).read(); d=yaml.safe_load(t[3:t.find("\n---",3)])
assert isinstance(d,dict) and d.get("name") and d.get("description")
PY
done
[ "$bad" -eq 0 ] && pass "all skills/agents discoverable" || fail "a skill/agent lacks name/description"

echo "T4: orchestrator declares an EXACT Agent(...) allowlist of the 7 specialists, FULLY SCOPED (bare Agent, or any bare/unscoped specialist name, must fail)"
python3 - agents/orchestrator.md .claude-plugin/plugin.json <<'PY' && pass "orchestrator Agent(...) allowlist = exactly the 7 specialists, scoped 'webdesk-shopify-apps:<name>'" || fail "orchestrator sub-agent allowlist wrong (bare Agent, bare/unscoped specialist, missing/extra specialist)"
import sys,re,yaml,json
t=open(sys.argv[1]).read(); fm=yaml.safe_load(t[3:t.find("\n---",3)]); tools=fm.get("tools")
plugin=json.load(open(sys.argv[2]))["name"]
items=tools if isinstance(tools,list) else [i.strip() for i in re.split(r',\s*(?![^()]*\))',str(tools)) if i.strip()]
allow=None; present=False
for it in items:
    m=re.match(r'^([A-Za-z_][A-Za-z0-9_-]*)\s*(?:\((.*)\))?\s*$',it)
    if m and m.group(1) in ("Agent","Task"):
        present=True
        if m.group(2) is not None: allow=[a.strip() for a in m.group(2).split(",") if a.strip()]
SPECIALISTS={"pm","architect","designer","shopify-developer","qa","code-review","delivery-head"}
REQ={f"{plugin}:{s}" for s in SPECIALISTS}
assert present, "orchestrator lacks the Agent tool"
assert allow is not None, "bare 'Agent' allows ALL sub-agents — allowlist required"
unscoped=[a for a in allow if ":" not in a]
assert not unscoped, f"allowlist contains BARE (unscoped) specialist name(s) {sorted(unscoped)} — plugin sub-agents only register for Agent(...) delegation under their scoped identifier '{plugin}:<name>'; a bare name platform-validates but fails at RUNTIME with \"Agent type '<name>' not found. Available agents: none\" (the beta.5 defect)"
assert set(allow)==REQ, f"allowlist mismatch: {sorted(set(allow))} != {sorted(REQ)}"
PY

echo "T5: producing agents have Write+Edit; qa/code-review tools are EXACTLY [Read, Grep, Glob]"
python3 - <<'PY' && pass "producing agents Write+Edit; qa/code-review exactly [Read,Grep,Glob]" || fail "agent tool capabilities wrong (read-only set must be exactly Read/Grep/Glob — no Bash/Agent/Write/Edit)"
import re,yaml,sys
def tnames(a):
    t=open(f"agents/{a}.md").read(); fm=yaml.safe_load(t[3:t.find(chr(10)+'---',3)]); tools=fm.get("tools")
    items=tools if isinstance(tools,list) else [i.strip() for i in re.split(r',\s*(?![^()]*\))',str(tools)) if i.strip()]
    out=set()
    for it in items:
        m=re.match(r'^([A-Za-z_][A-Za-z0-9_-]*)',str(it)); out.add(m.group(1)) if m else out.add(str(it))
    return out
for a in ("pm","architect","designer","shopify-developer","delivery-head"):
    n=tnames(a); assert {"Write","Edit"}<=n, f"{a} must have Write+Edit, has {sorted(n)}"
for a in ("qa","code-review"):
    n=tnames(a); assert n=={"Read","Grep","Glob"}, f"{a} tools must be EXACTLY [Read,Grep,Glob], has {sorted(n)}"
PY

echo "T6: scaffolder — uuid4 id, schema-valid for all types, guards work"
TMP="$WORK/scaffold"; mkdir -p "$TMP"; okg=1
for s in "rossy-ai app-build shared-saas" "acme feature dedicated" "care maintenance dedicated"; do
  set -- $s; bash tools/scripts/init-project.sh --client "$1" --type "$2" --data-ownership "$3" --out "$TMP" >/dev/null 2>&1 || okg=0
done
python3 - "$TMP" tools/schemas/project-json.schema.json <<'PY' && idok=1 || idok=0
import json,sys,glob,jsonschema,re
sch=json.load(open(sys.argv[2])); uid=re.compile(r'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')
for p in glob.glob(sys.argv[1]+"/*/project.json"):
    d=json.load(open(p)); jsonschema.validate(d,sch); assert uid.match(d["project"]["id"]), d["project"]["id"]
PY
# guards
bash tools/scripts/init-project.sh --client "Bad_Slug" --type app-build --out "$TMP" >/dev/null 2>&1; g_slug=$?
bash tools/scripts/init-project.sh --client good --type widget --out "$TMP" >/dev/null 2>&1; g_type=$?
bash tools/scripts/init-project.sh --client g2 --type app-build --api-version 2026 --out "$TMP" >/dev/null 2>&1; g_api=$?
# well-formed YYYY-MM but NOT a Shopify quarter (01/04/07/10) must also be rejected:
bash tools/scripts/init-project.sh --client g3 --type app-build --api-version 2026-02 --out "$TMP" >/dev/null 2>&1; g_month=$?
bash tools/scripts/init-project.sh --client rossy-ai --type app-build --data-ownership shared-saas --out "$TMP" >/dev/null 2>&1; g_over=$?
if [ "$okg" -eq 1 ] && [ "$idok" -eq 1 ] && [ "$g_slug" -ne 0 ] && [ "$g_type" -ne 0 ] && [ "$g_api" -ne 0 ] && [ "$g_month" -ne 0 ] && [ "$g_over" -ne 0 ]; then
  pass "uuid4 id + schema-valid (all types); slug/type/api-version(non-quarter)/overwrite guards enforced"
else fail "scaffolder: gen=$okg uuidschema=$idok slug=$g_slug type=$g_type api=$g_api month=$g_month overwrite=$g_over"; fi

echo "T7: mandatory app-CI checks cannot silently skip (no --if-present)"
if grep -nE '^[[:space:]]*[^#].*npm (run (lint|typecheck|build)|test).*--if-present' .github/workflows/app-ci.yml >/dev/null 2>&1; then
  fail "found --if-present on a mandatory check"
else
  need=0; for s in "npm run lint" "npm run typecheck" "npm test" "npm run build"; do grep -qF "$s" .github/workflows/app-ci.yml || need=1; done
  [ "$need" -eq 0 ] && pass "lint/typecheck/test/build present + unconditional" || fail "a mandatory check step missing"
fi

echo "T8: all workflow YAML + manifest JSON + schema JSON + settings.json parse"
python3 - <<'PY' && pass "all YAML/JSON parse (incl settings.json)" || fail "a YAML/JSON file does not parse"
import glob,yaml,json
for f in glob.glob(".github/workflows/*.yml"): yaml.safe_load(open(f))
for f in [".claude-plugin/plugin.json","tools/schemas/project-json.schema.json","settings.json"]: json.load(open(f))
# settings.json must use the plugin-LOCAL bare agent name (not the namespaced form)
assert json.load(open("settings.json")).get("agent")=="orchestrator", "settings.json agent must be the bare plugin-local 'orchestrator'"
PY

echo "T9: clean-env bootstrap"
C="$WORK/boot"; mkdir -p "$C"
if bash tools/scripts/init-project.sh --client boot --type app-build --out "$C" >/dev/null 2>&1 && [ -f "$C/boot/project.json" ] && [ -f "$C/boot/CLAUDE.md" ]; then pass "clean-env bootstrap ok"; else fail "clean-env bootstrap failed"; fi

echo "T10: REAL CLI component inventory of the EXACT shipped package — under an isolated CLAUDE_CONFIG_DIR"
if require claude "T10"; then
  # --- isolation: every claude command in T10 runs against a THROWAWAY config dir, so
  # the operator's real ~/.claude (settings, installed plugins, marketplaces) is never
  # touched. Ref: CLAUDE_CONFIG_DIR (code.claude.com/docs/en/env-vars).
  TEST_CLAUDE_CONFIG="$WORK/claude-config"; mkdir -p "$TEST_CLAUDE_CONFIG"
  run_claude(){ CLAUDE_CONFIG_DIR="$TEST_CLAUDE_CONFIG" claude "$@"; }

  # --- test the EXACT package, unfiltered. NO tar --exclude, NO rm of components.
  # If the delivered package contains an unexpected component, this test MUST fail —
  # it never cleans the package before testing it.
  MP="$WORK/market"; CLEAN="$MP/plugins/webdesk-shopify-apps"; mkdir -p "$CLEAN" "$MP/.claude-plugin"
  cp -a "$ROOT/." "$CLEAN/"
  # do not copy prior test scratch / VCS noise that isn't part of the plugin itself
  rm -rf "$CLEAN/.git" 2>/dev/null || true
  cat > "$MP/.claude-plugin/marketplace.json" <<'JSON'
{ "name": "wsa-accept", "owner": { "name": "WebDesk Solution" },
  "plugins": [ { "name": "webdesk-shopify-apps", "source": "./plugins/webdesk-shopify-apps", "description": "acceptance" } ] }
JSON
  inv_ok=0
  # run from a neutral cwd so a --scope local install lands in the throwaway config, not the repo
  ( cd "$WORK" && run_claude plugin marketplace add "$MP" ) >/dev/null 2>&1 \
    && ( cd "$WORK" && run_claude plugin install webdesk-shopify-apps@wsa-accept --scope local ) >/dev/null 2>&1
  if [ -n "${WORK:-}" ]; then
    ( cd "$WORK" && run_claude plugin details webdesk-shopify-apps ) > "$WORK/details.txt" 2>&1
    python3 - "$WORK/details.txt" <<'PY' && inv_ok=1 || inv_ok=0
import sys,re
t=open(sys.argv[1]).read()
def line(label):
    m=re.search(rf'{label}\s*\((\d+)\)\s+(.*)', t)
    assert m, f"no {label} line in `claude plugin details` output:\n{t[:400]}"
    return int(m.group(1)), [x.strip() for x in m.group(2).split(",") if x.strip()]
na,agents=line("Agents"); ns,skills=line("Skills")
# The exact package must expose ONLY the intended components — any name starting with
# '_' or 'probe', or any count != expected, is a packaging defect and must fail here.
scratch=[x for x in agents+skills if x.startswith("_") or x.startswith("probe")]
assert not scratch, f"unexpected scratch/probe component in the shipped package: {scratch}"
assert na==8, f"expected 8 agents in the shipped package, CLI reports {na}: {sorted(agents)}"
assert ns==11, f"expected 11 skills in the shipped package, CLI reports {ns}: {sorted(skills)}"
assert "orchestrator" in agents and "shopify-developer" in agents, f"missing key agent: {sorted(agents)}"
# v0.1.8: the bundled Shopify Dev MCP server must appear in the CLI inventory
mmatch=re.search(r'MCP servers\s*\((\d+)\)\s+([^\n]*)', t)
assert mmatch and int(mmatch.group(1))>=1 and 'shopify-dev-mcp' in mmatch.group(2), f"CLI inventory missing the shopify-dev-mcp MCP server: {mmatch.group(0) if mmatch else 'no MCP line'}"
print(f"EXACT-PACKAGE CLI inventory OK: {na} agents, {ns} skills, MCP server 'shopify-dev-mcp' present, no unexpected components")
PY
  fi
  # teardown — qualified plugin name + scope, all inside the throwaway config
  ( cd "$WORK" && run_claude plugin uninstall webdesk-shopify-apps@wsa-accept --scope local ) >/dev/null 2>&1 \
    || ( cd "$WORK" && run_claude plugin uninstall webdesk-shopify-apps ) >/dev/null 2>&1 || true
  ( cd "$WORK" && run_claude plugin marketplace remove wsa-accept ) >/dev/null 2>&1 || true
  [ "$inv_ok" -eq 1 ] && pass "exact-package inventory = 8 agents / 11 skills, no unexpected components (isolated CLAUDE_CONFIG_DIR)" || { fail "exact-package CLI inventory mismatch — see below"; sed 's/^/      /' "$WORK/details.txt" 2>/dev/null | head -24; }
fi

echo "T11: preload tokens — one VISIBLE marker per skill, skill-name match, unique, only in its SKILL.md (values not printed)"
python3 - <<'PY' && pass "11 visible preload tokens (name-matched), one per skill, none leaked into agents/other skills/tests/docs/evidence" || fail "preload-token check failed (see message)"
import glob,os,re
TOK=re.compile(r'WSA-PRELOAD-[a-z0-9-]+-[0-9A-F]{16}')
CMT=re.compile(r'<!--.*?-->',re.S)
skills=[p for p in glob.glob("skills/*/SKILL.md") if "/_" not in p]
occ={}
for dp,dn,fs in os.walk("."):
    if ".git" in dp.split(os.sep) or "__pycache__" in dp.split(os.sep): continue
    for f in fs:
        fp=os.path.join(dp,f)
        try: txt=open(fp,encoding="utf-8",errors="ignore").read()
        except: continue
        for t in TOK.findall(txt): occ.setdefault(t,set()).add(os.path.relpath(fp))
for p in skills:
    raw=open(p,encoding="utf-8",errors="ignore").read()
    found=TOK.findall(raw)
    assert len(found)==1, f"{p}: expected exactly one token, found {len(found)}"
    tok=found[0]
    assert tok in CMT.sub('',raw), f"{p}: token must be a VISIBLE marker, not inside an HTML comment"
    owner=os.path.basename(os.path.dirname(p))
    assert tok.startswith(f"WSA-PRELOAD-{owner}-") and re.fullmatch(r'[0-9A-F]{16}', tok[len(f'WSA-PRELOAD-{owner}-'):]), f"{p}: token skill-name must match dir '{owner}'"
assert len(occ)==len(skills), f"expected {len(skills)} unique tokens, found {len(occ)}"
skillset={os.path.relpath(p) for p in skills}
for t,files in occ.items():
    assert len(files)==1, f"a token leaked into multiple files: {sorted(files)}"
    assert next(iter(files)) in skillset, f"a token lives outside a SKILL.md: {sorted(files)}"
print(f"  ({len(occ)} visible, name-matched tokens verified; values intentionally not printed)")
PY

echo "T12: Shopify Dev MCP config + agent wiring (static) — pinned version, dev-only access, others none, qa/cr read-only"
python3 - <<'PY' && pass "MCP pinned+wired: shopify-developer only; qa/code-review exactly read-only" || fail "MCP config/wiring wrong"
import json,re,yaml
m=json.load(open(".mcp.json")); e=m["mcpServers"]["shopify-dev-mcp"]
assert e.get("command")=="npx", e.get("command")
spec=[a for a in e["args"] if isinstance(a,str) and a.startswith("@shopify/dev-mcp@")][0]; ver=spec.rsplit("@",1)[1]
assert re.fullmatch(r"\d+\.\d+\.\d+",ver), f"MCP version not exact-pinned: {ver}"
def items(a):
    t=open(f"agents/{a}.md").read(); fm=yaml.safe_load(t[3:t.find(chr(10)+'---',3)]); tl=fm.get("tools")
    return tl if isinstance(tl,list) else [x.strip() for x in re.split(r',\s*(?![^()]*\))',str(tl)) if x.strip()]
assert "mcp__plugin_webdesk-shopify-apps_shopify-dev-mcp__*" in items("shopify-developer"), items("shopify-developer")
for a in ("orchestrator","pm","architect","designer","qa","code-review","delivery-head"):
    assert not [t for t in items(a) if t.startswith("mcp__")], f"{a} must not hold MCP tools"
for a in ("qa","code-review"):
    assert set(items(a))=={"Read","Grep","Glob"}, f"{a} must be exactly read-only, has {items(a)}"
print(f"  MCP pinned @ {ver}; shopify-developer scoped-MCP only; 7 others none; qa/code-review read-only")
PY

echo "T13: Shopify Dev MCP self-check — server connects, exposes tools, validates (bad=INVALID, good=VALID); NO store, NO auth"
if require node "T13"; then
  if node tools/scripts/mcp-selfcheck.mjs >"$WORK/mcp.txt" 2>/dev/null; then pass "MCP self-check: connectable, tools exposed, bad->INVALID, good->VALID"; else fail "MCP self-check FAILED (executable MCP test must run, never skipped)"; sed 's/^/      /' "$WORK/mcp.txt" 2>/dev/null | tail -8; fi
fi

echo "T14: MCP negative guards — validator must REJECT 5 misconfigurations"
NT="$WORK/mcpneg"; mkdir -p "$NT/p"; cp -a ./. "$NT/p/"; rm -rf "$NT/p/.git"; okn=1
chk(){ if python3 tools/scripts/validate-plugin.py "$NT/p" >/dev/null 2>&1; then echo "    NOT caught: $1"; okn=0; else echo "    caught  : $1"; fi; }
sed 's/, mcp__plugin_webdesk-shopify-apps_shopify-dev-mcp__\*//' agents/shopify-developer.md > "$NT/p/agents/shopify-developer.md"; chk "remove MCP from shopify-developer"; cp -a agents/shopify-developer.md "$NT/p/agents/shopify-developer.md"
sed 's/^tools: \[Read, Grep, Glob\]/tools: [Read, Grep, Glob, mcp__plugin_webdesk-shopify-apps_shopify-dev-mcp__*]/' agents/qa.md > "$NT/p/agents/qa.md"; chk "grant MCP to QA"; cp -a agents/qa.md "$NT/p/agents/qa.md"
sed 's#@shopify/dev-mcp@1.14.5#@shopify/dev-mcp@latest#' .mcp.json > "$NT/p/.mcp.json"; chk "@latest (unpinned) MCP version"; cp -a .mcp.json "$NT/p/.mcp.json"
awk 'NR==6{print "mcpServers: {shopify-dev-mcp: {command: npx}}"}1' agents/architect.md > "$NT/p/agents/architect.md"; chk "mcpServers: in a plugin agent"; cp -a agents/architect.md "$NT/p/agents/architect.md"
sed 's/mcp__plugin_webdesk-shopify-apps_shopify-dev-mcp__\*/mcp__shopify-dev-mcp__*/' agents/shopify-developer.md > "$NT/p/agents/shopify-developer.md"; chk "bare/incorrectly-scoped MCP tool name"; cp -a agents/shopify-developer.md "$NT/p/agents/shopify-developer.md"
[ "$okn" -eq 1 ] && pass "all 5 MCP misconfigurations rejected by the validator" || fail "a MCP misconfiguration slipped through"

echo "T15: MCP evidence gate — positive + honest-BLOCKED + result/gate-command/project-binding rejections (check-dev-handoff.py)"
if require python3 "T15" && python3 -c "import jsonschema" 2>/dev/null; then
  if python3 tests/mcp-evidence-cases.py >"$WORK/ev.txt" 2>&1; then pass "$(grep -c '\[ok\]' "$WORK/ev.txt") MCP-evidence cases behave (positive accepted; honest BLOCKED; all misuses rejected)"; else fail "an MCP-evidence case misbehaved"; sed 's/^/      /' "$WORK/ev.txt" | tail -20; fi
else fail "python jsonschema missing — cannot run T15"; fi

echo "T16: MCP workflow wiring — validate-plugin REJECTS unwired orchestrator, unrequired-QA-evidence, and QA+MCP/Bash"
WW="$WORK/wire"; mkdir -p "$WW/p"; cp -a ./. "$WW/p/"; rm -rf "$WW/p/.git"; okw=1
wchk(){ if python3 tools/scripts/validate-plugin.py "$WW/p" >/dev/null 2>&1; then echo "    NOT caught: $1"; okw=0; else echo "    caught  : $1"; fi; }
# (14) orchestrator does not run the handoff checker
sed 's/check-dev-handoff\.py/DISABLED-checker/g' agents/orchestrator.md > "$WW/p/agents/orchestrator.md"; wchk "orchestrator does not run check-dev-handoff.py"; cp -a agents/orchestrator.md "$WW/p/agents/orchestrator.md"
# (15) QA does not require the MCP evidence artifact
sed 's/mcp-validation-evidence/removed-ref/g; s/MCP validation evidence/removed phrase/g' agents/qa.md > "$WW/p/agents/qa.md"; wchk "QA does not require the MCP evidence artifact"; cp -a agents/qa.md "$WW/p/agents/qa.md"
# (16) QA granted MCP (or Bash) — either breaks read-only-exact + MCP-isolation
sed 's/^tools: \[Read, Grep, Glob\]/tools: [Read, Grep, Glob, Bash]/' agents/qa.md > "$WW/p/agents/qa.md"; wchk "QA granted Bash"; cp -a agents/qa.md "$WW/p/agents/qa.md"
# (B1) bare project-relative checker path (no ${CLAUDE_PLUGIN_ROOT})
sed 's#${CLAUDE_PLUGIN_ROOT}/tools/scripts/check-dev-handoff.py#tools/scripts/check-dev-handoff.py#g' agents/orchestrator.md > "$WW/p/agents/orchestrator.md"; wchk "checker invoked without \${CLAUDE_PLUGIN_ROOT} (bare project-relative)"; cp -a agents/orchestrator.md "$WW/p/agents/orchestrator.md"
# (B1) --root does not target ${CLAUDE_PROJECT_DIR}
sed 's/${CLAUDE_PROJECT_DIR}/some-other-dir/g' agents/orchestrator.md > "$WW/p/agents/orchestrator.md"; wchk "checker --root not \${CLAUDE_PROJECT_DIR}"; cp -a agents/orchestrator.md "$WW/p/agents/orchestrator.md"
# (B6) overstated validate_theme/extension wording
cp -a README.md "$WW/p/README.md"; printf '\nThe validate_theme tool validates extension configuration and theme code.\n' >> "$WW/p/README.md"; wchk "overstated validate_theme/extension wording"; cp -a README.md "$WW/p/README.md"
[ "$okw" -eq 1 ] && pass "workflow-wiring + \${CLAUDE_PLUGIN_ROOT}/\${CLAUDE_PROJECT_DIR} + extension-wording misconfigs all rejected" || fail "a workflow/path/wording misconfiguration slipped through"

echo "T17: scoped-agent allowlist — POSITIVE (exact scoped form accepted) + 5 NEGATIVE mutations (all rejected)"
SA="$WORK/scoped"; mkdir -p "$SA/pos"; cp -a ./. "$SA/pos/"; rm -rf "$SA/pos/.git"; oksa=1
# positive: the shipped orchestrator.md, unmodified, must validate clean
if python3 tools/scripts/validate-plugin.py "$SA/pos" >/dev/null 2>&1; then echo "    accepted (positive): shipped fully-scoped allowlist"; else echo "    NOT accepted (positive): shipped fully-scoped allowlist — should have passed"; oksa=0; fi
mkdir -p "$SA/neg"; cp -a ./. "$SA/neg/"; rm -rf "$SA/neg/.git"
sachk(){ if python3 tools/scripts/validate-plugin.py "$SA/neg" >/dev/null 2>&1; then echo "    NOT caught: $1"; oksa=0; else echo "    caught  : $1"; fi; }
# (n1) bare Agent, no parens at all — allows ALL sub-agents
sed 's/tools: Agent([^)]*)/tools: Agent/' agents/orchestrator.md > "$SA/neg/agents/orchestrator.md"; sachk "bare 'Agent' (no parens, no allowlist)"; cp -a agents/orchestrator.md "$SA/neg/agents/orchestrator.md"
# (n2) the beta.5 regression: every specialist BARE (unscoped) instead of plugin-scoped
sed 's/webdesk-shopify-apps://g' agents/orchestrator.md > "$SA/neg/agents/orchestrator.md"; sachk "all 7 specialists bare/unscoped (the beta.5 defect form)"; cp -a agents/orchestrator.md "$SA/neg/agents/orchestrator.md"
# (n3) missing specialist — drop shopify-developer from the scoped allowlist
sed 's/webdesk-shopify-apps:shopify-developer, //' agents/orchestrator.md > "$SA/neg/agents/orchestrator.md"; sachk "missing specialist (shopify-developer) from scoped allowlist"; cp -a agents/orchestrator.md "$SA/neg/agents/orchestrator.md"
# (n4) extra/non-specialist agent appended, still scoped
sed 's/webdesk-shopify-apps:delivery-head)/webdesk-shopify-apps:delivery-head, webdesk-shopify-apps:general-purpose)/' agents/orchestrator.md > "$SA/neg/agents/orchestrator.md"; sachk "extra non-specialist scoped agent appended"; cp -a agents/orchestrator.md "$SA/neg/agents/orchestrator.md"
# (n5) one entry scoped to the WRONG plugin
sed 's/webdesk-shopify-apps:qa/some-other-plugin:qa/' agents/orchestrator.md > "$SA/neg/agents/orchestrator.md"; sachk "one specialist scoped to a different plugin"; cp -a agents/orchestrator.md "$SA/neg/agents/orchestrator.md"
[ "$oksa" -eq 1 ] && pass "scoped allowlist: positive accepted; bare-Agent/unscoped/missing/extra/wrong-plugin-scope all rejected" || fail "a scoped-allowlist positive/negative case misbehaved"

echo ""
echo "===== EXTERNAL TESTS (NOT EXECUTED — require systems this sandbox lacks) ====="
skip "live Shopify dev-store smoke (tests/shopify-dev-store-smoke.md) — needs a DISPOSABLE dev store + credentials + deployed app"
skip "real end-user cold Claude Code session (tests/cold-plugin-discovery.md) — structural discovery IS covered by T1/T2"

echo ""
echo "===== RESULT: PASSED=$P  FAILED=$F  SKIPPED=$S (skips are external-only, documented) ====="
# Mandatory tests must all pass; only the two external tests may be skipped.
if [ "$F" -eq 0 ] && [ "$S" -eq 2 ]; then echo "ACCEPTANCE OK"; exit 0; else echo "ACCEPTANCE FAILED (failures, or a mandatory test was skipped)"; exit 1; fi
