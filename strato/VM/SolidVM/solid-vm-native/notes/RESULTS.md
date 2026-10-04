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
