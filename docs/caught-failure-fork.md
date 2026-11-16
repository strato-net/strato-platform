# Caught-failure execution fork

This change gates the behavior introduced by `5020fd28897` as a single execution
rule. Before activation, successful calls inside a subsequently failing `try`
block retain their writes, actions/events remain transaction-wide, sender
restoration follows the historical path, and destruction purges pending storage
immediately. At and after activation, the entire failed frame is discarded,
including events/Cirrus action records and pending destruction effects, and
sender identity is scoped to the frame. Both interpreter and native execution
use the same network/height decision.

`Blockchain.Forks.caughtFailureForkBlock` deliberately leaves **Helium and
Upquark unscheduled** (`forkNotScheduled`). The existing throwaway fork-test
network switches at 10000; new networks use the hardened rules from genesis.
These are consensus settings, not local operator overrides. Before deployment,
reconcile actual canonical history and validator binary deployment times: a
network that already produced blocks using the new rules may need an activation
boundary matching that history. Do not arbitrarily activate immediately after
the first failing replay block, or deploy the unscheduled draft as a production
security fix.

The concrete historical conflict is Upquark block 355722, transaction
`d679348f0403ce0c5088ad732a47ec1221eacace8a0399a9c7d2de2113795de9`.
MakerWallet cancels an offer, then approves 666666666667000000 OutcomeToken units
inside a try block before order creation fails on an expired market. The
canonical allowance remains; unconditional atomic rollback removes it. The
hash-verified state diff isolates this single slot. Changing the contract now
cannot change that committed transaction. A coordinated activation preserves
historical verification while introducing stronger semantics for new blocks.

## Validation

Build from the repository root:

```sh
make build_common_with_tests BUILD_TEST_TARGETS='solid-vm:test:caught-failure-fork-check solid-vm-native:test:caught-failure-fork-check solid-vm-fuzzer:exe:solid-vm-cli'
python3 strato/VM/SolidVM/solid-vm/fork-test/run.py --output /tmp/caught-failure-tests
```

Omit `BUILD_TEST_TARGETS` for the existing all-package test build.
`CaughtFailureForkSpec` is included in `solid-vm-spec` and compiled against
both `solid-vm` and `solid-vm-native` as `caught-failure-fork-check`. Run each executable in separate
processes with `STRATO_CONF` containing `networkConfig.networkID` set to:

- Helium: 114784819836269
- Upquark: 33056204878082667
- Fork-test: 7381244120123405172
- Private test network: 42

The tests use the actual configured activation height minus one, exactly the
height, and plus one, plus historical height 355722 on the public networks.
The sentinel boundary is synthetic, not a scheduled public-network activation.
They cover the approval/caught-failure pattern, protective
writes preceding try, leaked events, sender restoration, failed external and
internal callee storage/account changes, nested catches, and caught destruction
of pending storage. These are reduced
behavioral fixtures, not a claim to have replayed the full historical block.
The runner creates complete isolated configs and saves each process's output.

Validated locally on 2026-11-15: the focused root-make build succeeded;
120 boundary/historical-height checks passed across both engines and all four
network configurations; the existing hardened `TryCatch.test.sol` suite passed
28/28. The all-package test build remains blocked by unrelated existing errors
in `blockapps-mpdbs/test/StorageSpec.hs` (hidden `statedb-monad` dependency and
removed `Blockchain.Strato.Model.Account` import) and
`blockDB` tests (missing `Arbitrary OutputBlock` instance and removed
`BlockData'` type).

Validated on Linux on 2026-11-15: the repository-root production image build
and the same 120 regression checks plus 28 TryCatch tests passed. The audit node
is replaying Upquark from genesis using commit `a559256501b1`, with no snapshot,
reused chain/database state, or validation bypass. At 23:48 UTC the accepted VM
head was 368798; hashes, state roots and parent hashes at 355721, 355722 and
355723 exactly matched two independent mainnet nodes. Cirrus subsequently
durably indexed the formerly failing transaction, including its historical
Approval and PostSkipped events.

Full Upquark sync was verified at 2026-11-16 02:27 UTC: accepted VM, SQL and
durable Cirrus all reached 994340, all 108 recorded checkpoints matched, and
a fresh comparison at 994334 matched both independent nodes. The
[replay proof](caught-failure-fork-upquark-proof.md) includes exact hashes/roots,
385 recorded progress samples starting at block 0, binary provenance and
read-only reproduction commands. No validation failure was recorded.

A subsequent review found that native internal calls lacked the interpreter's
storage/account frame before activation. The shared reproduction executes
`try { keep(); fail(); } catch {}`: `keep()` writes 1, and `fail()` writes 2 then
throws. Before the correction, the interpreter returned 1 and native returned 2.
Native internal calls now use the shared call-frame primitive before activation,
merging successful calls and discarding only failed callees. Historical events
remain transaction-wide; post-activation atomic rollback is unchanged. A second
fixture checks that a caught internal destruction preserves the account while
retaining historical storage-purge behavior before activation.

Re-review of that correction found that `ForwardReturn`, the native control-flow
signal for a successful dynamic return, escaped the new frame and discarded its
writes. The regression forwards an external result of 42 after writing 7;
before the fix, both engines returned 42 but native persisted 0 before activation.
The existing typed-return decoder now runs inside the legacy internal frame,
so successful forwarding commits normally and actual exceptions still discard
the frame. The independent failed-call reproduction also checks a separate
getter: both engines return and persist the caller's original value of 3.

Validated on macOS on 2026-11-16: the focused repository-root build and all
224 engine/network checks plus 28 TryCatch tests passed. The failed-call and
forwarding fixtures each reproduced five native pre-activation failures before
their respective fixes and passed in the interpreter.
These corrections have not been deployed or replayed;
the full Upquark evidence above and the Linux results apply to `a559256501b1`.

Before release: replay the updated execution code from genesis on Upquark and
Helium with canonical hash/root comparisons and durable Cirrus coverage, then
coordinate activation heights against actual validator deployment history.
Both public-network heights remain unscheduled. Do not skip validation or
substitute a snapshot for replay.

Historical rules cannot simply be deleted while retaining genesis replay. They
can later be isolated in a versioned historical executor, provided the same
canonical execution results remain reproducible. No contract/address/transaction
allowlist or per-block root override is introduced here.
