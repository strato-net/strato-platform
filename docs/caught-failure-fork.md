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
writes preceding try, leaked events, sender restoration, failed callee storage,
nested catches, and caught destruction of pending storage. These are reduced
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

Before release: run the existing hardened TryCatch suite, both engine boundary
fixtures, and clean genesis replays on both public networks with canonical
hash/root comparisons and durable Cirrus coverage. Full historical block replay
and clean network sync have not been performed with this patch. Do not skip
validation or substitute a snapshot for the genesis replay.

Historical rules cannot simply be deleted while retaining genesis replay. They
can later be isolated in a versioned historical executor, provided the same
canonical execution results remain reproducible. No contract/address/transaction
allowlist or per-block root override is introduced here.
