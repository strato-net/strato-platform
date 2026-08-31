-- | Sizing of the VM's in-process read caches from a single memory budget.
--
-- The caches (accounts, contract storage, MP nodes, hash preimages, compiled
-- code) exist for throughput — catch-up went 21→39 blocks/s with them — but
-- each needs an entry bound or a from-genesis sync grows without limit
-- (strato-net/private#96). The per-cache limits below reproduce, at the
-- default 1024MB budget, the entry caps the throughput work was benchmarked
-- with, and scale linearly for smaller machines. strato-setup picks the
-- budget by RAM tier when it writes commands.txt (Blockchain.Init.RtsFlags).
module Blockchain.VMCacheBudget
  ( applyVmCacheBudget,
  )
where

import Blockchain.DB.MemAddressStateDB (setAccountReadCacheLimit)
import Blockchain.DB.RawStorageDB (setStorageReadCacheLimit)
import Blockchain.SolidVM.CodeCollectionDB (setCodeCacheLimit)
import Blockchain.VMContext (setHashCacheLimit, setMpNodeCacheLimit)
import Blockchain.VMOptions (flags_vmCacheBudgetMB)

-- | Resize every VM read cache from @--vmCacheBudgetMB@. Must run after
-- @initHFlags@ and before the Context is created (initContext /
-- initReplayContext), which is when the Context-held caches take their size.
--
-- Rough per-entry heap costs behind the split, at the 1024MB default:
-- storage reads ~0.45KB × 500K ≈ 225MB, MP nodes ~0.7KB × 200K ≈ 140MB,
-- hash preimages ~0.25KB × 500K ≈ 125MB, accounts ~0.4KB × 100K ≈ 40MB,
-- code collections ~2MB × 128 ≈ 256MB.
applyVmCacheBudget :: IO ()
applyVmCacheBudget = do
  let budget = flags_vmCacheBudgetMB
      scaled floor' base = max floor' (base * budget `div` 1024)
  setAccountReadCacheLimit $ scaled 4096 100000
  setStorageReadCacheLimit $ scaled 16384 500000
  setMpNodeCacheLimit $ scaled 8192 200000
  setHashCacheLimit $ scaled 16384 500000
  -- Evicting a code collection forces a full re-parse and re-typecheck, so
  -- the floor stays well above the hot set (DEC1DE, USDST, voucher, oracles).
  setCodeCacheLimit $ scaled 32 128
