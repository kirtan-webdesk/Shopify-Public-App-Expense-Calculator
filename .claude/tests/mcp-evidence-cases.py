#!/usr/bin/env python3
"""mcp-evidence-cases.py — full matrix for tools/scripts/check-dev-handoff.py (v0.1.8-beta.5).

Builds real fixtures (files, gate logs with the __GATE_EXIT__ marker, a structured validation
record with an authoritative result.status, a project.json), runs the checker, and asserts the
exit code (0=accept, 3=blocked, 1=reject). Preserves the beta.2/3/4 regressions and adds:
  B10 result.status is the single authoritative status (no contradicting result/summary),
  B11 exact gate->command mapping + log-exit binding + no reused output,
  B12 evidence bound to project.json distribution + api_version, graphql conversation_id bound.
"""
import os, sys, json, hashlib, tempfile, shutil, subprocess

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CHECKER = os.path.join(ROOT, "tools", "scripts", "check-dev-handoff.py")
SCHEMA = os.path.join(ROOT, "tools", "schemas", "mcp-validation-evidence.schema.json")
PROJECT_FIXTURE = json.load(open(os.path.join(ROOT, "tests", "fixtures", "public-app-min", "project.json")))
COMMIT = "abc123def4567890"
PFX = "mcp__plugin_webdesk-shopify-apps_shopify-dev-mcp__"
GTOOL = PFX + "validate_graphql_codeblocks"
CONV = "conv-45958eea-abc"
API_VER = "2026-07"


def sha(b): return hashlib.sha256(b).hexdigest()
def shafile(p): return sha(open(p, "rb").read())
def writef(p, s):
    os.makedirs(os.path.dirname(p), exist_ok=True); open(p, "w").write(s); return p


REQ_CMD = {"lint": "npm run lint", "typecheck": "npm run typecheck", "tests": "npm test", "build": "npm run build"}


def gate(root, name, status="pass", code=0, cmd=None, marker=None, ref=None):
    ref = ref or f"app/.gates/{name}.log"
    mk = code if marker is None else marker
    log = writef(os.path.join(root, ref), f"$ {REQ_CMD[name]}\n...output...\n__GATE_EXIT__:{mk}\n")
    return {"status": status, "command": cmd or REQ_CMD[name], "exit_code": code,
            "output_ref": ref, "output_sha256": shafile(log)}


def record(root, event):
    rp = writef(os.path.join(root, "app", "rec.json"), json.dumps({"record_version": "1.0.0", "event": event}))
    return {"record_ref": "app/rec.json", "sha256": shafile(rp)}


def project(root, distribution="public", api=API_VER):
    p = json.loads(json.dumps(PROJECT_FIXTURE))
    p["project"]["shopify"]["distribution"] = distribution
    p["project"]["shopify"]["api_version"] = api
    writef(os.path.join(root, "project.json"), json.dumps(p))


def build(root, api=API_VER):
    q = writef(os.path.join(root, "app", "q.graphql"), "query { shop { name } }\n")
    qh = shafile(q)
    project(root, "public", api)
    evt = {"tool_call_id": "toolu_01ABC", "tool": GTOOL, "validator_type": "graphql",
           "api": "admin", "conversation_id": CONV, "validated_input_sha256": [qh],
           "result": {"status": "VALID", "summary": "Successfully validated against schema", "errors": []}}
    ev = {
        "schema_version": "1.0.0", "distribution_type": "public", "api_version": api,
        "commit_sha": COMMIT, "executed_at_utc": "2026-08-21T10:00:00Z",
        "executor": "claude-code-session-abc", "session_id": "sess-1",
        "local_gates": {g: gate(root, g) for g in ("lint", "typecheck", "tests", "build")},
        "validations": [{
            "mcp_tool": GTOOL, "tool_call_ref": "toolu_01ABC", "validator_type": "graphql",
            "conversation_id": CONV, "validated_files": [{"path": "app/q.graphql", "sha256": qh}],
            "status": "VALID", "record": record(root, evt),
        }],
        "overall_status": "VALID", "remaining_warnings": [], "live_store_items": ["dev-store smoke"],
    }
    return ev, {"q": q, "qh": qh}


def set_record(root, ev, **event_over):
    """Rewrite the record with overrides, refresh its hash in the evidence."""
    rp = os.path.join(root, "app", "rec.json"); rec = json.load(open(rp)); rec["event"].update(event_over)
    open(rp, "w").write(json.dumps(rec)); ev["validations"][0]["record"] = {"record_ref": "app/rec.json", "sha256": shafile(rp)}


HANDOFF = ("Distribution type: {dist}\nShopify API version: 2026-07\nFiles validated: app/q.graphql\n"
           "Validation result: {res}\nCommit SHA: abc123def4567890\nRemaining warnings: none\n"
           "Live-store items: smoke\n{extra}MCP-Evidence: ev.json\n")


