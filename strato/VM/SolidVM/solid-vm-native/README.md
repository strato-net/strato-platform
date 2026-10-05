# SolidVM Native

SolidVM Native is an experimental typed execution backend for SolidVM.

It is not a new parser or a separate source language. It reuses STRATO's
existing SolidVM frontend:

```
SolidVM source
  -> solid-vm-compiler / solid-vm-parser
  -> solid-vm-model CodeCollection
  -> SolidVM Native compiler
  -> typed Haskell actions
  -> runtime adapter
```

The long-term goal is to execute SolidVM contracts without repeatedly walking
the AST and inspecting `Value` constructors at runtime. Source contracts and
Haskell programs written with the SolidVM DSL remain SolidVM programs; this
package is a new execution engine for them.

This is a standalone experimental prototype. An uncommitted integration connects
it to `vm-runner` behind `SOLIDVM_NATIVE=1`.

## Repository location and dependencies

The package lives at:

```
strato/VM/SolidVM/solid-vm-native
```

It is registered in `strato/stack.yaml` and uses the local versions of:

- `solid-vm-compiler`
- `solid-vm-model`
- `solid-vm-parser` (indirectly through the compiler frontend)
- `source-tools`
- `strato-model`

Before it became a package, the source lived under `/tmp/vmqa/svmc`. It was
compiled by changing into an existing STRATO Stack project and passing the
temporary directory to GHC. The prototype was therefore never independently
buildable without STRATO, even though the resulting `svmc` executable was
standalone.

## Package layout

### `src/Core.hs`

The typed runtime foundation:

- `Ty t` describes the Haskell representation of each SolidVM type.
- `Fields` and `HL` represent typed structs and tuples.
- `Env` and `Ix` provide typed mutable local variables using de Bruijn
  indices and `IORef`s.
- `Sig args r`, `Fn args r`, and `Fun` represent functions with exact
  signatures.
- `SType` describes storage layouts, including mappings, arrays, and structs.
- `fromBasic` and `toBasic` bridge typed values to the existing
  `BasicValue` storage format.
- `RT` is the small runtime interface for storage, events, calls, block
  context, and timestamps.
- `Frame` contains `this`, code address, sender, origin, call name, arguments,
  and value.
- `Dyn` is restricted to genuinely dynamic boundaries such as transaction
  arguments, `variadic`, `msg.data`, and low-level call results.

Compiled function bodies do not use SolidVM's `Value` sum type.

### `src/Compile.hs`

The compiler and strict typechecker:

- Resolves types from the existing `CodeCollection`.
- Compiles contracts, storage definitions, functions, public getters, and
  constructors.
- Compiles expressions and statements into typed closures from `Core`.
- Resolves locals, storage paths, internal calls, external calls, modifiers,
  inheritance, `super`, library calls, and `using L for T`.
- Produces compile errors classified as `TypeError`, `Unsupported`, `Unknown`,
  or `Internal`.
- Keeps each function as `Either Err Fun` for diagnostics. The blockchain
  integration uses `compileContractChecked`, rejecting the entire contract if
  any storage declaration, function, constructor, initializer, or parent-argument
  expression fails compilation.

`compileCollection` is the main compiler entry point:

```haskell
compileCollection :: CodeCollection -> CompiledCollection
```

The integration, counters, profiling, and `solid-vm-native-check` described below
depend on uncommitted changes outside this package. They are not provided by
`solid-vm-native` alone.

The experimental blockchain integration is enabled with `SOLIDVM_NATIVE=1`
in the environment of `strato-up`. It defaults to the interpreter. Native
callbacks run in the existing `SM` state through `withRunInIO`, preserving the
storage database, call frames, action diffs, and event encoder. Compiled and
rejected contracts share a bounded 128-entry cache keyed by code hash, parser
fork mode, and contract name. Debugger/tracer calls, memory-reference calls,
and unsupported contract compilation use the interpreter. Runtime failures
are reported; execution is never retried through the interpreter after writes.

Set `SOLIDVM_NATIVE_STRICT=1` together with `SOLIDVM_NATIVE=1` to prohibit
interpreter fallback. Missing native functions or constructor stages stop
execution with an engine error, rather than turning an unsupported operation
into a failed transaction. Native deployment compiles storage initializers,
parent arguments, and constructor bodies; the existing runtime retains parent
ordering, default-value action diffs, and deployment bookkeeping. Parameter
changes carry across constructor stages.

