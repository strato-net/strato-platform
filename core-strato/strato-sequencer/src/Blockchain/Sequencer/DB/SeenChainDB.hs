{-# LANGUAGE OverloadedStrings #-}
module Blockchain.Sequencer.DB.SeenChainDB where

import qualified Blockchain.Data.ChainInfo    as CI
import           Blockchain.ExtWord           (Word256)

import           Control.Lens                 ((.~))
import           Control.Monad.IO.Class
import           Data.Maybe                   (isJust)
import           Prometheus

import           Blockchain.Sequencer.DB.Metrics
import           Blockchain.Sequencer.DB.PrivateHashDB

lookupSeenChain :: HasPrivateHashDB m => Word256 -> m Bool
lookupSeenChain chainId = isJust <$> getChainIdEntry chainId

insertSeenChain :: HasPrivateHashDB m => Word256 -> CI.ChainInfo -> m ()
insertSeenChain chainId cInfo = do
  liftIO $ withLabel chainMetrics "seen_chains" incCounter
  repsertChainIdEntry_ chainId $ return . maybe (chainIdEntry cInfo) (chainInfo .~ cInfo)