def write(root, ev, dist="public App Store app", res="VALID", extra="", ev_name="ev.json"):
    json.dump(ev, open(os.path.join(root, ev_name), "w"))
    open(os.path.join(root, "h.md"), "w").write(HANDOFF.format(dist=dist, res=res, extra=extra))


def run(root, commit=COMMIT):
    p = subprocess.run([sys.executable, CHECKER, os.path.join(root, "h.md"),
                        "--commit", commit, "--root", root, "--schema", SCHEMA], capture_output=True, text=True)
    out = (p.stdout + p.stderr).strip().splitlines()
    return p.returncode, (out[0] if out else "")


CASES = []
def case(name, expect, fn): CASES.append((name, expect, fn))


# ---------- positive + BLOCKED ----------
case("POSITIVE public+VALID, structured record + project.json", 0, lambda r: write(r, build(r)[0]))

def _block(r):
    ev, _ = build(r); ev["overall_status"] = "BLOCKED"; ev["validations"] = []
    write(r, ev, res="BLOCKED: SHOPIFY MCP VALIDATION NOT EXECUTED", extra="Note: mcp offline\n")
case("honest BLOCKED", 3, _block)

def _custblock(r):
    ev, _ = build(r); ev["distribution_type"] = "custom"; ev["overall_status"] = "BLOCKED"; ev["validations"] = []
    write(r, ev, dist="custom", res="BLOCKED: SHOPIFY MCP VALIDATION NOT EXECUTED", extra="Note: out of scope\n")
case("custom + BLOCKED (allowed only as BLOCKED)", 3, _custblock)

# ---------- strict semantics ----------
def _invalid(r):
    ev, _ = build(r); ev["validations"][0]["status"] = "INVALID"; ev["overall_status"] = "INVALID"
    set_record(r, ev, result={"status": "INVALID", "summary": "field errors", "errors": [{"message": "bad field"}]})
    write(r, ev, res="INVALID")
case("overall INVALID must not proceed", 1, _invalid)

for g in ("lint", "typecheck", "tests", "build"):
    case(f"gate {g} = skip must not proceed", 1,
         (lambda gn: (lambda r: (lambda ev: (ev["local_gates"].__setitem__(gn, gate(r, gn, status="skip")), write(r, ev)))(build(r)[0])))(g))

def _gatefail(r):
    ev, _ = build(r); ev["local_gates"]["build"] = gate(r, "build", status="fail", code=2, marker=2); write(r, ev)
case("gate build = fail must not proceed", 1, _gatefail)

def _custvalid(r):
    ev, _ = build(r); ev["distribution_type"] = "custom"; write(r, ev, dist="custom")
case("custom + VALID must never be accepted", 1, _custvalid)

def _extvalid(r):
    ev, _ = build(r); ev["distribution_type"] = "extension-only"; write(r, ev, dist="extension-only")
case("extension-only + VALID must never be accepted", 1, _extvalid)

# ---------- validator_type <-> tool ----------
def mk_mismatch(vt, suffix):
    def f(r):
        ev, _ = build(r); ev["validations"][0]["validator_type"] = vt; ev["validations"][0]["mcp_tool"] = PFX + suffix
        set_record(r, ev, tool=PFX + suffix, validator_type=vt)
        write(r, ev)
    return f
case("graphql type + validate_theme tool", 1, mk_mismatch("graphql", "validate_theme"))
case("theme type + validate_graphql tool", 1, mk_mismatch("theme", "validate_graphql_codeblocks"))
case("polaris-component type + validate_graphql tool", 1, mk_mismatch("polaris-component", "validate_graphql_codeblocks"))
case("learn_shopify_api used as a validator", 1, mk_mismatch("graphql", "learn_shopify_api"))

# ---------- path containment ----------
def _absfile(r):
    ev, _ = build(r); ev["validations"][0]["validated_files"] = [{"path": "/etc/hostname", "sha256": sha(b"x")}]; write(r, ev)
case("absolute validated-file path", 1, _absfile)
def _dotdot(r):
    ev, _ = build(r); ev["validations"][0]["validated_files"] = [{"path": "../outside.graphql", "sha256": sha(b"x")}]; write(r, ev)
case("'..' traversal validated-file path", 1, _dotdot)
class SymlinkUnsupported(Exception):
    """Raised when the host cannot create a symlink (e.g. Windows without Developer
    Mode / elevation) — the case is SKIPPED, never silently marked pass or fail."""


