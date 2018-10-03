
module Blockchain.Sequencer.DB.MissingTxDB where

import           Blockchain.SHA

import           Control.Monad.IO.Class
import qualified Data.Set                     as S
import           Prometheus

import           Blockchain.Sequencer.DB.PrivateHashDB
import           Blockchain.Sequencer.DB.Metrics

getMissingTxsDB :: HasPrivateHashDB m => m (S.Set SHA)
getMissingTxsDB = missingTxs <$> getPrivateHashDB

putMissingTxsDB :: HasPrivateHashDB m => S.Set SHA -> m ()
putMissingTxsDB txs = getPrivateHashDB >>= \db -> putPrivateHashDB db{ missingTxs = txs }

isMissingTX :: HasPrivateHashDB m => SHA -> m Bool
isMissingTX tx = S.member tx <$> getMissingTxsDB

insertMissingTx :: HasPrivateHashDB m => SHA -> m ()
insertMissingTx tx = do
  liftIO $ withLabel "missing_tx" incCounter txMetrics
  getMissingTxsDB >>= putMissingTxsDB . S.insert tx

removeMissingTx :: HasPrivateHashDB m => SHA -> m ()
removeMissingTx tx = do
  liftIO $ withLabel "missing_tx_removed" incCounter txMetrics
  getMissingTxsDB >>= putMissingTxsDB . S.delete tx
