# Thin Windows wrapper around the plugin's run-gates.py: subprocess.run(["npm", ...], shell=False) cannot resolve npm.cmd on
# Windows, so this only swaps argv[0] "npm" for the resolved npm.cmd path. Command strings, exit codes, __GATE_EXIT__ markers and
# SHA-256s are run-gates.py's own. usage: python run-gates-win.py --root <repo> --outdir <relative outdir>
import importlib.util, os, shutil, sys
os.environ.setdefault("PYTHONUTF8", "1")
spec = importlib.util.spec_from_file_location("run_gates", r"C:/Users/Admin/.claude/plugins/cache/wsa-local/webdesk-shopify-apps/0.1.8-beta.6/tools/scripts/run-gates.py")
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
npm = shutil.which("npm.cmd") or r"C:\nvm4w\nodejs\npm.cmd"
m.GATES = {k: ([npm] + argv[1:], cmd) for k, (argv, cmd) in m.GATES.items()}
m.main()
