# Documentation Link Fixes

## Issues Resolved

### 1. Planning Documents
**Problem:** Internal planning docs appearing in build warnings
**Fix:** Moved to `.archive/` folder
- DEEP_DIVE_PLAN.md
- DOCUMENTATION_FRAMEWORK.md
- EXAMPLE_DUAL_LAYER_SUPPLY_COLLATERAL.md
- RESTRUCTURE_SUMMARY.md
- STREAMLINED_APPROACH.md

### 2. Renamed File References
**Problem:** 6 files referencing old `emergency-exit.md` filename
**Fix:** Updated all references to `withdrawals.md`
- capital-efficiency.md
- first-time-user.md
- leverage-long.md
- maximize-yield.md
- multi-asset-strategy.md
- risk-hedging.md

### 3. FAQ Anchor Links
**Problem:** Links using `#swaps--liquidity` (double dash)
**Fix:** Updated to `#swaps-liquidity` (single dash, MkDocs standard)
- guides/swap.md
- guides/liquidity.md

### 4. Missing Developer E2E Guide
**Problem:** Multiple files linking to non-existent `developer/e2e.md`
**Fix:** Created placeholder file at `developers/e2e.md`

### 5. Incorrect API Reference Link
**Problem:** FAQ linking to non-existent `api-overview.md`
**Fix:** Updated to correct `api.md`

## Result

All MkDocs build warnings resolved. Documentation should now build cleanly.
