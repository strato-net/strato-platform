{-# LANGUAGE OverloadedStrings #-}
module Blockchain.VMMetrics where

import Control.Monad.IO.Class
import Data.Int
import qualified Data.Map.Strict as M
import qualified Data.Text as T
import qualified Data.Set as S
import Prometheus

import Blockchain.Bagger.BaggerState

vmBlocksProcessed :: Counter
vmBlocksProcessed = unsafeRegister $ counter (Info "vm_blocks_processed" "evm counter for blocks processed")

vmBlocksMined:: Counter
vmBlocksMined = unsafeRegister $ counter (Info "vm_blocks_mined" "evm counter for blocks mined")

vmBlocksUnmined :: Counter
vmBlocksUnmined = unsafeRegister $ counter (Info "vm_blocks_unmined" "evm counter for blocks unmined")

vmBlocksValid :: Counter
vmBlocksValid = unsafeRegister $ counter (Info "vm_blocks_valid" "evm counter for blocks valid")

vmBlocksInvalid :: Counter
vmBlocksInvalid = unsafeRegister $ counter (Info "vm_blocks_invalid" "evm counter for blocks invalid")

vmTxsSuccessful :: Counter
vmTxsSuccessful = unsafeRegister $ counter (Info "vm_txs_successful" "evm counter for txs successful")

vmTxsUnsuccessful :: Counter
vmTxsUnsuccessful = unsafeRegister $ counter (Info "vm_txs_unsuccessful" "evm counter for txs unsuccessful")

vmTxsProcessed :: Counter
vmTxsProcessed = unsafeRegister $ counter (Info "vm_txs_processed" "evm counter for txs processed")

vmTxsCall :: Counter
vmTxsCall = unsafeRegister $ counter (Info "vm_txs_call" "evm counter for txs call")

vmTxsCreation :: Counter
vmTxsCreation = unsafeRegister $ counter (Info "vm_txs_creation" "evm counter for txs creation")

vmBlockInsertionMined :: Gauge
vmBlockInsertionMined = unsafeRegister $ gauge (Info "vm_block_insertion_mined" "evm gauge for block insertion mined")

vmTxMined :: Gauge
vmTxMined= unsafeRegister $ gauge (Info "vm_tx_mined" "evm gauge for tx mined")

vmTxMining :: Gauge
vmTxMining = unsafeRegister $ gauge (Info "vm_tx_mining" "evm gauge for transaction mining")

opTiming :: Vector T.Text Summary
opTiming = unsafeRegister
         . vector "operation_constructor"
         . flip summary defaultQuantiles
         $ Info "opcode_timing" "Measured duration in ns for different opcodes"


recordOpTiming :: (MonadIO m) => T.Text -> Int64 -> m ()
--recordOpTiming :: (MonadIO m) => Operation -> Int64 -> m ()
recordOpTiming op t = liftIO $
  withLabel opTiming op (flip observe (fromIntegral t))

vmBaggerTxs:: Vector T.Text Gauge
vmBaggerTxs = unsafeRegister
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
