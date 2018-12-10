{-# LANGUAGE OverloadedStrings #-}
module Blockchain.Sequencer.DB.MissingTxDB where

import           Blockchain.SHA

import           Control.Monad.IO.Class
import           Data.Maybe
import           Prometheus

import           Blockchain.Sequencer.DB.PrivateHashDB
import           Blockchain.Sequencer.DB.Metrics

isMissingTX :: HasPrivateHashDB m => SHA -> m Bool
isMissingTX tHash = maybe False (isNothing . _outputTx) <$> getTxHashEntry tHash

insertMissingTx :: HasPrivateHashDB m => SHA -> m ()
insertMissingTx tHash = do
  liftIO $ withLabel txMetrics "missing_tx" incCounter
  alterTxHashEntry_ tHash $
    return . Just . fromMaybe emptyTxHashEntry

removeMissingTx :: HasPrivateHashDB m => SHA -> m ()
removeMissingTx tHash = do
  liftIO $ withLabel txMetrics "missing_tx_removed" incCounter
  removeMissingTxEntry tHash
