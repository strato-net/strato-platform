{-# LANGUAGE OverloadedStrings #-}
module Blockchain.Sequencer.DB.TxBlockDB where

import           Blockchain.SHA

import           Control.Monad.IO.Class
import           Data.Map.Strict              (Map)
import qualified Data.Map.Strict              as M
import           Prometheus

import           Blockchain.Sequencer.DB.PrivateHashDB
import           Blockchain.Sequencer.DB.Metrics

getTxBlockDB :: HasPrivateHashDB m => m (Map SHA SHA)
getTxBlockDB = txBlockDB <$> getPrivateHashDB

putTxBlockDB :: HasPrivateHashDB m => Map SHA SHA -> m ()
putTxBlockDB m = getPrivateHashDB >>= \db -> putPrivateHashDB db{ txBlockDB = m }

lookupTxBlocks :: HasPrivateHashDB m => SHA -> m (Maybe SHA)
lookupTxBlocks tHash = M.lookup tHash <$> getTxBlockDB

insertTxBlock :: HasPrivateHashDB m => SHA -> SHA -> m ()
insertTxBlock tHash bHash = do
  liftIO $ withLabel txMetrics "tx_blocks" incCounter
  getTxBlockDB >>= putTxBlockDB . M.insert tHash bHash

removeTxBlock :: HasPrivateHashDB m => SHA -> m ()
removeTxBlock tHash = do
  liftIO $ withLabel txMetrics "tx_blocks_removed" incCounter
  getTxBlockDB >>= putTxBlockDB . M.delete tHash
