Foundry tests for CDP fee routing, bad debt, and juniors

Prerequisites
- Foundry installed (forge/cast): https://book.getfoundry.sh/
- solc 0.8.24 supported by your Foundry toolchain.

Project layout used by these tests
- Curated Solidity sources live under `.foundry-preprocessed/` and are consumed directly by Foundry:
  - `cdp/` contains `CDPEngine`, `CDPRegistry`, `CDPReserve` with Cirrus `record` removed.
  - `compat/` provides minimal stubs: `Token`, `TokenFactory`, `CDPVault`, `FeeCollector`, `PriceOracle`, `Ownable`.
- Tests live here: `mercata/contracts/tests-foundry/`.

Required foundry.toml settings
- Ensure remappings and compiler flags exist in `foundry.toml` at repo root:

```
[profile.default]
solc = "0.8.24"
via_ir = true
optimizer = true
optimizer_runs = 200

remappings = [
  "cdp/=./.foundry-preprocessed/cdp/",
  "compat/=./.foundry-preprocessed/compat/",
]

src = "mercata/contracts/tests-foundry"
test = "mercata/contracts/tests-foundry"
```

How to run
- Deterministic junior/dust-clearing test (verbose):

```
forge test -vvv --match-test test_junior_pro_rata_and_return_model | cat
```

- Short invariant session (fee split, bad debt, juniors):

```
forge test -vv --match-contract CDP_FeeReserve_Invariants --fuzz-runs 500 | cat
```

What was done to make Foundry work
- We run against curated preprocessed sources in `.foundry-preprocessed/` to avoid regenerating from the higher-level DSL. This includes removing the `record` keyword and wiring minimal `compat/` contracts for token/vault/oracle/collector.
- Foundry is configured via remappings to import from those directories and compiled with `solc 0.8.24` and `via_ir`.

Deterministic test notes (dust clearing)
- `CDP_JuniorProRata_Test` creates an undercollateralized position, liquidates, and then performs iterative follow-up liquidations to remove any residual collateral dust. The loop uses:
  - A high oracle price to maximize coverage for general dust.
  - A tuned last-wei price `price = (10000 + penaltyBps) * unitScale` when exactly 1 unit of collateral remains.
  - Caps the repay by total debt, close-factor, and coverage, refreshing state each iteration.

Invariants covered
- Reserve/collector fee split conservation on repay.
- Liquidation books safety: total scaled debt non-increasing; bad debt only realized when collateral hits zero.
- Juniors: payments are capped by note caps; claim bounded by reserve balance; plugging bad debt never increases it.

Examples (expected output snippets)
- Deterministic test: a passing run ends with a single PASS line and tiny debug logs, e.g.:

```
[PASS] test_junior_pro_rata_and_return_model()
```

Tips
- Control fuzzing: `--fuzz-runs N`, `--fuzz-seed <seed>`.
- Increase verbosity with `-vvv` for rich traces; pipe through `| cat` to disable pager.


