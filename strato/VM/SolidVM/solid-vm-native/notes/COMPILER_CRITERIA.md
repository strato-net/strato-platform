# SolidVM → Haskell-action compiler: acceptance criteria (draft, 2026-10-03)

Criteria 1–5, 8, 12 and 21 are the user's; direction on strictness, gas and storage is the user's (2026-10-03 23:10). The rest are proposed from today's discussion and the fee-path experiment; each is marked
"proposed" until confirmed. A criterion should be something a test or a code review can check.

## Typing

1. A compiled SolidVM function is a Haskell action with the function's exact type signature.
   `transfer(address to, uint256 value) returns (bool)` compiles to a value of type `Address -> Integer -> SM Bool`.
   (The wrapper that hands it to a caller that only learns the type at link time — `Dynamic`-style — is the only
   place the type is not static, and the caller resolves it once, not per call.)

2. Every variable and value has a definite Haskell type. `int x` in SolidVM becomes `x :: Integer` (or whatever the
   agreed representation of that SolidVM type is); no `Value`-style sum type is used for locals, parameters,
   intermediates or return values inside compiled code.

3. All type mismatches are found at compile time (when the node compiles the code hash), never while a transaction
   runs. `int x = "abcd";` is a compile error. Typing is strict in the way Haskell is strict; SolidVM's lenient
   behaviours are compromises, not a spec, and are NOT imitated. Where the interpreter did something odd, do what a
   type-strict language would do, even if not backwards compatible; report the resulting problems before any
   compatibility hack is considered.

4. Everything external to the function is typed too: storage variables, mappings and structs, other contracts'
   public values and functions. `mapping(address => uint256) _balances` reads as `Integer`, `ERC20(usdst).transfer`
   is an `Address -> Integer -> SM Bool`; the declared types are known at compile time and used.

5. Storage keeps its current on-disk format (tagged `BasicValue`) for reading and writing, but the tag is never used
   for decisions: values are decoded and used according to the type known at compile time.

6. (proposed) The only dynamically typed points are the ones dynamic in the problem itself: parsing a transaction's
   text arguments against the signature at entry, and `variadic`. Everything between those edges is statically typed.

7. (proposed) No runtime type inspection in generated code: no pattern matching on a value's type tag, no string
   matching on operator or function names, no name→slot lookups. Those are all resolved when the code hash is
   compiled.

8. The unit of compilation is the full code collection, not a function: contracts with inheritance, constructors,
   storage layout, modifiers, events, `super`, fallback. A compiled contract is a typed record of its storage
   layout (every state variable, including inherited ones, as a typed slot/mapping/struct/array) and its functions;
   the layout is what lets the VM, the API and the indexer decode storage by type (criterion 5). One compiled collection serves every account with that code hash, with the storage address supplied by the call
   context (so `delegatecall`/Proxy work as today).

## Semantics and consensus

9. (proposed) Correctness during development is measured differentially against the interpreter on the full helium
   and upquark chains; the output is the divergence list of criterion 12, not a pass/fail.

10. (proposed) Gas follows one sensible rule chosen for the compiled VM (not a copy of the interpreter's per-expression
    decrements); differences in receipts after helium block 250,000 are reported and decided on.

11. (proposed) Events, action data (Cirrus) and return values are identical to the interpreter's, not just the state
   root. (The hand-written fee path skipped action data; a compiler may not.)

12. Divergence from deployed behaviour is reported, not reproduced: every contract that fails strict typechecking and
    every transaction whose compiled result differs from the interpreter's is listed with the reason. Backwards-
    compatibility hacks are considered only after that list exists, one case at a time.

13. (proposed) Compilation is deterministic: same source, same compiler version → same behaviour on every node.

## Architecture

14. (proposed) No GHC at runtime. The compiler is Haskell code that produces typed Haskell values; the node image does
    not change.

15. (proposed) Compile once per code hash, cached alongside the existing parsed-code cache; compile cost is amortised
    over all calls to that code.

16. (proposed) Compiled code drives the existing VM runtime (`SM`: storage, gas, events, exceptions, call frames)
    through a small typed API (`readUInt`, `writeAddr`, `call`, `emit`, `require`, ...). The storage layer and trie
    are unchanged.

17. (proposed) Per-function fallback to the interpreter for unsupported constructs during development, with a
    hit/miss counter, so coverage can grow incrementally and every stage is measurable.

18. (proposed) No contract-specific Haskell anywhere: the compiler is generic over SolidVM source. The hand-written
    `FeeFastPath.hs` is a benchmark, not a component.

## Milestones

M1. Strict typecheck census: run the typechecker over every code hash deployed on upquark and helium; report how many
    contracts fail and why. No runtime integration needed.
M2. Compiled fee chain: Decider, DeciderState, Proxy, Voucher, Token compiled generically (no hand-written contract
    code) and run as the fee path in a full upquark sync; compare with the hand-written 1150 s and the interpreter's
    1360.6 s; list divergences.

## Performance

19. (proposed) First milestone: the compiled fee chain (Decider, DeciderState, Proxy, Voucher, Token) reproduces the
    hand-written native result — full upquark sync 1360.6 s → ~1150 s, `stateRootMismatch=0` — with no hand-written
    contract code.

20. (proposed) Measured on the agreed metrics only: full upquark sync time from vm-runner log timestamps (block #1 →
    fixed target block), and the 300 s helium replay metric; derived numbers labelled as such.

## Simplicity

21. Keep it simple: no extra complexity beyond what the criteria above require. (Deliberately vague; the user will
    point out violations as they appear.)

## Open questions (not criteria yet)

- Representation of each SolidVM type (uint256 as `Integer` with range checks, or `Word256` with wrap?), strings
  (`Text` vs `ByteString`), decimals, enums, structs, mappings/arrays as typed storage references.
- How `super`, modifiers, inheritance and the "current contract" (affects event contract names) are represented.
- `variadic` / Proxy `fallback` design.
- What SolidVM's type system actually is (the typechecker is the bulk of the research).
