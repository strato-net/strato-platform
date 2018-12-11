{-# LANGUAGE OverloadedStrings #-}
module Blockchain.Sequencer.DB.SeenChainDB where

import           Blockchain.Data.ChainInfo
import           Blockchain.ExtWord           (Word256)

import           Control.Monad.IO.Class
import           Data.Maybe                   (isJust)
import           Prometheus

import           Blockchain.Sequencer.DB.Metrics
import           Blockchain.Sequencer.DB.PrivateHashDB

lookupSeenChain :: HasPrivateHashDB m => Word256 -> m Bool
lookupSeenChain = fmap isJust . getChainIdEntry

insertSeenChain :: HasPrivateHashDB m => Word256 -> ChainInfo -> m ()
insertSeenChain chainId cInfo = do
  liftIO $ withLabel chainMetrics "seen_chains" incCounter
  insertChainIdEntry chainId $ chainIdEntry cInfo