`solidvm_native_events` exposes execution hits, constructor stages, fallbacks,
compiled contracts, and rejected contracts on the VM's Prometheus endpoint. Run
the `solid-vm-native-check` test suite in `solid-vm/tests/native/` with
`SOLIDVM_NATIVE=0` and `SOLIDVM_NATIVE=1` in separate processes to compare
returns, events, action diffs, nested calls, delegate calls, and rollback.
Build test suites from the repository root with `make build_common_with_tests`;
the test binary accepts `--network=upquark`.
Native expressions, statements, loops, internal calls, and arithmetic charge
through the existing STRATO gas meter. The compiler emits charges at the
interpreter's evaluation points; monadic bind itself has no gas charge.
The same `decrementGas` callback enforces exhaustion, and nested calls retain
`TooMuchGas` rather than converting it to a generic revert. Set
`SOLIDVM_NATIVE_GAS_CHECK=1` for varying-budget comparisons, including exact
out-of-gas errors. Full exception/trace parity remains unfinished.

See `notes/RESULTS.md` for the 2026-10-04 integration checks and live Upquark
comparison, including the limits of the measured speedup.

### `exec_src/Main.hs`

The prototype CLI and mock runtime:

- Loads raw source, a JSON source string, or a JSON list of source files.
- Calls the existing
  `compileSourceWithAnnotationsWithoutImports` frontend.
- Implements the contract census command.
- Implements an in-memory runtime with storage, events, nested calls,
  delegate calls, and rollback on `Revert`.
- Runs the end-to-end fee-chain demonstration.

The mock runtime is test scaffolding. It is not intended to become STRATO's
production runtime.

### `tools/Probe.hs`

A parser/AST inspection utility used while developing compiler support. It
prints the selected contract's storage declarations and the selected
function's arguments, return values, modifiers, overloads, and statement AST.

### `fixtures/`

Sources used by the fee-chain demonstration:

- `Decide.sol`
- `DeciderState.sol`
- `21137d33.json` (the deployed Mercata code collection)

### `notes/`

- `RESULTS.md`: prototype behavior, coverage census, and known gaps.
- `COMPILER_CRITERIA.md`: draft acceptance criteria and milestones.
- `VM_SPEEDUP_NOTES.md`: the wider sync-performance investigation that led
  to this compiler.

Some notes preserve their original `/tmp` paths for provenance. The package
directory is now the canonical location for the source.

## Building

Build from the repository root using the normal project build:

```bash
make
```

Do not use the old `/tmp/vmqa/svmc/build.sh`; it was only prototype
scaffolding.

Stack sees this package as `solid-vm-native` and builds:

- Library: `solid-vm-native`
- Executable: `svmc`
- Executable: `svmc-probe`

## Running the prototype tools

From `strato/`:

```bash
stack exec svmc -- census <source-directory>
stack exec svmc -- feechain VM/SolidVM/solid-vm-native/fixtures
stack exec svmc-probe -- <source-file> <contract-name> <function-name>
```

`census` compiles every source collection in a directory and reports function
successes and failures by reason. `WHOLE` rows report eligibility for the live
adapter, including its rejection of overloads with duplicate arities.

`feechain` compiles the fixture contracts and executes five fee decisions
against the mock runtime. The expected high-level trace is:

1. Decisions 1-3 burn one voucher each.
2. The sender's voucher balance moves from `3e18` to zero.
3. Voucher total supply moves from `10e18` to `7e18`.
4. Decisions 4-5 transfer `1e16` USDST each to the fee collector.
5. The sender's USDST balance moves from `5e16` to `3e16`.
6. The collector's USDST balance moves from zero to `2e16`.
7. All five calls return `True`.

## Current type and execution model

Examples of compiled representations:

```haskell
transfer(address,uint256) returns (bool)
  -> Address -> Integer -> M Bool
```

Local variables are typed `IORef`s. Function arguments and return values have
exact Haskell types. Storage reads are decoded according to the declared type,
with scalar assignment retaining the original storage tag for compatibility.
Copying an unset scalar delegates to STRATO's assignment path: its legacy
behavior can leave the destination value intact and write a `length` field.
This is an explicit exception to the storage-tag criterion in the draft specs.

Storage remains compatible with the existing layout:

