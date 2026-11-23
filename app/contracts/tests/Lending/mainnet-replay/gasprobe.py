#!/usr/bin/env python3
"""Measure the gas each sunset call of the replay uses.

The VM reports no gas figure, so a calibrated loop burns gas in the same transaction as the
executing vote and a bisection finds the largest burn the transaction still survives.

Usage: gasprobe.py [call numbers, default all] [-- gen_replay.py options]
"""
import os, re, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
CLI = os.environ.get("SOLID_VM_CLI", "solid-vm-cli")
BUILD = os.path.join(HERE, "build", "replay")
BUDGET = 600000   # Blockchain.Strato.Model.Gas.transactionGas

def calibrate():
    """Iterations of GasBurner.burn that exactly fill one transaction."""
    lo, hi = 1000, 200000
    src = "contract GasBurner {\n    function burn(uint n) public returns (uint x) {\n        for (uint i = 0; i < n; i++) { x += i; }\n        return x;\n    }\n}\n"
    while hi - lo > 10:
        mids = sorted({lo + (hi - lo) * k // 9 for k in range(1, 9)})
        body = "".join("    function it_n%07d() { b.burn(%d); }\n" % (n, n) for n in mids)
        os.makedirs(BUILD, exist_ok=True)
        open(os.path.join(BUILD, "Calib.replay.sol"), "w").write(src + "contract Describe_Calib {\n    GasBurner b;\n    function beforeAll() { b = new GasBurner(); }\n" + body + "}\n")
        out = subprocess.run([CLI, "test", "Calib.replay.sol"], cwd=BUILD, env=dict(os.environ, STRATO_CONF=os.path.join(BUILD, "upquark.json")), capture_output=True, text=True).stdout
        ok = {int(n) for n in re.findall(r"✅ \d+\. Unit test 'n(\d+)'", out)}
        if "run out of gas" not in out and not ok:
            sys.exit("this solid-vm-cli has no per-transaction gas budget; build one from a current tree and set SOLID_VM_CLI\n" + out[-400:])
        lo = max([lo] + [n for n in mids if n in ok])
        hi = min([hi] + [n for n in mids if n not in ok])
    return lo

def run(call, burn, extra):
    subprocess.run([os.path.join(HERE, "run.sh"), "Probe", "--burn", str(burn), "--burn-call", str(call)] + extra, capture_output=True, text=True)
    lines = [l for l in open(os.path.join(BUILD, "Probe.log")).read().splitlines() if re.search(r" step 10 call %d vote \d+ executes'" % call, l)]
    return lines[0] if lines else None

def measure(call, nmax, extra):
    first = run(call, 0, extra)
    if first is None or "succeeded" not in first:
        return None, first
    lo, hi = 0, nmax   # lo fits, hi does not
    while hi - lo > 4:
        mid = (lo + hi) // 2
        r = run(call, mid, extra)
        assert "succeeded" in r or "run out of gas" in r, r
        if "succeeded" in r: lo = mid
        else: hi = mid
    return lo, first

if __name__ == "__main__":
    argv = sys.argv[1:]
    extra = []
    if "--" in argv:
        extra = argv[argv.index("--") + 1:]; argv = argv[:argv.index("--")]
    subprocess.run([os.path.join(HERE, "run.sh"), "Probe"] + extra, capture_output=True, text=True)
    log = open(os.path.join(BUILD, "Probe.log")).read()
    calls = [int(c) for c in argv] or sorted({int(c) for c in re.findall(r" step 10 call (\d+) vote \d+ executes'", log)})
    nmax = calibrate()
    per = BUDGET / nmax
    for call in calls:
        n, first = measure(call, nmax, extra)
        if n is None:
            print("call %d: %s" % (call, re.sub(r".*failed: ", "", first or "not in the replay")[:140]))
        else:
            used = BUDGET - n * per
            print("call %d: ~%d gas, %d%% of the %d a transaction gets" % (call, used, round(100 * used / BUDGET), BUDGET))
