{-# LANGUAGE OverloadedStrings #-}

module Blockchain.VMMetrics where

import Blockchain.Bagger.BaggerState
import Control.Monad
import Control.Monad.IO.Class
import Data.Int
import qualified Data.Map.Strict as M
import qualified Data.Set as S
import qualified Data.Text as T
import Prometheus

{-# NOINLINE vmBlocksProcessed #-}
vmBlocksProcessed :: Counter
vmBlocksProcessed = unsafeRegister $ counter (Info "vm_blocks_processed" "evm counter for blocks processed")

{-# NOINLINE vmBlocksMined #-}
vmBlocksMined :: Counter
vmBlocksMined = unsafeRegister $ counter (Info "vm_blocks_mined" "evm counter for blocks mined")

{-# NOINLINE vmBlocksUnmined #-}
vmBlocksUnmined :: Counter
vmBlocksUnmined = unsafeRegister $ counter (Info "vm_blocks_unmined" "evm counter for blocks unmined")

{-# NOINLINE vmBlocksValid #-}
vmBlocksValid :: Counter
vmBlocksValid = unsafeRegister $ counter (Info "vm_blocks_valid" "evm counter for blocks valid")

{-# NOINLINE vmBlocksInvalid #-}
vmBlocksInvalid :: Counter
vmBlocksInvalid = unsafeRegister $ counter (Info "vm_blocks_invalid" "evm counter for blocks invalid")

{-# NOINLINE vmTxsSuccessful #-}
vmTxsSuccessful :: Counter
vmTxsSuccessful = unsafeRegister $ counter (Info "vm_txs_successful" "evm counter for txs successful")

{-# NOINLINE vmTxsUnsuccessful #-}
vmTxsUnsuccessful :: Counter
vmTxsUnsuccessful = unsafeRegister $ counter (Info "vm_txs_unsuccessful" "evm counter for txs unsuccessful")

{-# NOINLINE vmTxsProcessed #-}
vmTxsProcessed :: Counter
vmTxsProcessed = unsafeRegister $ counter (Info "vm_txs_processed" "evm counter for txs processed")

{-# NOINLINE vmTxsCall #-}
vmTxsCall :: Counter
vmTxsCall = unsafeRegister $ counter (Info "vm_txs_call" "evm counter for txs call")

{-# NOINLINE vmTxsCreation #-}
vmTxsCreation :: Counter
vmTxsCreation = unsafeRegister $ counter (Info "vm_txs_creation" "evm counter for txs creation")

{-# NOINLINE vmBlockInsertionMined #-}
vmBlockInsertionMined :: Gauge
vmBlockInsertionMined = unsafeRegister $ gauge (Info "vm_block_insertion_mined" "evm gauge for block insertion mined")

{-# NOINLINE vmTxMined #-}
vmTxMined :: Gauge
vmTxMined = unsafeRegister $ gauge (Info "vm_tx_mined" "evm gauge for tx mined")

{-# NOINLINE vmTxMining #-}
vmTxMining :: Gauge
vmTxMining = unsafeRegister $ gauge (Info "vm_tx_mining" "evm gauge for transaction mining")

{-# NOINLINE opTiming #-}
opTiming :: Vector T.Text Summary
opTiming =
  unsafeRegister
    . vector "operation_constructor"
    . flip summary defaultQuantiles
    $ Info "opcode_timing" "Measured duration in ns for different opcodes"

recordOpTiming :: (MonadIO m) => T.Text -> Int64 -> m ()
--recordOpTiming :: (MonadIO m) => Operation -> Int64 -> m ()
recordOpTiming op t =
  liftIO $
    withLabel opTiming op (flip observe (fromIntegral t))

{-# NOINLINE vmBaggerTxs #-}
vmBaggerTxs :: Vector T.Text Gauge
vmBaggerTxs =
  unsafeRegister
    . vector "group"
    . gauge
    $ Info "vm_bagger_txs" "Count of pending transactions in bagger"

recordBaggerMetrics :: (MonadIO m) => BaggerState -> m ()
recordBaggerMetrics bs = liftIO $ do
  let atlVolume :: (BaggerState -> ATL) -> Double
      atlVolume sel = fromIntegral . sum . map M.size . M.elems . sel $ bs
  withLabel vmBaggerTxs "pending" $ \g -> setGauge g (atlVolume pending)
  withLabel vmBaggerTxs "queued" $ \g -> setGauge g (atlVolume queued)
  withLabel vmBaggerTxs "seen" $ \g -> setGauge g . fromIntegral . S.size . seen $ bs

{-# NOINLINE numTxrsFlushed #-}
numTxrsFlushed :: Counter
numTxrsFlushed =
  unsafeRegister
    . counter
    $ Info "vm_txrs_flushed" "Number of transaction results flushed"

{-# NOINLINE txrQueueLength #-}
txrQueueLength :: Gauge
txrQueueLength =
  unsafeRegister
    . gauge
    $ Info "vm_txr_queue_length" "Number of queued transactions"

recordTxrFlush :: MonadIO m => Int -> m ()
recordTxrFlush n = liftIO $ do
  void $ addCounter numTxrsFlushed $ fromIntegral n
  setGauge txrQueueLength 0

recordTxrEnqueue :: MonadIO m => Int -> m ()
recordTxrEnqueue = liftIO . addGauge txrQueueLength . fromIntegral

{-# NOINLINE seqEventCount #-}
seqEventCount :: Vector T.Text Counter
seqEventCount =
  unsafeRegister
    . vector "event"
    . counter
    $ Info "vm_seqevents_count" "Count of seqevents read"

recordSeqEventCount :: MonadIO m => Int -> Int -> m ()
recordSeqEventCount bLen tLen = liftIO $ do
  withLabel seqEventCount "block" $ void . flip addCounter (fromIntegral bLen)
  withLabel seqEventCount "tx" $ void . flip addCounter (fromIntegral tLen)