- Scalars use the existing `BasicValue` encoding.
- Scalar writes preserve their `BasicValue` tags in action diffs; the storage
  backend normalizes zero/default values to `BDefault` on disk.
- Typed enum values retain whether a transaction supplied a numeric field or a
  named enum member, preserving storage and forwarded argument encoding.
- `msg.data` retains validated transaction representations, including nested
  numeric enum fields and variadic-tail argument packing.
- Arrays use a `length` field and indexed elements.
- Struct fields use `Field`.
- Mapping keys use the same encoding as the interpreter's `expToPath`.
- Storage pointers carry an `SType` layout and are checked when compiled.

The current execution monad is:

```haskell
type M = ReaderT (RT, Frame) IO
```

The uncommitted adapter uses `SM`'s existing `withRunInIO` bridge for these
callbacks, so storage, events, and nested calls use the existing VM state.

## Current language coverage

Implemented in the prototype:

- Integer, decimal, boolean, address, string, bytes, enum, and contract types
- Typed arrays, structs, tuples, and multiple/named returns
- Mappings, arrays, structs, and pointers in storage
- Declarations, assignment, arithmetic, comparisons, branches, and loops
- Destructuring
- Modifiers and `_`, including ownership modifiers forwarding a `variadic` result
- Native storage initialization, parent-constructor arguments, and constructor bodies
- Explicit base-constructor calls
- Ordinary and salted `new Contract(...)`, plus `create`/`create2`, through the live adapter
- Internal, external, low-level, delegate, library, and `super` calls
- `using L for T`
- Public storage getters
- Events
- SolidVM catch-all `try`/`catch` and Solidity-style `try f() returns (...) catch`
- `require`, `assert`, `revert`, and custom-error text
- Variadic-tail parameters and raw call results preserving scalar, tuple, and
  variadic return shapes
- Common explicit conversions, including address-to-string and radix/padded string formatting
- Implicit conversions between addresses and contracts (both use `Address`)
- `keccak256(bytes)`, SolidVM RLP hashing, `ecrecover`, ABI encoding, and address derivation
- `delete`, array `push`, and distinct prefix/postfix increment and decrement

Not implemented or incomplete:

- Contract creation in the standalone mock runtime
- Typed catch clauses
- Several cryptographic/system builtins
- The removed `getUserCert` lookup and byte payloads for low-level calls compile
  their existing runtime failure paths; they do not gain certificate lookup or
  EVM ABI dispatch
- `msg.data` snapshots parameters at call entry; subsequent parameter reassignment is not tracked
- Full exception and trace parity

See `notes/RESULTS.md` for the detailed list.

## Strict-type census

The original prototype was run over every distinct deployed code hash found
during the experiment:

| Network | Compiled function instances | Failed function instances |
|---|---:|---:|
| Upquark | 40,340 (71%) | 16,446 |
| Helium | 221,098 (70%) | 92,563 |

The current cached Upquark census has zero errors: **56,951 function instances**
and **2,681 whole-contract contexts** across 150 source collections compile,
including constructor initializers and parent arguments. A clean strict-native
replay reached live block **541,298** with zero fallbacks and zero state-root
mismatches. See `notes/RESULTS.md` for the verification scope and measurements.

Most failures are strict typing differences rather than fundamental compiler
limitations. The dominant deployed pattern is an implicit
`contract -> address` conversion in the common `onlyOwner` modifier. Other
frequent cases include returning a `variadic` result from a modifier declared
to return nothing and assigning low-level call results directly to typed
locals.

Do not silently add compatibility coercions. The intended process is:

1. Report the divergence.
2. Determine the desired SolidVM Native semantics.
3. Add an explicit compatibility rule only if it is deliberately approved.

The PriceOracle integration adds the contract-to-address and address-to-string
rules identified above. Its inherited ownership modifier can forward a
`variadic` voting result even from a function declared to return nothing.
The external boundary preserves that result; typed internal calls decode it
against the declared signature, with a runtime error if it does not fit.
This is an explicit compatibility exception to the original strict-return
criterion. Ordinary mismatches such as `uint x = "string"` still fail compilation.

## Known semantic questions and divergences

The following decisions remain provisional:

- All integer widths currently use unbounded `Integer`.
- Parser-produced `InlineBoundsCheck` nodes are enforced.
- `super` executes in the selected parent context, matching STRATO dispatch.
- Catch handles `Revert` and STRATO `SolidException`, including exhaustion;
  engine failures remain uncaught. Mock external calls restore storage and
  events on revert.
