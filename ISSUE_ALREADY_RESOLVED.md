# Issue #5963 - Already Resolved

## Summary
Issue #5963 "Hide sUSDST-USDST swap pool" has already been resolved and merged to the develop branch.

## Resolution Details

**Resolved By:** Commit 33ddc4cef1 "hotfix to hide sUSDST-USDST swap pool"
**Merged Via:** PR #5974 (blockapps/fix/5963-hide-swap-pool)
**Date:** January 3, 2026

## Implementation

The fix was implemented at the **backend level** by filtering out the problematic pool from all API responses:

### Files Changed
1. **mercata/backend/src/config/config.ts**
   - Added `hiddenSwapPools` Set containing the sUSDST-USDST pool address
   - Pool address: `9c75280f9e2368005d2b7342f19c59f9176b5962`

2. **mercata/backend/src/api/services/swapping.service.ts**
   - Updated `getPools()` to filter out hidden pools (line 70-72)
   - Updated `getSwapableTokens()` to filter out pools with hidden addresses
   - Updated `getSwapableTokenPairs()` to filter out hidden pools in both directions

### Coverage
The filtering is applied to ALL swap-related endpoints:
- ✅ `/swap-pools` - List all pools (SwapPoolsSection.tsx)
- ✅ `/swap-pools/:poolAddress` - Get single pool
- ✅ `/swap-pools/tokens` - Get swappable tokens (SwapWidget.tsx)
- ✅ `/swap-pools/tokens/:tokenAddress` - Get pairable tokens (SwapWidget.tsx)
- ✅ `/swap-pools/positions` - Get user liquidity positions
- ✅ `/swap-pools/:tokenAddress1/:tokenAddress2` - Get pool by token pair

## Why Backend Filtering is Sufficient

The issue requested a "UI fix" but the backend implementation is actually superior because:

1. **Single Source of Truth**: All data flows through the backend API, so filtering once at the backend ensures consistency
2. **No Bypass Possible**: UI-side filtering could be bypassed by direct API calls; backend filtering cannot
3. **Comprehensive Coverage**: The backend filter applies to ALL endpoints automatically
4. **Maintainability**: Centralized filtering logic is easier to maintain than scattered UI filters

## UI Data Flow Analysis

1. **Swap Page** (SwapAsset.tsx):
   - Uses SwapWidget component
   - SwapWidget uses `fetchPairableTokens()` from SwapContext
   - SwapContext calls `/swap-pools/tokens/:tokenAddress` API
   - ✅ Hidden pool is filtered at backend

2. **Liquidity/Deposit Page** (SwapPoolsSection.tsx):
   - Uses `fetchPools()` from SwapContext
   - SwapContext calls `/swap-pools` API
   - ✅ Hidden pool is filtered at backend

3. **Pool Selection in SwapWidget**:
   - Uses `fetchSwappableTokens()` and `fetchPairableTokens()`
   - Both call backend APIs that filter hidden pools
   - ✅ Hidden pool never appears in token selection dropdowns

## Current State

- The sUSDST-USDST pool is successfully hidden from ALL UI pages
- No additional UI changes are needed
- The fix is production-ready and already deployed to develop branch

## Recommendation

**Close issue #5963** as it has been fully resolved by PR #5974.

The backend filtering solution is comprehensive, secure, and addresses both requirements from the issue:
1. ✅ Hidden from swap page
2. ✅ Hidden from swap deposit liquidity page