def _symlink(r):
    # Requires a Unix-style /etc/hostname AND unprivileged symlink creation —
    # neither holds on stock Windows (no /etc; os.symlink needs Developer Mode
    # or elevation). Skip cleanly there rather than fail on an environment gap.
    if not os.path.isfile("/etc/hostname"):
        raise SymlinkUnsupported("no /etc/hostname on this platform")
    ev, _ = build(r)
    try:
        os.symlink("/etc", os.path.join(r, "link"))
    except FileExistsError:
        pass
    except OSError as e:
        raise SymlinkUnsupported(str(e)) from e
    ev["validations"][0]["validated_files"] = [{"path": "link/hostname", "sha256": shafile("/etc/hostname")}]; write(r, ev)
case("symlink escape validated file", 1, _symlink)
def _absev(r):
    ev, _ = build(r); absev = os.path.join(r, "abs_ev.json"); json.dump(ev, open(absev, "w"))
    open(os.path.join(r, "h.md"), "w").write(HANDOFF.format(dist="public", res="VALID", extra="").replace("MCP-Evidence: ev.json", f"MCP-Evidence: {absev}"))
case("absolute MCP-Evidence path", 1, _absev)

# ---------- provenance / structural ----------
case("commit mismatch", 1, lambda r: write(r, build(r)[0]))
def _filehash(r):
    ev, p = build(r); write(r, ev); open(p["q"], "a").write("MUTATED\n")
case("validated-file hash mismatch", 1, _filehash)
case("missing MCP evidence file", 1, lambda r: (write(r, build(r)[0]), os.remove(os.path.join(r, "ev.json")))[0])
def _bare(r):
    build(r); open(os.path.join(r, "h.md"), "w").write("Distribution type: public\nShopify API version: 2026-07\n"
        "MCP tools used: validate_graphql_codeblocks\nValidation result: VALID\nCommit SHA: abc123def4567890\n"
        "Remaining warnings: none\nLive-store items: smoke\n")
case("bare tool-name claim, no evidence artifact", 1, _bare)
def _missgate(r):
    ev, _ = build(r); del ev["local_gates"]["lint"]; write(r, ev)
case("missing lint gate (schema)", 1, _missgate)
case("BLOCKED and VALID in same handoff", 1, lambda r: write(r, build(r)[0], extra="Note: BLOCKED pending review\n"))
case("NOT EXECUTED + PASSED contradiction", 1, lambda r: write(r, build(r)[0], res="PASSED", extra="Status: NOT EXECUTED\n"))

# ---------- beta.4 record authenticity ----------
def _b9_plain(r):
    ev, _ = build(r); tp = writef(os.path.join(r, "app", "rec.json"), "plain text with tokens VALID")
    ev["validations"][0]["record"] = {"record_ref": "app/rec.json", "sha256": shafile(tp)}; write(r, ev)
case("B9 plain-text record (not JSON)", 1, _b9_plain)
def _b9_idmis(r):
    ev, _ = build(r); set_record(r, ev, tool_call_id="toolu_DIFFERENT"); write(r, ev)
case("B9 record tool-call id != evidence", 1, _b9_idmis)
def _b9_inmis(r):
    ev, _ = build(r); set_record(r, ev, validated_input_sha256=[sha(b"different")]); write(r, ev)
case("B9 record input hash != validated file", 1, _b9_inmis)
def _b9_dupe(r):
    ev, _ = build(r); ev["validations"].append(json.loads(json.dumps(ev["validations"][0]))); write(r, ev)
case("B9 duplicate tool-call id across validations", 1, _b9_dupe)

# ---------- B10 authoritative result.status ----------
def _b10_status_mismatch(rec_status):
    def f(r):
        ev, _ = build(r)
        set_record(r, ev, result={"status": rec_status, "summary": "x", "errors": []}); write(r, ev)  # evidence VALID
    return f
case("B10 result.status INVALID + evidence VALID", 1, _b10_status_mismatch("INVALID"))
case("B10 result.status BLOCKED + evidence VALID", 1, _b10_status_mismatch("BLOCKED"))
def _b10_summary(r):
    ev, _ = build(r); set_record(r, ev, result={"status": "VALID", "summary": "Overall Status: INVALID", "errors": []}); write(r, ev)
case("B10 summary declares INVALID while status VALID", 1, _b10_summary)
def _b10_errors(r):
    ev, _ = build(r); set_record(r, ev, result={"status": "VALID", "summary": "ok", "errors": [{"message": "blocking"}]}); write(r, ev)
case("B10 VALID result with non-empty errors", 1, _b10_errors)
def _b10_missing(r):
    ev, _ = build(r); set_record(r, ev, result={"summary": "ok", "errors": []}); write(r, ev)
case("B10 missing result.status (schema)", 1, _b10_missing)
def _b10_string(r):
    ev, _ = build(r); set_record(r, ev, result="developer says it passed"); write(r, ev)
