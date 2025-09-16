# Mercata Lending — Foundry Tests

This directory contains concrete Lending contracts and a Foundry-based test suite for:
- Bad-debt lifecycle (recognition and cover)
- Reserve sweeping and fee routing
- SafetyModule staking, slashing (cover), and repayments to stakers via sweeps
- Liquidity operations (deposit/withdraw/borrow) with bad debt present

## Prerequisites
- Foundry (forge/anvil): https://book.getfoundry.sh/

Install/update:
```
curl -L https://foundry.paradigm.xyz | bash
foundryup
```

## Quick start
From repo root:
```
FOUNDRY_PROFILE=default forge test -vvv --match-path mercata/contracts/tests-foundry/*
```

Run a specific test:
```
# Exchange rate drops when bad debt is written off (simulated)
FOUNDRY_PROFILE=default forge test -vvv --match-test test_exchangeRate_drops_on_writeoff_simulated | cat

# No interest accrues on recognized bad debt (but accrues on active loans)
FOUNDRY_PROFILE=default forge test -vvv --match-test test_badDebt_no_interest_accrual | cat

# Sweep reserves: split to SafetyModule and FeeCollector, bounded by cash & reserves
FOUNDRY_PROFILE=default forge test -vvv --match-test test_sweepReserves_split_and_bounds | cat

# SafetyModule: stake→cover (rate falls)→accrue+sweep (rate rises)
FOUNDRY_PROFILE=default forge test -vvv --match-test test_safetyModule_rate_increases_after_sweep_post_cover | cat
```

## Notable behaviors covered
- LendingPool.getExchangeRate(): `cash + debt + badDebt − reserves` per mToken supply.
- Recognizing bad debt does not immediately lower exchange rate. Removing badDebt without cash inflow does.
- Reserves accrue only on active debt via borrow index; sweeps transfer reserves to FeeCollector and SafetyModule according to `safetyShareBps` and bounded by `reservesAccrued` and LP cash.
- SafetyModule "yield" arrives only via sweeps; cover reduces SM assets (rate down), sweeps increase assets (rate up).

## Permissions tested
- Only PoolConfigurator can: `setBorrowableAsset`, `setMToken`, `configureAsset`, `setSafetyShareBps`, `sweepReserves`.
- Only SafetyModule can call `pool.coverShortfall`.

## Notes
- Tests use the concrete contracts from `.foundry-prepared/lending` with minimal compatibility scaffolding for fast execution.
- Some tests simulate share accounting where needed to avoid pulling unrelated systems.
