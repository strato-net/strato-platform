# svmc — first working version of the strict SolidVM → Haskell-action compiler

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
