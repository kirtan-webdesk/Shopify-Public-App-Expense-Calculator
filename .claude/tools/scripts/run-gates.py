#!/usr/bin/env python3
"""run-gates.py — deterministic local-gate runner for a Shopify app repo.

Runs the four MANDATORY package scripts by their EXACT names, using argument arrays with
`shell=False` (no shell wrappers, operators, or interpolation), captures stdout+stderr to a
log per gate, records the REAL subprocess exit code, appends a machine-readable
`__GATE_EXIT__:<code>` marker, and writes a structured gate manifest with the SHA-256 that
`check-dev-handoff.py` consumes. The developer runs this in ${CLAUDE_PROJECT_DIR}; its output
feeds the evidence artifact's `local_gates`.

Honest limitation: this produces *consistency-checked local evidence* (the recorded exit code
is the real subprocess exit code, and the log hash binds the captured output) — it is not
cryptographically authenticated execution.

Usage: run-gates.py --root <project-dir> [--outdir app/.gates]
"""
import os, sys, json, hashlib, subprocess, argparse

# Fixed, mandatory gate -> argv. Mirrors .github/workflows/app-ci.yml. shell=False.
GATES = {
    "lint":      (["npm", "run", "lint"],      "npm run lint"),
    "typecheck": (["npm", "run", "typecheck"], "npm run typecheck"),
    "tests":     (["npm", "test"],             "npm test"),
    "build":     (["npm", "run", "build"],     "npm run build"),
}


def sha256_file(p):
    h = hashlib.sha256()
    with open(p, "rb") as fh:
        for chunk in iter(lambda: fh.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", required=True)
    ap.add_argument("--outdir", default=os.path.join("app", ".gates"))
    a = ap.parse_args()
    root = os.path.realpath(a.root)
    outdir_rel = a.outdir
    outdir = os.path.join(root, outdir_rel)
    os.makedirs(outdir, exist_ok=True)

    manifest = {"root": root, "gates": {}}
    for gate, (argv, cmd_str) in GATES.items():
        log_rel = os.path.join(outdir_rel, f"{gate}.log")
        log_abs = os.path.join(root, log_rel)
        try:
            p = subprocess.run(argv, cwd=root, shell=False, capture_output=True, text=True)
            code = p.returncode
            body = p.stdout + p.stderr
        except FileNotFoundError as e:
            code = 127
            body = f"command not found: {e}\n"
        with open(log_abs, "w", encoding="utf-8") as fh:
            fh.write(body)
            if not body.endswith("\n"):
                fh.write("\n")
            fh.write(f"__GATE_EXIT__:{code}\n")   # machine-readable, bound by the checker
        manifest["gates"][gate] = {
            "gate": gate, "command": cmd_str, "argv": argv, "exit_code": code,
            "status": "pass" if code == 0 else "fail",
            "output_ref": log_rel.replace(os.sep, "/"), "output_sha256": sha256_file(log_abs),
        }

    man_path = os.path.join(outdir, "manifest.json")
    json.dump(manifest, open(man_path, "w"), indent=2)
    print(json.dumps(manifest["gates"], indent=2))
    print(f"\nmanifest: {os.path.relpath(man_path, root)}")
    # non-zero overall exit if any gate failed, so CI/callers notice
    sys.exit(0 if all(g["exit_code"] == 0 for g in manifest["gates"].values()) else 1)


if __name__ == "__main__":
    main()
