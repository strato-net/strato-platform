{-# LANGUAGE OverloadedStrings #-}
module Blockchain.Sequencer.DB.MissingTxDB where

import           Blockchain.SHA

import           Control.Monad.IO.Class
import           Data.Maybe
import           Prometheus

import           Blockchain.Sequencer.DB.PrivateHashDB
import           Blockchain.Sequencer.DB.Metrics

isMissingTX :: HasRegistry m => SHA -> m Bool
isMissingTX tHash = maybe False (isNothing . _outputTx) <$> getTxHashEntry tHash

insertMissingTx :: HasRegistry m => SHA -> m ()
insertMissingTx tHash = do
  liftIO $ withLabel txMetrics "missing_tx" incCounter
  alterTxHashEntry_ tHash $
    return . Just . fromMaybe emptyTxHashEntry

removeMissingTx :: HasRegistry m => SHA -> m ()
removeMissingTx tHash = do
  liftIO $ withLabel txMetrics "missing_tx_removed" incCounter
  removeMissingTxEntry tHash
