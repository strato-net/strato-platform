{-# LANGUAGE OverloadedStrings #-}
module Blockchain.Sequencer.DB.SeenHashDB where


import           Control.Monad.Catch
import           Control.Monad.IO.Class
import           Data.Set                   (Set)
import qualified Data.Set                   as S
import           Prometheus

import           Blockchain.Sequencer.DB.PrivateHashDB
import           Blockchain.Sequencer.DB.Metrics
import           Blockchain.SHA

getSeenHashDB :: HasPrivateHashDB m => m (Set SHA)
getSeenHashDB = seenTXs <$> getPrivateHashDB

putSeenHashDB :: HasPrivateHashDB m => Set SHA -> m ()
putSeenHashDB bm = getPrivateHashDB >>= \db -> putPrivateHashDB db{ seenTXs = bm }

lookupSeenTxHash :: (HasPrivateHashDB m, MonadThrow m) => SHA -> m Bool
lookupSeenTxHash th = do
  db <- getSeenHashDB
  return $ th `S.member` db

insertSeenTxHash :: HasPrivateHashDB m => SHA -> m ()
insertSeenTxHash th = do
  liftIO $ withLabel txMetrics "seen_tx_hash" incCounter
  getSeenHashDB >>= putSeenHashDB . S.insert th