case("B10 arbitrary result string (schema)", 1, _b10_string)
def _b10_overall(r):
    ev, _ = build(r); v2 = json.loads(json.dumps(ev["validations"][0])); v2["status"] = "INVALID"; v2["tool_call_ref"] = "toolu_2"
    # give v2 its own record with INVALID result
    qh = ev["validations"][0]["validated_files"][0]["sha256"]
    evt2 = {"tool_call_id": "toolu_2", "tool": GTOOL, "validator_type": "graphql", "api": "admin", "conversation_id": CONV,
            "validated_input_sha256": [qh],
            "result": {"status": "INVALID", "summary": "e", "errors": [{"message": "e"}]}}
    rp2 = writef(os.path.join(r, "app", "rec2.json"), json.dumps({"record_version": "1.0.0", "event": evt2}))
    v2["record"] = {"record_ref": "app/rec2.json", "sha256": shafile(rp2)}
    ev["validations"].append(v2); write(r, ev)  # overall VALID but a validation INVALID
case("B10 overall VALID with a non-VALID validation", 1, _b10_overall)

# ---------- B11 gate command / log binding ----------
def _b11(cmd=None, marker=None, code=None, status=None, dupe=False, badhash=False, gname="lint"):
    def f(r):
        ev, _ = build(r)
        g = gate(r, gname, status=status or "pass", code=code if code is not None else 0,
                 cmd=cmd, marker=marker)
        if dupe: g["output_ref"] = ev["local_gates"]["build"]["output_ref"]  # reuse build's log
        if badhash: g["output_sha256"] = "0" * 64
        ev["local_gates"][gname] = g; write(r, ev)
    return f
case("B11 gate command 'bash -c true'", 1, _b11(cmd="bash -c true"))
case("B11 gate command 'echo passed'", 1, _b11(cmd="echo passed"))
case("B11 lint gate using the build command", 1, _b11(cmd="npm run build"))
case("B11 shell operator appended to required command", 1, _b11(cmd="npm run lint && echo x"))
case("B11 log exit-code != recorded exit_code", 1, _b11(marker=1, code=0))
case("B11 status pass but run failed (exit 1)", 1, _b11(code=1, marker=1, status="pass"))
case("B11 gate output hash mismatch", 1, _b11(badhash=True))
case("B11 reused output_ref across gates", 1, _b11(dupe=True))

# ---------- B12 project.json binding ----------
def _b12_apimis(r):
    ev, _ = build(r, api="2026-07"); ev["api_version"] = "2025-10"; write(r, ev)  # project stays 2026-07
case("B12 evidence api_version != project.json", 1, _b12_apimis)
def _b12_distmis(r):
    ev, _ = build(r); project(r, distribution="custom")  # project non-public -> schema fail / mismatch
    write(r, ev)
case("B12 project.json distribution != public (mismatch/schema)", 1, _b12_distmis)
def _b12_missing(r):
    ev, _ = build(r); os.remove(os.path.join(r, "project.json")); write(r, ev)
case("B12 missing project.json", 1, _b12_missing)
def _b12_malformed(r):
    ev, _ = build(r); open(os.path.join(r, "project.json"), "w").write("{not json"); write(r, ev)
case("B12 malformed project.json", 1, _b12_malformed)
def _b12_noconv_record(r):
    ev, _ = build(r); rp = os.path.join(r, "app", "rec.json"); rec = json.load(open(rp)); del rec["event"]["conversation_id"]
    open(rp, "w").write(json.dumps(rec)); ev["validations"][0]["record"] = {"record_ref": "app/rec.json", "sha256": shafile(rp)}; write(r, ev)
case("B12 graphql record missing conversation_id (schema)", 1, _b12_noconv_record)
def _b12_convmis(r):
    ev, _ = build(r); set_record(r, ev, conversation_id="conv-DIFFERENT"); write(r, ev)
case("B12 conversation_id mismatch record vs evidence", 1, _b12_convmis)
case("B12 POSITIVE public project + matching api_version", 0, lambda r: write(r, build(r)[0]))


def main():
    ok = True
    skipped = 0
    for name, expect, fn in CASES:
        root = tempfile.mkdtemp()
        try:
            fn(root)
            commit = "totally-different-sha" if name == "commit mismatch" else COMMIT
            rc, msg = run(root, commit=commit)
            good = (rc == expect); ok = ok and good
            print(f"  [{'ok' if good else 'XX'}] exit={rc} (want {expect})  {name}")
            if not good: print(f"        -> {msg}")
        except SymlinkUnsupported as e:
            skipped += 1
            print(f"  [--] SKIP (platform cannot create the fixture: {e})  {name}")
        finally:
            shutil.rmtree(root, ignore_errors=True)
    ran = len(CASES) - skipped
    print(f"\n{'ALL' if ok else 'SOME'} {ran} MCP-EVIDENCE CASES RAN "
          f"{'BEHAVE AS EXPECTED' if ok else 'FAILED'}"
          f"{f' ({skipped} skipped — platform cannot create the fixture)' if skipped else ''}")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
