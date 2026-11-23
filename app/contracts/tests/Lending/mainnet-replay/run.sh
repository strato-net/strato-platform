#!/bin/bash
# Generate a replay from the snapshot in build/ and run it under upquark's rules.
#   ./run.sh [name] [gen_replay.py options]
# SOLID_VM_CLI picks the binary (default: solid-vm-cli on PATH). It must be built from a tree
# that has the per-transaction gas budget (Blockchain.Strato.Model.Gas.transactionGas), or the
# replay cannot tell whether a call fits in a transaction.
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
CLI="${SOLID_VM_CLI:-solid-vm-cli}"
name="Replay"
if [ $# -gt 0 ] && [ "${1#--}" = "$1" ]; then name="$1"; shift; fi
[ -f "$HERE/build/chain/codeIndex.json" ] || python3 "$HERE/fetch.py"
python3 "$HERE/gen_replay.py" --name "$name" "$@"

# A code collection stored as separate files keeps its import lines. The node ignores the ones it
# cannot resolve inside the collection; the test runner would read them from disk, so they get
# empty files, under a working directory deep enough for their ../ to stay inside build/.
work="$HERE/build/replay/cwd/a/b/c"
mkdir -p "$work"
python3 - "$HERE/build/replay/stub_imports.json" "$work" <<'PY'
import json, os, sys
for p in json.load(open(sys.argv[1])):
    f = os.path.normpath(os.path.join(sys.argv[2], p))
    os.makedirs(os.path.dirname(f), exist_ok=True)
    open(f, "a").close()
PY

log="$HERE/build/replay/$name.log"
cd "$work"
set +e
STRATO_CONF="${STRATO_CONF:-$HERE/build/replay/upquark.json}" "$CLI" test "$HERE/build/replay/$name.replay.sol" > "$log" 2>&1
status=$?
set -e
echo "passed $(grep -c '✅' "$log")  failed $(grep -c '❌' "$log")  -> $log"
grep -v '✅' "$log" | cut -c1-400 | head -20
exit $status
