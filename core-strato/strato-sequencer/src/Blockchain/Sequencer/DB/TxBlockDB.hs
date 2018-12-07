{-# LANGUAGE OverloadedStrings #-}
module Blockchain.Sequencer.DB.TxBlockDB where

import           Blockchain.SHA

import           Control.Lens           ((.~),(.=))
import           Control.Monad          (join)
import           Control.Monad.IO.Class
import           Prometheus

import           Blockchain.Sequencer.DB.PrivateHashDB
import           Blockchain.Sequencer.DB.Metrics

lookupTxBlocks :: HasRegistry m => SHA -> m (Maybe SHA)
lookupTxBlocks tHash = join . fmap _inBlock <$> getTxHashEntry tHash

insertTxBlock :: HasRegistry m => SHA -> SHA -> m ()
insertTxBlock tHash bHash = do
  liftIO $ withLabel txMetrics "tx_blocks" incCounter
  let bh = Just bHash
  repsertTxHashEntry_ tHash $ return . maybe (TxHashEntry Nothing bh) (inBlock .~ bh)

removeTxBlock :: HasRegistry m => SHA -> m ()
removeTxBlock tHash = do
  liftIO $ withLabel txMetrics "tx_blocks_removed" incCounter
  modifyTxHashEntryState_ tHash $ inBlock .= Nothing
