{-# LANGUAGE NumericUnderscores #-}
{-# LANGUAGE ScopedTypeVariables #-}

-- | Sizing of GHC RTS flags for the two heap-heavy STRATO processes
-- (vm-runner and strato-sequencer) based on the machine the node runs on.
--
-- Why these flags exist at all (from the 2026-08-26 from-genesis sync
-- investigation, strato-net/private#94): the vm-runner mutator is serial —
-- one busy OS thread regardless of @-N@ — so extra capabilities buy parallel
-- GC only, while @-A@ is per capability (total nursery = N×A) and there is no
-- @-M@ cap, so small-RAM machines die by OOM-killer during catch-up instead of
-- degrading gracefully.
--
-- What actually matters (measured, 2026-08-28 A/B: five vm-runner variants,
-- eight full from-genesis upquark syncs on a 4-core/32GB box; data in
-- replay/results/2026-08-28-rts-flag-ab.md): the capability count and the TOTAL
-- nursery pool size (N×A). Halving the pool cost +8%…+35%; the GC trimmings
-- previously emitted here (@-n@ chunking, @-qg1@, @-qn@) showed no measurable
-- effect either way against a ~4.5% same-variant noise floor, so they are
-- gone. Sizing is therefore pool-first: pick a total pool by RAM tier, divide
-- by N.
--
-- Sizing runs once, at strato-setup time, when commands.txt is generated.
-- Resizing a node (moving it to a different machine, changing its container
-- limits) requires re-running strato-setup or editing commands.txt by hand.
module Blockchain.Init.RtsFlags
  ( MachineResources (..),
    detectMachineResources,
    vmRunnerRtsFlags,
    vmCacheBudgetMB,
    sequencerRtsFlags,
    renderRtsFlags,
    describeMachineResources,
    smallestRamTierMB,

    -- * Exported for tests (the Linux code paths can't run on a dev Mac)
    parseCgroupCpuMax,
    parseCgroupMemoryMax,
    parseMemInfoMB,
  )
  where

import Control.Exception (SomeException, try)
import Control.Monad (guard)
import Data.Char (isDigit)
import Data.Maybe (listToMaybe)
import GHC.Conc (getNumProcessors)
import System.Info (os)
import System.Process (readProcess)
import Text.Read (readMaybe)

-- | Effective resources the node's processes will actually get, with the
-- source of each number so the decision can be logged for support.
data MachineResources = MachineResources
  { mrCores :: Int,
    mrCoresSource :: String,
    mrMemMB :: Integer,
    mrMemSource :: String
  }
  deriving (Show, Eq)

describeMachineResources :: MachineResources -> String
describeMachineResources mr =
  show (mrCores mr) ++ " cores (" ++ mrCoresSource mr ++ "), "
    ++ show (mrMemMB mr) ++ " MB RAM (" ++ mrMemSource mr ++ ")"

-- | Detect effective cores and RAM. Container limits must win over host
-- totals: a dockerized deploy otherwise sizes its heaps against the host, so
-- cgroup v2 @cpu.max@ / @memory.max@ are consulted first and the lower of
-- (cgroup limit, host total) is used.
detectMachineResources :: IO MachineResources
detectMachineResources = do
  hostCores <- getNumProcessors
  cgCores <- readCgroupCpuMax
  hostMem <- detectHostMemMB
  cgMem <- readCgroupMemoryMax
  let (cores, coresSource) = case cgCores of
        Just c | c < hostCores -> (c, "cgroup cpu.max")
        _ -> (hostCores, "host")
      (memMB, memSource) = case (cgMem, hostMem) of
        (Just c, Just h) | c < h -> (c, "cgroup memory.max")
        (_, Just h) -> (h, if os == "darwin" then "sysctl hw.memsize" else "/proc/meminfo")
        (Just c, Nothing) -> (c, "cgroup memory.max")
        (Nothing, Nothing) ->
          -- Detection failed (unexpected on Linux and macOS). Fall back to
          -- sizing as a large machine: that reproduces today's fixed flags
          -- and, crucially, does not apply a heap cap computed from a bogus
          -- number.
          (fallbackMemMB, "detection failed, assuming >16GB")
  return $ MachineResources cores coresSource (max 1 memMB) memSource

fallbackMemMB :: Integer
fallbackMemMB = 32 * 1024

-- | cgroup v2 cpu.max: "<quota> <period>" or "max <period>" (no limit).
-- Effective cores = ceil(quota / period).
readCgroupCpuMax :: IO (Maybe Int)
readCgroupCpuMax =
  (parseCgroupCpuMax =<<) <$> tryReadFile "/sys/fs/cgroup/cpu.max"

parseCgroupCpuMax :: String -> Maybe Int
parseCgroupCpuMax contents = do
  [quotaS, periodS] <- Just (words contents)
  quota <- readMaybe quotaS :: Maybe Integer
  period <- readMaybe periodS :: Maybe Integer
  guard (period > 0 && quota > 0)
  return . fromIntegral $ (quota + period - 1) `div` period

-- | cgroup v2 memory.max: byte count or "max" (no limit).
readCgroupMemoryMax :: IO (Maybe Integer)
readCgroupMemoryMax =
  (parseCgroupMemoryMax =<<) <$> tryReadFile "/sys/fs/cgroup/memory.max"

parseCgroupMemoryMax :: String -> Maybe Integer
parseCgroupMemoryMax contents = do
  bytes <- readMaybe (filter (/= '\n') contents)
  guard (bytes > 0)
  return (bytes `div` (1024 * 1024))

parseMemInfoMB :: String -> Maybe Integer
parseMemInfoMB contents = do
  memTotalLine <- listToMaybe . filter (("MemTotal:" ==) . take 9) $ lines contents
  kb <- readMaybe . filter isDigit $ drop 9 memTotalLine
  guard (kb > 0)
  return (kb `div` 1024)

detectHostMemMB :: IO (Maybe Integer)
detectHostMemMB
  | os == "darwin" = do
      result <- try (readProcess "sysctl" ["-n", "hw.memsize"] "")
      return $ case result of
        Left (_ :: SomeException) -> Nothing
        Right out -> (`div` (1024 * 1024)) <$> readMaybe (filter isDigit out)
  | otherwise =
      (parseMemInfoMB =<<) <$> tryReadFile "/proc/meminfo"

tryReadFile :: FilePath -> IO (Maybe String)
tryReadFile path = do
  result <- try (readFile path)
  return $ case result of
    Left (_ :: SomeException) -> Nothing
    Right contents -> Just contents

-- | RAM tier below which from-genesis catch-up cannot fit at any flag setting
-- (vm-runner live data alone is ~3.5GB); such nodes must sync from a snapshot.
smallestRamTierMB :: Integer
smallestRamTierMB = 4 * 1024

-- | Total vm-runner nursery pool (MB) by RAM tier; per-capability @-A@ is
-- pool/N. The pool size is what the 2026-08-28 A/B showed matters: halving it
-- cost +8%…+35% sync time. Budget: pool + the sequencer's half-pool ≈ 2–3% of
-- RAM. The boundaries are nominal machine sizes — real machines report
-- slightly less than nominal (a "16GB" box shows ~15.6GB), so they land in
-- their intended tier.
vmNurseryPoolMB :: Integer -> Integer
vmNurseryPoolMB memMB
  | memMB <= 4 * 1024 = 64
  | memMB <= 8 * 1024 = 128
  | memMB <= 16 * 1024 = 256
  | otherwise = 512

-- | Budget (MB) for the vm-runner's in-process read caches
-- (@--vmCacheBudgetMB@, see Blockchain.VMCacheBudget), by RAM tier. 1024
-- reproduces the entry caps the 2026-08 throughput work was benchmarked
-- with; smaller tiers shrink the caches so catch-up fits under the @-M@
-- heap cap below, trading LevelDB re-reads for memory.
vmCacheBudgetMB :: Integer -> Integer
vmCacheBudgetMB memMB
  | memMB <= 4 * 1024 = 128
  | memMB <= 8 * 1024 = 256
  | memMB <= 16 * 1024 = 512
  | otherwise = 1024

-- | Heap cap for the vm-runner on small-RAM machines: @-M@ at 60% of RAM
-- converts an OOM-kill into bounded behavior (the RTS auto-enables compacting
-- GC when live data reaches ~30% of the cap), and @-F1.5@ roughly doubles
-- major-GC frequency (~2–5% throughput) to keep the peak lower. On >16GB
-- machines these must NOT be applied — the throughput cost buys nothing there.
heapCapFlags :: Integer -> [String]
heapCapFlags memMB
  | memMB <= 16 * 1024 = ["-F1.5", "-M" ++ show ((memMB * 6) `div` 10) ++ "m"]
  | otherwise = []

-- | vm-runner: @-N4 -A⟨pool/4⟩@ was the fastest measured config on the
-- 4-core reference box (2,972s vs 3,114–3,201s for -N2 at the same pool).
-- Cap @-N@ at 4 — the mutator is serial, so more capabilities only add
-- GC-sync cost (revisit when parallel tx execution lands). The ≤3-core rules
-- are PREDICTIONS, not measurements: they anchor on the A/B's @-N1 -A256m@
-- result (whole pool in one capability, within 6.6% of the best, beating -N2
-- at the same pool) — on a 2-core box one capability avoids GC-sync cost and
-- pool splitting, and leaves the other core to the sequencer/p2p/postgres.
-- @-I2@ (idle GC) is kept from the previous fixed flags, @-T@ powers the
-- metrics export.
vmRunnerRtsFlags :: Int -> Integer -> [String]
vmRunnerRtsFlags cores memMB =
  ["-T", "-N" ++ show n, "-A" ++ show (pool `div` fromIntegral n) ++ "m", "-I2"]
    ++ heapCapFlags memMB
  where
    n :: Int
    n | cores >= 4 = 4
      | cores == 3 = 2
      | otherwise = 1
    pool = vmNurseryPoolMB memMB

-- | strato-sequencer: serial event loop with a multi-GB catch-up heap, same
-- shape as the vm-runner but never A/B'd — every rule here is a PREDICTION by
-- analogy to the vm-runner measurements. Two capabilities halve major-GC
-- pauses on machines with cores to spare; on small boxes keep it at one so it
-- doesn't fight the vm-runner's GC. Total pool = half the vm-runner's, @-A@ =
-- pool/N (preserves the previous values on big machines). @-I2@ is new and
-- unmeasured: at the chain head the sequencer idles between blocks, and the
-- RTS default 0.3s idle GC can fire repeated major GCs over its ~2.4GB
-- post-catch-up residual heap; 2s matches the vm-runner's cadence. No @-M@
-- cap here, for two reasons: its catch-up peak is the look-ahead cache, which
-- flags don't control, and that ~2.4GB residual retention (known open issue)
-- means a cap would risk HeapOverflow aborts until it is fixed.
sequencerRtsFlags :: Int -> Integer -> [String]
sequencerRtsFlags cores memMB =
  ["-T", "-N" ++ show n, "-A" ++ show (pool `div` fromIntegral n) ++ "m", "-I2"]
  where
    n :: Int
    n = if cores >= 4 then 2 else 1
    pool = vmNurseryPoolMB memMB `div` 2

renderRtsFlags :: [String] -> String
renderRtsFlags flags = unwords (["+RTS"] ++ flags ++ ["-RTS"])
