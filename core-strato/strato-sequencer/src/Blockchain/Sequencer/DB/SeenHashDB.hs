{-# LANGUAGE OverloadedStrings #-}
module Blockchain.Sequencer.DB.SeenHashDB where


import           Control.Monad.Catch
import           Control.Monad.IO.Class
import           Data.Maybe             (isJust)
import           Prometheus

import           Blockchain.Sequencer.DB.PrivateHashDB
import           Blockchain.Sequencer.DB.Metrics
import           Blockchain.SHA

lookupSeenTxHash :: (HasRegistry m, MonadThrow m) => SHA -> m Bool
lookupSeenTxHash tHash = isJust <$> getTxHashEntry tHash

insertSeenTxHash :: HasRegistry m => SHA -> m ()
insertSeenTxHash tHash = do
  liftIO $ withLabel txMetrics "seen_tx_hash" incCounter
  insertTxHashEntry tHash emptyTxHashEntry
