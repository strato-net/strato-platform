# svmc — first working version of the strict SolidVM → Haskell-action compiler

These sections record successive experiments. Current gas implementation and
measurements are in [Canonical gas charging](#canonical-gas-charging-2026-10-05);
earlier statements that gas is unimplemented describe the earlier binaries.

Location: `/tmp/vmqa/svmc` (standalone, outside the repo; built with `./build.sh Main.hs svmc`
against the installed stack packages — reuses the existing parser via
`compileSourceWithAnnotationsWithoutImports`, nothing in the repo touched).

Files: `Core.hs` (375 lines: `Ty`, `Env`/`Ix`, `Sig`/`Fn`, `Dyn`, storage read/write, runtime
interface `RT`), `Compile.hs` (1184 lines: typecheck+compile in one pass over `CodeCollection`),
`Main.hs` (164 lines: mock runtime, `census`, `feechain`).

## What it does

- `compileCollection :: CodeCollection -> CompiledCollection`; per contract a `Map "name/arity" (Either Err Fun)`,
  `Fun name (Sig args r) (Fn args r)` where `Fn '[Address, Integer] Bool = Address -> Integer -> M Bool`.
- Locals are typed `IORef`s in a typed `Env ls`; de Bruijn `Ix ls t`; a declaration extends the type index
  for the rest of the block. No `Value` sum type anywhere at runtime.
- Dynamic only at: tx args, `variadic`, `.call`/`.delegatecall` results, `msg.data` (`TVariadic = [Dyn]`),
  with one `tyEq` check per argument at the boundary (`callDyn`/`fromDyn`).
- Storage: declared type decides decoding (`fromBasic`), stored tags only checked for gross mismatch;
  writes keep the existing format (`toBasic`, zero → `BDefault`); mapping keys encoded exactly like `expToPath`;
  arrays `length` + `Index i`; structs as `Field`s. Storage pointers (`T storage x`, pointer params and
  pointer-returning library functions) are `TRef layout`, layout compared at compile time.
- Supported: ints/bool/address/string/bytes/enum/contract types, memory arrays (`Seq`), structs and tuples
  (typed `HL`), multiple/named returns, destructuring, mappings/arrays/structs in storage, modifiers
  (with `_` semantics: body `return` stashed, modifier continues), `super`, overloads by arity, library calls,
  `using L for T`, public getters (incl. mapping/array keys), events, SolidVM `try{}catch{}` (catch-all),
  `require/assert/revert`, custom-error reverts, variadic-tail parameters, explicit `T(variadic)` conversion,
  casts (int↔bytes32, string↔bytes, int→address, enum↔int), `keccak256(bytes)`, `delete`, `push`.
- Not yet: constructors / base-constructor calls, contract creation (`new`, `create`, `create2`),
  `decimal`, Solidity-style `try f() returns (...) catch`, typed catch clauses, `ecrecover/sha256/ripemd160`,
  `keccak256` over non-bytes (SolidVM hashes the RLP of the values), `block.prevProposer`, gas.

## Fee chain end to end (mock storage, real deployed sources)

`./svmc feechain code` compiles genesis `Decide.sol`, `DeciderState.sol` and the Mercata collection
`21137d33…` (35 contracts, 714 functions; Proxy/Voucher/Token/ERC20 are the ones on the fee path) and runs
`decide` five times through `Decider.decide → DeciderState.payFees → Proxy(0x100e).fallback →
delegatecall Voucher.burn → ERC20._update`, then after the voucher is exhausted the catch path
`ERC20_Template(USDST).transfer → Proxy(0x937e…).fallback → delegatecall Token.transfer →
whenNotPausedOrOwner → super.transfer → _transfer → _update`:

```
decide #1..#3 -> True   voucher balance 3e18 → (deleted), _totalSupply 10e18 → 7e18, event Voucher.Transfer(abc→0, 1e18)
decide #4..#5 -> True   USDST balance 5e16 → 3e16, collector 0 → 2e16, event Token.Transfer(abc→0x100d, 1e16)
```

Observed divergence from SolidVM (reported, not reproduced): SolidVM attributes the transfer event to the
contract whose body is executing (`ERC20`), the compiler attributes it to the most-derived contract (`Token`).

## Census over every deployed code hash (strict mode)

Sources fetched from `/strato-api/eth/v1.2/code/<hash>` for all distinct `code_hash`es in Cirrus
(`contract?select=code_hash,count()`): upquark 150 collections (200,641 contracts), helium 500 (190,889).
"Function instances" count inherited copies separately (that is how the collections are structured);
"distinct bodies" dedupes by (collection, function, line). Full lists: `census/*_report.txt`, summary `census/SUMMARY.txt`.

| | upquark | helium |
|---|---|---|
| function instances compiled | 40,340 (71%) | 221,098 (70%) |
| failed | 16,446 | 92,563 |
| of which TypeError (SolidVM leniency the strict model rejects) | 14,061 | 79,073 |
| of which Unsupported (compiler gap, listed above) | 2,299 | 12,617 |
| of which Unknown | 86 | 873 |

Top strict-mode failures, distinct bodies / instances (upquark; helium in parentheses):

1. `expected address, got contract X` — implicit contract→address: 7,800 / 12,362 (43,684 / 69,748).
   The `onlyOwner` modifier in the OpenZeppelin port does `if (myOwner == this)`, so every `onlyOwner`
   function inherits it.
2. behind (1), with contract→address allowed (`SVMC_LENIENT=1`, measurement only): `expected (), got variadic`
   6,904 / 11,437 (39,095 / 65,024) — the same modifier ends with `return ret;` where `ret` is the `variadic`
   result of `admin.castVoteOnIssue(...)`, i.e. a modifier returning a value for a function declared to return nothing.
   And `expected int, got variadic` 287 (1,493): `.call` results assigned to typed locals without a conversion.
3. `cannot convert address to string` — `string(owner())` in `Ownable._checkOwner`: 88 / 1,372 (385 / 7,444).
4. `cannot convert string to address` 35 (246), `int to string` 22 (94) e.g. `string(x, 16)`.
5. `expected contract X, got address` 38 (200): address passed where a contract type is declared.
6. `destructuring a non-tuple struct` 6 (46).

Compiler gaps (Unsupported), upquark distinct bodies: contract creation 304, `decimal` 164, base-constructor
calls 82 (1,291 instances), solidity-style try/catch 71, `create`/`create2`/`ecrecover` builtins 190,
multi-value `keccak256` 157, `keccak256(string)` 16. One collection fails to parse with the repo parser
(`717671df…`, "unexpected find").

## Decisions taken (to confirm)

- Integers are unbounded `Integer` for every width (SolidVM also does not check overflow); the parser's
  `InlineBoundsCheck` (uint ≥ 0) is honoured on read and on write.
- `super.f` compiles the parent body in the derived contract's context (virtual dispatch), Solidity semantics.
- `try{}catch{}` catches `Revert` only; an external call that reverts rolls back its own writes (EVM semantics;
  SolidVM's catch does not roll back writes made before the throw inside the try block — not yet compared).
- `bytes[i]` is an `Integer` 0..255; `push` on a local array is a typed snoc.
- Gas: not modelled yet.

## 2026-10-04: STRATO integration and live Upquark comparison

The integration and profiling results below used uncommitted changes in
`solid-vm/`, `solid-vm-compiler/`, and node shutdown tooling. Those changes are
kept separately from the native compiler/runtime checkpoint; this package alone
does not provide the blockchain dispatch, metrics, or integration-check command.

The compiler is connected to STRATO's normal SolidVM call dispatch behind
`SOLIDVM_NATIVE=1`; the default remains the interpreter. The adapter uses the
existing `SM` state for storage, action diffs, events, nested calls, delegate
calls, and rollback. No contract-specific Haskell was added. Compilation is
all-or-nothing per contract, including storage and constructors. Unsupported
contracts use the interpreter, and runtime failures are never retried after
native execution starts. Compiled and rejected contracts use a bounded
128-entry cache keyed by code hash, parser fork mode, and contract name.

Four fresh Upquark syncs reached the same pinned target, block **528301**,
with **zero state-root mismatches**. The target's insertion and successful
completion were checked against block hash
`e61dbd03712dbdabac3b6f161ce20fb515c7822e6fba4e95aa0ec7bc00004753`;
its header state root is
`c098241edb08b77bfe4cdddc6f6c3b81d4972912b857e23fb622597b59b87df0`.

| Dispatcher | Mode | Block 1 → 528301, seconds | VM CPU snapshot, seconds |
|---|---|---:|---:|
| Initial | Interpreter | 1509.6 | 1643.7 |
| Initial | Native | 1692.8 | 1715.1 |
| Final | Interpreter | 1683.5 | 1669.2 |
| Final | Native | 1538.2 | 1661.8 |

The initial dispatcher repeated overload scans and function comparisons even
for rejected contracts. Contract overload checks now run on cache misses; function
matching runs only for compiled contracts. The initial pair ran native first,
then interpreted; the final pair reversed that order. Both modes within each
pair used the same binary. Final binary SHA-256:
`fc8b2904e95a111e733adc0ffff3d33f266055b024d9bcd74db2311729a9ba33`.

The final pair shows **8.6% lower wall time**, but VM CPU time is only **0.4%
lower**, and the two interpreter wall times varied by **11.5%**. This establishes
working integration, not a reliable end-to-end speedup yet. CPU values are the
last Prometheus RTS snapshots near the target; they include startup and a small
block overshoot, unlike the pinned block timestamp metric.

The final native snapshot recorded **4,239,927 native calls** and **16,271,511
fallbacks**: approximately **20.7% of tracked dispatches** ran natively. It also
recorded 44 successful and 225 rejected compilation attempts; these counters
are not a census of distinct contracts. Whole-contract rejection substantially
reduces eligibility compared with the historical per-function census above.

`solid-vm-native-check --network=upquark` exercises the real transaction and
storage runtime with fresh in-memory state. All **13 checks** produced identical
returns, events/topics, and action diffs in both modes, covering nested calls,
proxy/delegate calls, child-call rollback, default storage fields, named
returns, struct literals through proxies, and whole-contract fallback. Three
separate runs per mode timed 100 calls to a 10,000-iteration arithmetic loop:
median **0.5172 s interpreted**, **0.1259 s native**, or **4.1× faster**.
Native statement-level gas charging is unfinished, so this is an experimental
performance measurement rather than a production gas-equivalent benchmark.

Live sync exposed three issues that were fixed and covered by regression checks:

- Block 117160: external getter results containing unset storage references
  needed decoding with the declared return type and physical storage address.
- Block 199593: functions falling through their body returned defaults instead
  of their assigned named return values, including internal calls.
- Block 339458: proxy variadic arguments needed to preserve anonymous struct
  literals without looking up an empty type name.

Methodology follows the prior Cursor full-sync notes: use `strato-up` and
`strato-down`, confirm all services are down, fully clear `mynode` between runs,
and measure VM log timestamps for the same block range. VM RTS flags were
`+RTS -T -N4 -A64m -I2 -F1.2 -RTS`. `SVMC_LENIENT`, `SVM_NATIVE_FEES`, and
`SOLIDVM_AST_INTRINSICS` were unset. Builds used root `make`. Shutdown was also
repaired so supervisor interruption during a restart cannot leave recorded
process groups or Docker services behind. The final node is stopped and
`mynode` is cleared.

Logs, metrics, lifecycle records, the sync harness, binary hashes, and exact
results are under `/tmp/solid-vm-native-integration/`; `summary.json` contains
the verified comparison. `initial-{on,off}` preserves the first valid pair,
`native-{on,off}` the final pair, and `native-failed-*` the discarded failing
runs. Gas, complete exception/trace parity, inherited-event behavior, and
compiler coverage remain unfinished; this replay does not certify contracts
or execution paths absent from the tested workload.

## Runtime profile — 2026-10-04

Added opt-in `SOLIDVM_PROFILE=1` counters at function dispatch, labelled by
execution mode, contract name/code hash, and function. Monotonic elapsed
timers record calls, inclusive time, and self time. A per-thread stack subtracts
nested dispatches and their profiling overhead; reverted calls unwind through
the same accounting. The default path does not register timing counters.

Two fresh Upquark syncs used the same binary
`d5aed15b465d8514031ef12435eb0ceecbb1f882909a124cf8b8b49208d96130`
and the previous pinned target, block **528301**. Both inserted the expected
`e61dbd03…` block hash with **zero state-root mismatches**. All 13 correctness
checks matched with profiling enabled in both modes, and again with profiling
disabled. The node was shut down with `strato-down` and `mynode` removed after
each run.

| Profile | Calls | Function self time |
|---|---:|---:|
| Interpreter baseline | 20,630,623 | 452.1 s |
| Native-enabled: interpreter fallback | 16,229,387 | 412.5 s |
| Native-enabled: native execution | 4,227,016 | 43.6 s |

Native accounted for **20.7% of dispatches but 9.6% of measured function self
time**. **80.6% of native calls** were `Decider.decide`,
`DeciderState.payFees`, `DeciderState.getImplContract`, and `ERC20._msgSender`.
Their baseline self times averaged approximately **19.5, 18.4, 5.7, and 1.7 µs
per call**, respectively. These are already inexpensive bodies; nested token
calls are accounted for separately.

Contract versions observed executing natively represented **33.1% of baseline
dispatches but 20.3% of baseline self time** (excluding their constructors).
Matching only function names and code hashes observed executing natively gives
**12.3%** of baseline self time. These are coverage estimates: a supported
contract can still fall back for a particular invocation, and native internal
closure calls are folded into their entry function rather than timed separately.
The contract comparison avoids interpreting that folding as a function speedup.

The expensive baseline work is concentrated elsewhere:

| Contract | Baseline self time | Share | Native status |
|---|---:|---:|---|
| OrderBook | 143.1 s | 31.6% | Interpreter |
| PriceOracle | 80.0 s | 17.7% | Interpreter |
| ERC20 | 33.1 s | 7.3% | Mixed invocations |
| AdminRegistry | 22.9 s | 5.1% | Mostly interpreter |
| Voucher | 22.7 s | 5.0% | Interpreter |

`OrderBook.createOffer` alone contributed **131.5 s / 29.1%** of baseline self
time. Sources fetched by the measured code hashes and compiled through `svmc
census` identify `new Offer`, `new Bid`, and base-constructor calls as compiler
gaps for OrderBook. PriceOracle is rejected on inherited ownership code
(`expected address, got contract PriceOracle`, address-to-string conversion)
and its base-constructor call. Together these two contracts account for
**49.3%** of baseline function time and remain on the interpreter.

This supports the hypothesis that current native coverage is concentrated in
cheap work. The next useful coverage targets are PriceOracle's inherited
ownership/construction support and OrderBook's contract creation. Their timers
also include shared storage, deployment, and call preparation, so enabling them
does not imply all of that time can be eliminated by native execution.

These are elapsed-time workload profiles, not CPU profiles or an uninstrumented
speed benchmark. Profiled pinned sync times were 1738.7 s off and 1760.1 s on;
instrumentation adds overhead. Metrics include a small polling overshoot beyond
the target (final logs reached 528391 off and 528875 on). Timing outside function
dispatch is not measured, and storage/call preparation are not separate buckets.

Artifacts: `/tmp/solid-vm-native-integration/profile-{off,on}/`,
`profile-analysis.json`, `profile-{off,on}.csv`, `analyze-profile.py`,
`profile-sync.py`, and `profile-hot-census.txt` with the fetched deployed sources
in `profile-hot-code/`.

## PriceOracle support — 2026-10-04

PriceOracle now compiles as a whole contract, including both profiled deployed
versions (`824ec4ab…` and `b0f9648b…`). The implementation adds generic support
for contract-to-address conversion, address-to-string conversion, explicit
base-constructor calls, and ownership modifiers forwarding a dynamic voting
result. Live deployment and constructor initialization still use the interpreter;
this does not implement `new` or native contract creation.

Modifier forwarding is an explicit exception to the original strict-return
criterion: the external boundary can preserve a `variadic` result even for a
void function. Typed internal calls decode that result against their declared
signature. A mismatching forwarded result can therefore fail at runtime.
Ordinary mismatches such as `uint x = "string"` still fail compilation, and
whole-contract rejection remains in place.

The integration check now compares **65 returns/events/action-diff snapshots**
per deployed oracle version between separate native-off and native-on processes.
Both versions match exactly. Checks cover ring-buffer wraparound, shrinking and
growing the queue, batch prices, weighted TWAP across distinct timestamps,
freshness boundaries, named timestamp returns, signed division/remainder,
array assignment when shrinking, named struct/enum forwarding through proxies,
voting returns, nested modifier postludes, and typed internal returns.
The genesis source also exercises the real
AdminRegistry/Proxy ownership path and a self-owned proxy upgrade. Profiling
counters confirm that the oracle functions execute natively.

Live replay initially exposed generic call-boundary and arithmetic bugs:

- Block 1: arrays inside proxy arguments were decoded as `variadic` lists,
  causing SolidVM's argument matcher to reject the batch-price call. A boundary
  array representation now preserves the original array shape.
- Block 12949: a typed governance call to its own proxy was treated as a raw
  external call, changing `msg.sender`. Typed calls now use SolidVM's default
  call semantics; low-level `.call` retains raw-call semantics. The standalone
  mock runtime uses the same distinction.
- Block 118981: PoolV3 uses signed division in its tick calculations. Native
  division previously truncated toward zero; SolidVM uses floor division.
  Native now uses the same `div` operator, with negative-operand regression
  checks. Remainder retains SolidVM's `rem` semantics.
- Block 119483: assigning a shorter array in a token metadata update cleared
  old trailing storage slots. SolidVM retains those slots behind the new length;
  native whole-array assignment now does the same. PriceOracle's explicit
  clearing of observations during queue resizing is unchanged.
- Block 145550: a proxy tried to resolve `ActionableEvent` against its own code
  collection, which did not declare that implementation type. Dynamic argument
  conversion now preserves struct names, field values, and enum labels without
  requiring their declarations in the forwarding contract. Typed callee decoding
  still uses its own declarations.

Explicit zero writes also retain their scalar tags in action diffs; normalization
to `BDefault` remains in the existing storage backend. The mock storage now
normalizes all default scalar values too. These changes add no contract-specific
Haskell code. Blockchain dispatch, the runtime adapter, profiling, and the check
executable remain the separate uncommitted integration prototype described above.


### Fresh Upquark replay and timing

Both runs started with an empty `mynode`, used the same binary
(`5e53224a007c3557167b32655c00a2aa4d060fec97a004e5af382530ec4ec1e1`),
and enabled `SOLIDVM_PROFILE=1`. The target was block **528301**, hash
`e61dbd03712dbdabac3b6f161ce20fb515c7822e6fba4e95aa0ec7bc00004753`.
Both inserted that expected block with **zero state-root mismatches**.
Every restart used `strato-down`, full removal of `mynode`, and `strato-up`.
Both runs finished with all node services down and `mynode` removed.

| Measurement | Native off | Native on |
|---|---:|---:|
| Block 1 through 528301 elapsed time | 1753.648 s | 1625.630 s |
| VM CPU time at final metrics scrape | 1750.878 s | 1624.380 s |
| PriceOracle contract self time | 80.340 s | 33.853 s |
| PriceOracle interpreted calls | 4,780,332 | 0 |
| PriceOracle native entry calls | 0 | 336,663 |

PriceOracle contract self time improved **2.37×**. Whole replay elapsed time
fell **7.30%**, and the VM CPU snapshot fell **7.22%**. Native PriceOracle
execution covered all six code hashes encountered in this replay, including
older genesis versions. Native internal calls are folded into their entry
function's timer; compare contract self-time sums, not function call counts
or sums of inclusive time.

This is one profiled pair. Profiling overhead can differ between execution
modes, and the generic compatibility changes also enable contracts beyond
PriceOracle, including proxies and tokens. The whole-sync improvement cannot
be attributed to PriceOracle alone and is not an unprofiled benchmark.
These runs used the native branch's older develop base (`87720e8da4`), missing
the optimizations merged into develop in `d29bcbc316`. The measured gain is
relative to that older baseline; repeat the comparison after merging develop.
The harness stops after observing the target; final metrics include a small
overshoot (off: block 528364, on: block 528643), while elapsed times use the
exact target block. OrderBook remains interpreted and is still the largest
contract cost (149.863 s self time in the native-enabled run).

The root `make build_common` and all four correctness processes completed
successfully. Native remains opt-in with `SOLIDVM_NATIVE=1`; statement-level
gas parity and the previously documented semantic limitations remain unfinished.
No commit was made for this step.

Artifacts: `/tmp/solid-vm-native-integration/priceoracle-{off,on}/`,
`priceoracle-analysis.json`, `analyze-priceoracle.py`, `priceoracle-sync.py`,
and `priceoracle-{old-,}check-{off,on}.log`. The failed replay artifacts preserve
the transactions that motivated the generic fixes above.


## 2026-10-04: Ordinary contract creation

The compiler now accepts `new Contract(...)`, checks its constructor argument
signature, and delegates deployment to STRATO's existing creation path. The
adapter reuses address/nonce allocation, storage initialization, interpreted
constructors, parent initialization, events, and action recording. Argument
execution is deferred until after address allocation, matching SolidVM's order
when an argument itself creates another contract. Salted `new`, `create`, and
`create2` remain unsupported; the standalone mock runtime does not deploy.

The sender builtin now reads the live runtime environment. SolidVM retains the
constructor's sender environment when a failed constructor is caught; using the
native entry frame's original sender produced a different subsequent constructor
argument. The adapter preserves the interpreted behavior, including its existing
partial writes on caught failures.

Whole-contract census coverage for the 408 contract/code-hash versions observed
in the saved Upquark interpreted replay increased from **292 (71.6%)** to
**315 (77.2%)**. These are compilation-eligible versions, including base/library
contexts, rather than counts of deployed addresses or runtime certification.
The census now prints `WHOLE` eligibility, accounting for unsupported overloads
with duplicate arities. One observed version's source still fails to parse.

The 23 newly eligible versions include both OrderBooks, Market, MarketFactory,
PredictDapp, NFTFactory, nine PoolFactory versions, three PoolV3Factory versions,
four TokenFactory versions, and VaultFactory. OrderBook was the largest remaining
interpreted contract in the older profile (149.863 seconds of self time).

Root `make build_common` passed. All four correctness processes passed, with
**71 identical return/event/action snapshots per native-off/native-on pair**,
using both saved PriceOracle versions and the genesis governance collection.
New checks cover constructor inheritance, arguments, storage and events, nested
creation, caught constructor failures, and deployment through delegatecall.
Metrics confirm the creation probes execute natively.

Census and correctness artifacts are under
`/tmp/solid-vm-native-integration/more-contracts-*`.

A fresh native-enabled replay was stopped at the user's request at block
44061, with zero state-root mismatches to that point. This is not a full-chain
validation or a performance comparison. The user's original node directory
was preserved and restored; all node services are stopped.


## 2026-10-04: Expanded Upquark contract support

This supersedes the coverage and unsupported-feature list in the ordinary
creation checkpoint above. Generic support now includes decimal arithmetic and
conversions, salted creation and address derivation, `create`/`create2`, RLP
hashing and ABI encoding, radix/padded string formatting, Solidity-style
catch-all `try` with return bindings, implicit storage aliases, struct
destructuring/getters, raw scalar/tuple/variadic results, and distinct prefix
and postfix increments. The live adapter reuses STRATO's creation, builtin,
storage, and event paths; constructors still execute through the interpreter.

### Compilation and execution checks

The final census covers **150 source collections**, with no parse failures:
**56,948 function instances compile**, three fail, and **2,679 of 2,681
contract/code-hash contexts** pass whole-contract checks. In the saved
interpreted Upquark profile, **407 of 408 observed contexts (99.75%)** now
compile, compared with 292 (71.6%) before this work. These counts include
base/library contexts and are not counts of deployed addresses.

The two rejected contexts are:

- `CN4@27b3164d…`: two functions use `getUserCert`, which no longer exists in
  STRATO. Its other functions remain interpreted through whole-contract fallback.
- `Exploit2@61c24687…`: a function supplies an EVM byte selector to
  `delegatecall`; SolidVM's interface requires a function name. This context
  was not encountered in the saved runtime profile.

Root `make build_common` passed. The real-runtime comparison executable checks
**123 return/event/action snapshots per native-off/native-on pair**; all match
using both saved PriceOracle versions. Checks include the actual Rewards,
YieldVault, StablePool, and genesis governance/proxy sources. The five-decision
fee-chain fixture also passes. An isolated 100 × 10,000-iteration arithmetic
loop took 0.535 seconds interpreted and 0.140 seconds native; this is not a
whole-sync speedup measurement.

The final unprofiled native replay reached block **528301**, hash
`e61dbd03712dbdabac3b6f161ce20fb515c7822e6fba4e95aa0ec7bc00004753`,
with **zero state-root mismatches**, in **1214.015 seconds** from block 1.
The binary SHA-256 is
`6f3048fac15edccfc06ece506ffa881ded9dfd4815d0dfd0a2acd715f5cdd721`.
A separate profiled replay also passed the target, recording 8,321,530 native
entries and 679 interpreted entries. Those interpreted entries were CN4 calls
and helper calls from interpreted constructors; constructor bodies are not
included in these entry counters. Native internal calls are folded into their
entry function's timer.

### Replay divergences fixed

The development replays exposed these generic differences; the final replay
passes every listed block:

| Block | Difference corrected |
|---:|---|
| 17 | An implicit struct alias must write through to storage until rebound. |
| 23176 | STRATO permits sparse storage-array writes without increasing length. |
| 23249 | Address values assigned to contract storage retain their original tag. |
| 48896 | Public struct getters omit array/mapping members and return a tuple. |
| 51185 | Copying an unset storage scalar uses STRATO's legacy assignment behavior. |
| 66105 | `selfdestruct` returns a boolean, even when its result is discarded. |
| 79399 | Governance forwarding retains raw return shapes and variadic packing. |
| 84210 | Postfix increment returns the old value, including queue request IDs. |
| 145550 | Numeric enums inside transaction structs retain numeric wire/storage encoding. |

Inherited events and `super` use the selected parent's execution context. Internal
and `super` calls also update `msg.sig` and entry arguments for `msg.data`.

### Compatibility and remaining limits

Unset scalar assignment is the notable compatibility exception: STRATO can
leave the destination's old scalar intact while writing a `.length` field.
Native explicitly delegates that case to the existing assignment path. This
uses the stored tag to select behavior and therefore deviates from criterion 5.
Numeric enum provenance preserves wire/storage encoding while enum operations
remain typed. Caught constructor failures retain STRATO's sender environment
and partial-write behavior. None of these fixes names a deployed contract.

Constructors remain interpreted, gas/exception/trace parity is unfinished,
and `msg.data` does not yet track parameters reassigned after entry. Typed catch
clauses and unused system/cryptographic builtins remain unsupported; the two
rejected contexts above are the only exclusions found in this source census.
Legacy modifier forwarding can still return a dynamic result inconsistent
with a declared return type; that is an existing strict-typing exception.
The census, state roots, and sampled action comparisons do not establish
complete language or receipt parity. The integration remains opt-in through
`SOLIDVM_NATIVE=1`, and these changes are uncommitted.

Artifacts are under `/tmp/solid-vm-native-integration/`: `features-census-final.log`,
`features-coverage-final.json`, `features-final-{old-,}check-{0,1}.log`,
`features-feechain-final.log`, `features-on-wire-fixed/`, and `features-on-final/`.
Failed `features-*` replay directories retain the divergence evidence.

### Clean performance comparison

All runs used fresh Upquark state, `SOLIDVM_PROFILE=0`, and no handwritten fee
or AST-intrinsic shortcuts. The current native-on and native-off runs used the
same binary; the previous-native runs used the saved pre-feature binary
(`1d9cf8ec8324388826111ed773889d38ee3349b9974fda89d8d72bd7f60208b5`).
Every run completed with zero state-root mismatches over its tested prefix.

| Run | Block at 300 s from block 1 | Block at 300 s including startup | Block 1 → 528301 |
|---|---:|---:|---:|
| Interpreted, current binary | 146254 | 125586 | Not measured unprofiled |
| Previous native, 300 s run | 158920 | 147057 | Not measured in this run |
| Previous native, full replay | 161256 | 144370 | 1251.058 s |
| Expanded native, full replay | 170420 | 161455 | 1214.015 s |

The expanded native run inserted **7.24% more blocks** in the controlled
300-second window than the previous-native short run, and **16.52% more** than
the interpreter. The repeated previous-native prefix illustrates run variance.
Including startup, the expanded run reached **161455**, **3.50% above the
user's 156000 observation**. Startup/peer delays vary, so the block-1 clock is
the controlled comparison; the user's original stopwatch definition is unknown.

The paired full replay was **37.043 seconds shorter (2.96%)** with expanded
native support. Final VM CPU snapshots were 1325.339 seconds previously and
1301.243 seconds now (1.82% lower); these include startup and small target
overshoots, unlike the exact log-derived elapsed time. The full-sync gain is
modest despite the much larger compilation coverage. This is one full pair,
not a statistical benchmark or proof of complete execution parity.

The earlier diagnostic/profiling replays are correctness evidence, not timing
baselines. Their diagnostic writes, profiling, and concurrent builds would
confound a speed comparison. The benchmark node is fully stopped and its
`mynode` removed; the user's original node state remains preserved.

Timing artifacts: `features-{on-final,off-final,on-baseline,on-baseline-full}/`
and `features-performance-final.json` under the artifact directory above.


## Native constructors and strict replay (2026-10-05 UTC)

The compiler now lowers storage initializers, parent-constructor arguments, and
constructor bodies. STRATO retains its existing construction order, default-value
action diffs, and deployment bookkeeping. Typed argument snapshots carry parameter
mutations across stages. Parent signatures supply the context for empty arrays and
contract-to-address arguments. Contracts without a constructor ignore supplied
factory arguments, matching the existing runtime; this fixed the deployment of
`ProbeA` at block 262410. No contract-specific compiler branch was added.

The two remaining rejected contexts now compile their existing failure outcomes:
`getUserCert(...)[key]` reports the removed variable, and low-level byte payloads
report the existing requirement for a string function name. This does not restore
certificate lookup or introduce EVM ABI dispatch. Raw results can also be
destructured into typed locals, including tuple holes. Exact exception-class/text,
gas, and trace parity remain unfinished.

`SOLIDVM_NATIVE=1 SOLIDVM_NATIVE_STRICT=1` prohibits function and constructor
fallback. An unavailable native entry raises `NativeUnavailable`, which bypasses
STRATO's transaction-error handler. A deliberately unsupported SHA256 fixture
verified that this is an engine failure rather than a swallowed transaction error.

Validation through the root `make` build and real SM runtime:

- 150 cached source collections parse; all 56951 function instances and all 2681
  whole-contract contexts compile, including initialization and parent arguments.
- 127 interpreted/native comparisons match returns, events, and action diffs.
  Added cases cover the legacy failures, constructor parameter mutation, and the
  no-constructor deployment with a dummy factory argument.
- The standalone fee-chain fixture completes all five decisions successfully.
- Clean strict replay reached live block **541298**, with **zero function
  fallbacks, zero constructor fallbacks, zero rejected contracts, and zero
  state-root mismatches**. Counters recorded 8952979 native entries and 411230
  constructor stages. The API independently reached the same block; its header
  was 2.715 seconds old when the harness confirmed catch-up.

Final live block hash:
`17bcdf33ad16e4c0755260429941ac01de95149fdbc8b79155e30a51f05ce933`.
State root:
`57cc0545c3f2aed59d10ba2694671128820466c3b5e7fb769d6f25cdf96286e0`.
VM binary SHA256:
`489e61db6950ba53dda256a5d4827e043e6cdc86d90d91e8838eb0c130b8879f`.

| Metric | Previous expanded native | Strict native with constructors |
|---|---:|---:|
| Block at 300 s from block 1 | 170420 | 170163 |
| Block at 300 s including startup | 161455 | 160626 |
| Block 1 to 528301 | 1214.015 s | 1097.312 s |

The matched full-prefix replay was **116.703 seconds shorter (9.61%)**.
The 300-second prefix was essentially unchanged. Including startup, 160626 is
2.97% above the user's 156000 observation, whose exact stopwatch definition is
unknown. These are single-run comparisons, not a statistical benchmark.
Block 1 to the fixed start-of-test tip 540539 took **1130.007 seconds**.
The indexer lagged during replay and needed additional time to catch up after
the VM reached the live tip; this wait is excluded from VM replay timings.

One earlier attempt stopped on a missing P2P header batch at 63500; a clean retry
passed that gap. Another exposed the no-constructor argument mismatch at 262410;
the regression and final replay verify its fix. Neither failed attempt is a
performance baseline. The final node was stopped with `strato-down`, all services
were confirmed down, and its test `mynode` was removed. Original node state is
preserved. Changes remain uncommitted.

Artifacts under `/tmp/solid-vm-native-integration/`:
`features-native-strict-fixed/{metadata.json,caught-up-block.json,metrics.txt,
verified-block-log.txt,comparison.json,vm-runner.log}`, `native-strict-census.log`,
`native-strict-check-{off,on}.log`, and `native-strict-negative.log`.


## Canonical gas charging (2026-10-05)

The compiler now emits the interpreter's charges for statements, expressions,
loop iterations, internal function entry, contract casts, and arithmetic.
Arithmetic uses the same 256-bit limb widths and operand-dependent policies.
Existing STRATO builtin callbacks retain their own charges. Constructor
initializers charge their actual expressions, without synthetic assignment or
function-entry charges.

`RT.rtChargeGas` calls STRATO's existing `decrementGas` using the same gas state
as the surrounding transaction. There is no separate native meter and no
automatic charge on monadic bind. Nested calls and builtins preserve
`SolidException`, including `TooMuchGas`; contract catches handle it without
catching native engine failures. The standalone mock host remains unlimited.

Matching exhaustion points also required matching evaluation order: argument
evaluation precedes callee lookup; division/modulo preserve the interpreter's
repeated right-operand evaluation; assignment destinations and indices are
resolved before writing; storage/aggregate aliases preserve parent lookups;
for-loop steps also execute after break/return, as in the current interpreter.
This retains the canonical gas policy rather than implementing the alternative
policy proposed in criterion 10.

Validation through root `make build_common` and the real SM runtime:

- **60,555 varying-budget comparisons match**, covering 55 cases at budgets
  0–1100, including constructors, inherited/library/internal/external calls,
  storage and memory indexing, aggregate aliases, increments, tuple assignments,
  modifiers, arithmetic, loops, and caught exhaustion. Comparisons include exact
  `TooMuchGas` values and messages, as well as success boundaries and returns.
- **127 existing comparisons match** returns, events, and action/storage diffs.
- All **150** cached Upquark source collections parse; all **56,951** function
  instances and all **2,681** whole-contract contexts still compile.

Receipt remaining-gas fields are currently zero in the interpreter too, so
receipt equality cannot establish metering equality; the varying-budget checks
provide that evidence. Full non-gas exception/trace parity remains separate.
An additional memory-struct literal field-write probe exposed a pre-existing
semantic difference: the interpreter rejects writes to its constant fields,
while the native representation allows them. It is outside the passing gas
suite and has not been changed to reproduce that behavior.

Clean Upquark runs, with no builds or tests running alongside the measured runs:

| Mode | Block at 300 s from block 1 | Block at 300 s including startup | Seconds from block 1 to 140000 |
|---|---:|---:|---:|
| Saved native binary without gas | 171782 | 161972 | 250.644 |
| Final native with canonical gas | 166253 | 155812 | 259.820 |
| Interpreted | 142568 | 130654 | 296.454 |

Gas adds **3.66% time** over unmetered native for the same prefix. Native with
gas uses **12.36% less time** than interpreted execution. The startup-inclusive
155812 is close to the user's 156000 observation, whose exact timing definition
is unknown. These are single-run comparisons; startup/P2P delay varies.

Both native runs require strict native execution and have **zero function
fallbacks, zero constructor fallbacks, zero rejected contracts, and zero
state-root mismatches**. The interpreted run also has zero state-root
mismatches. The saved baseline process executable and SHA256 were independently
checked through `/proc`, not just through PATH resolution. An earlier baseline
that overlapped builds is excluded; an earlier gas-enabled native run before
final alias/increment corrections is also excluded from the table.

The final native measured binary SHA256 is
`9199290624015774dd9472d67d01ae148a6823296d30d782e87f7e3cfe4d1a3c`.
The interpreted comparator predates the last native-only alias/increment
corrections; interpreted execution was unchanged by those corrections.

Each run used `strato-up`/`strato-down` and a fully cleared QA `mynode`.
All test services are down, QA state is removed, and original node state is
preserved. Changes remain uncommitted.

Artifacts under `/tmp/solid-vm-native-integration/`:
`real-gas/{validation-final.json,comparison.json,alias-off.log,alias-on.log,
census-final.log,build-aliases.log}`, and
`features-real-gas-{baseline-clean,native-final,interpreted}/` with metadata,
metrics, progress, lifecycle and VM logs. The baseline directory also contains
`process-binary.json` proving which executable ran.


## 2026-10-05 — Independent execution engine

Steps 1–4 now provide namespaced compiler/core modules, handwritten builtin
Actions, copied execution helpers, and independent transaction/deployment entry
points. `Blockchain.SolidVM` preserves the caller API. Production caller package
choices remain unchanged; a temporary package substitution built the native
VM-runner used for this test. There are no interpreter execution fallbacks or
runtime engine selectors.

The shared differential suite passed against both packages. All **128 return,
event, and action/storage comparisons match**, including Rewards, constructors,
external/delegate calls, rollback, and invalid interface return types. Of
**60,555 varying-budget gas comparisons**, **58,365 match exactly**. The remaining
**2,190** cover deliberately uncatchable gas exhaustion: the replacement aborts
the transaction instead of allowing Solidity catch blocks to resume execution.
Ordinary contract failures remain catchable; compiler and unexpected host
failures stop block execution. Error wording is not a compatibility requirement.

A clean full Upquark sync reached the live tip at **552,821**, including the
indexer. The tip timestamp was `2026-10-05T19:26:17Z`. No state-root mismatches
were observed. At **300 seconds including startup**, the VM reached **162,111**,
about **4.0% more blocks** than the user's 156,000 reference. Measured from block
1, the 300-second height was **170,571**. This is one run, not a repeated timing
study. No builds or correctness checks overlapped the performance window.

The measured native VM-runner SHA256 was
`eacb08673e9929601ad046161f854fbf83fbbb3961ff540be2281dc2a71e085f`.
The run used `strato-up`/`strato-down` with fresh QA state. All test services
stopped and QA `mynode` was removed. Helium was not tested or changed.

Artifacts: `/tmp/solid-vm-native-integration/features-independent-complete/`
contains the full VM/lifecycle logs, caught-up block, timing, and metadata;
`architecture-refactor/` contains the build logs and differential comparison.


## 2026-10-05 — Inspectable compiled Haskell

`solid-vm-source FILE [CONTRACT]` emits a Haskell module containing the compiled
action definitions and their captured values. Execution and inspection instantiate
one shared compiler body (`Compiler.inc`); action expressions are shared Haskell
quotations. Builtin selection shares `BuiltinActions.inc`. GHC interprets these
quotations when building STRATO. No Haskell compiler is invoked or shipped for
contract compilation or source inspection.

The execution instantiation uses the identity representation (`Code a = a`),
with inline identity annotation helpers. It stores no source graph and uses no
runtime backend dictionaries. The inspection instantiation builds a graph only
on request. Its renderer preserves shared captures, supplies GADT types, and
includes the actual referenced function and constructor variants. Source is
verbose and depends on the package's existing action helpers rather than
expanding those helpers into every function body.

Generated PriceOracle and Rewards modules both pass development GHC typechecking.
A generated example containing a constructor, public getter, internal calls,
loop, and event executes with returns `[10,12,5,10]`, gas 104, and the expected
Updated event. All 60,683 native GAS/CHECK records remain byte-identical to the
pre-change native suite; the 128 interpreter return/event/action comparisons
also match. The execution compiler has no runtime references to inspection modules;
the stripped VM binary contains no inspection module or selector strings. These GHC checks and microbenchmarks are temporary development tools,
not installed runtime compilation services.

An isolated 10,000-compilation PriceOracle benchmark measured the original at
0.504–0.509 seconds and the final executable compiler at 0.502–0.503 seconds.
Allocations were approximately 3.132 GB versus 3.132 GB (slightly lower for the
new compiler), showing no added construction allocation in this workload.
Moving loop/comparison helpers out of local scope initially changed execution
optimization. Explicit INLINE pragmas restored the loop benchmark's allocation
to exactly the original count. Direct execution timings still differed by a
few percent in some trials; zero execution overhead is not established.

A clean full Upquark replay caught the live tip at **554,318**, including the
indexer, with **zero state-root mismatches**. Its tip timestamp is recorded in
the caught-up-block artifact. That run preceded the final two INLINE pragmas;
subsequent clean 300-second runs checked the final binary without mismatches.
An earlier full replay was interrupted by an external Docker package upgrade
restarting Docker; no STRATO shutdown or restart handling was changed.

All heights below are measured from the VM log timestamp of block 1:

| Run | Original native | Inspectable compiler, final INLINE adjustment |
| --- | ---: | ---: |
| First fresh pair | 166,187 | 163,793 |
| Reverse-order repeat | 164,499 | 163,832 |

The averages are 165,343 versus 163,812.5: **0.93% fewer blocks** for the new
compiler. The repeat pair differs by **0.41%**. The historical original reference
was 170,571, so today's baseline is also below that measurement. Earlier new
compiler runs ranged from 159,109 to 170,420. These measurements exclude a large
regression but do not demonstrate an exactly zero performance cost. No build or
correctness benchmark overlapped a measured 300-second window.

The final tested native binary SHA256 is
`6d7474f7f25e363f8ba4d693f1808d5cbcd25f83a63dc5585c198ab9151ab55c`.
Tests used only strato-up/strato-down with fully cleared QA state. The temporary
VM-runner package substitution was restored after testing. No changes were
committed, and Helium was not tested or changed.

Artifacts: `/tmp/solid-vm-source-work/` contains emitted Haskell, development
execution/typechecking logs, construction/runtime microbenchmarks, and build
logs. `/tmp/solid-vm-native-integration/features-haskell-source-complete/` contains
the full replay; `features-haskell-source-{baseline,inline}-{paired,repeat}/`
contains the fresh timing comparisons and their binaries' recorded hashes.


## 2026-10-05 — Recovering optimization scope for inspectable actions

The complete source-inspection implementation before this experiment is saved
in `/tmp/solid-vm-source-local-helpers/source-feature-before.tar.gz`. Inspection
remains available; no commits were made.

The optimized GHC Core identified a concrete execution difference. The previous
source-capable compiler retained two calls to the top-level `loop` factory in
its statement compiler despite the INLINE pragma. The original compiler did
not retain these calls. Those calls partially applied a four-argument helper,
leaving the environment argument for action execution. Moving the shared helper
bodies into local action bindings removed the calls from the optimized factory
code. This supports helper placement as the source of the slowdown; it does
not prove that loop placement alone accounts for every timing difference.

`HelperActions.inc` now holds the single definitions of comparison, decimal
rounding, bounds checking, typed function application, loops, and argument
snapshotting. Build-time quotations insert the relevant definitions locally
in both execution and inspection. The generated module therefore shows the
same local definitions. Source rendering now separates equations of local
functions when printing explicit-brace lets; TH's default printing otherwise
omitted the necessary equation separators.

In four direct loop-execution comparisons, the original averaged **0.771867 s**
and the local-helper compiler **0.766172 s** (about **0.74% faster**). The measured
execution allocation was slightly lower, not higher. PriceOracle compilation
remained approximately **0.515 s per 10,000 compilations** for both versions;
the new version again allocated slightly less. These are small workloads and
are evidence about the affected code, not a universal performance guarantee.

A fresh clean Upquark run reached **166,499 at 300 seconds from block 1**, with
zero state-root mismatches. The previous source-capable binary reached
163,793 and 163,832; fresh original-native runs reached 166,187 and 164,499.
The local-helper result is **1.64% above** the previous source-capable average
and is slightly above both fresh original-native measurements. This follow-up replay stopped after the measurement window;
the preceding full replay already reached live block 554,318.

All **60,683 GAS/CHECK records** still exactly match the pre-change native
suite. Generated PriceOracle and Rewards Haskell typecheck, and the generated
example still returns `[10,12,5,10]`, charges gas 104, and emits Updated(value10).
The tested native VM-runner SHA256 is
`bdcfe7c4136b3d202cde0db3abf9e07cac4a35c9a0e6d4c27020a0eef77f34d8`.

Artifacts: `/tmp/solid-vm-source-local-helpers/` contains before/after/original
optimized Core, the shared-code backup, emitted modules, typechecking and
execution checks, microbenchmarks, and build logs. The sync artifacts are under
`/tmp/solid-vm-native-integration/features-haskell-source-local-helpers/`.
Caller package choices were restored afterward, QA services stopped, and fresh
QA state was removed. No other optimizations or shutdown changes were made.