- STRATO supplies the canonical gas meter through `RT.rtChargeGas`. The
  standalone mock host supplies an unlimited no-op callback.
- Events use the contract context containing the executing body, including
  inherited `super` calls (`ERC20` versus `Token` in the fee path).

Consensus behavior must be checked before this engine executes production
blocks. State roots alone are not sufficient: receipts, gas, event/action
data, return values, and failure behavior also matter.

## Integration plan

The uncommitted integration provides generic dispatch, an `SM` runtime
adapter, and a bounded compiled-contract cache. The steps below preserve the
original production plan; strict whole-contract rejection currently leaves
parts of the fee chain on the interpreter.

### 1. Adapt the execution monad

Replace or parameterize `M = ReaderT (RT, Frame) IO` so compiled actions can
run inside the existing SolidVM `SM`/`ContextM` stack.

The production adapter should map:

- `rtGet` to the existing typed/storage lookup path, based on
  `getSolidStorageKeyVal'`
- `rtPut` to `putSolidStorageKeyVal'`
- `rtEmit` to the existing event/action machinery
- `rtCall` to the existing SolidVM call boundary
- `Frame` fields to the existing call environment
- block number and timestamp to the current VM environment

Avoid duplicating storage, rollback, gas, or call-frame state in a parallel
runtime.

### 2. Add a compiled collection cache

Compile once per code hash and cache the `CompiledCollection` beside the
existing parsed `CodeCollection` cache in `solid-vm-compiler`.

Requirements:

- Deterministic compilation
- One compiled collection shared by every account using the code hash
- Storage address supplied by the call frame, preserving proxy/delegate-call
  behavior
- Compiler version or fork behavior accounted for when cache validity matters

### 3. Add a production dispatch boundary

At a SolidVM call:

1. Obtain the parsed and compiled collection for the code hash.
2. Select the contract and `name/arity` entry.
3. Convert transaction text arguments once using the declared signature.
4. Run `callDyn` at the dynamic boundary.
5. Convert return values to the existing VM result format.
6. Fall back to the interpreter when the entire contract did not compile.

Track compiled hits, fallbacks, compilation failures, and runtime divergences.
The experimental live engine uses whole-contract fallback. The historical
function census therefore overstates the fraction eligible for native execution.

### 4. Integrate the fee path first

The first production milestone should be the generic compiled fee chain:

```
Decider.decide
  -> DeciderState.payFees
  -> Voucher burn, or
  -> USDST transfer
```

All functions reached by this path compile and already execute end to end in
the mock runtime. Hooking this narrow path into `payFees` provides a controlled
performance and consensus test before general dispatch is enabled.

Baseline full-upquark measurements from the earlier experiment:

- Existing interpreter: `1360.6 s`
- Hand-written native fee path: `1150.7 s`
- Difference: `-15.4%`

The compiled fee path should be compared against both using the same
block-1-to-target timestamp metric. The target is to reproduce the
hand-written result generically, without contract-specific Haskell.

### 5. Differential validation

For each milestone, run the interpreter and SolidVM Native over the same
helium and upquark inputs and compare:

- Success/revert result and error
- State root and storage writes
- Return values
- Gas and receipt fields
- Events and topics
- Action data consumed by Cirrus
- Nested-call and rollback behavior

Produce a divergence report rather than hiding differences. Any intentional
semantic change needs an explicit fork or compatibility decision.

### 6. Expand coverage

After the fee-path milestone:

1. Constructors and base constructors
2. Gas policy and receipt compatibility
3. Correct event/action attribution
4. Contract creation
5. Remaining call and catch semantics
6. Required builtins
7. Deliberately selected compatibility rules
8. General compiled dispatch with measured fallback coverage

## Working principles

- Keep SolidVM Native generic; never add contract-specific compiled code.
- Reuse the existing parser, model, storage, and VM runtime.
- Preserve the current on-disk storage format.
- Keep dynamic checks at external boundaries, not inside compiled functions.
- Treat strict type failures as useful findings, not errors to suppress.
- Report behavioral differences before adding compatibility behavior.
- Build through the repository's normal root `make`.
- Use clean-node lifecycle rules for live sync testing.
- Measure against the established replay and full-sync metrics.
