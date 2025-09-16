# Mercata Lending — Foundry Test Guide

This document explains how to run and interpret the Foundry-based tests for the Lending system.

## Prerequisites
- Foundry (forge/anvil): https://book.getfoundry.sh/

Install/update:
```
curl -L https://foundry.paradigm.xyz | bash
foundryup
```

## Run all Lending tests
From repo root:
```
FOUNDRY_PROFILE=default forge test -vvv --match-path mercata/contracts/tests-foundry/*
```

## Targeted scenarios
- Exchange rate write-off drop (LendingPool mToken):
```
FOUNDRY_PROFILE=default forge test -vvv --match-test test_exchangeRate_drops_on_writeoff_simulated | cat
```
- No interest accrues on recognized bad debt:
```
FOUNDRY_PROFILE=default forge test -vvv --match-test test_badDebt_no_interest_accrual | cat
```
- Reserves sweep split/bounds (safetyShareBps and cash/reserves caps):
```
FOUNDRY_PROFILE=default forge test -vvv --match-test test_sweepReserves_split_and_bounds | cat
```
- SafetyModule: stake → cover (rate down) → accrue+sweep (rate up):
```
FOUNDRY_PROFILE=default forge test -vvv --match-test test_safetyModule_rate_increases_after_sweep_post_cover | cat
```
- LP operations continue with bad debt present:
```
FOUNDRY_PROFILE=default forge test -vvv --match-test test_lp_operations_continue_with_badDebt | cat
```
- Permissioning (only configurator/SM allowed):
```
FOUNDRY_PROFILE=default forge test -vvv --match-test test_permissioning_enforced | cat
```

## Notes
- Tests use the concrete prepared contracts under `.foundry-prepared/lending` with minimal shims for speed.
- Logs print key state (borrow index, reserves, badDebt, LP cash, SM rate) at each step.
