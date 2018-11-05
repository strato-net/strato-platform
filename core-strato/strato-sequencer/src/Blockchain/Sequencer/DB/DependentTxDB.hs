{-# LANGUAGE OverloadedStrings #-}
module Blockchain.Sequencer.DB.DependentTxDB where

import           Blockchain.SHA

import           Control.Monad.IO.Class
import           Data.Map.Strict              (Map)
import qualified Data.Map.Strict              as M
import           Data.Maybe                   (fromMaybe)
import qualified Data.Set                     as S
import           Prometheus

import           Blockchain.Sequencer.DB.PrivateHashDB
import           Blockchain.Sequencer.DB.Metrics

getDependentTxDB :: HasPrivateHashDB m => m (Map SHA (S.Set SHA))
getDependentTxDB = dependentTxDB <$> getPrivateHashDB

putDependentTxDB :: HasPrivateHashDB m => Map SHA (S.Set SHA) -> m ()
putDependentTxDB m = getPrivateHashDB >>= \db -> putPrivateHashDB db{ dependentTxDB = m }

lookupDependentTxs :: HasPrivateHashDB m => SHA -> m (S.Set SHA)
lookupDependentTxs bHash = fromMaybe S.empty . M.lookup bHash <$> getDependentTxDB

insertDependentTx :: HasPrivateHashDB m => SHA -> SHA -> m ()
insertDependentTx bHash tHash = do
  liftIO $ withLabel txMetrics "dependent_tx" incCounter
  m <- getDependentTxDB
  case M.lookup bHash m of
    Nothing -> putDependentTxDB (M.insert bHash (S.singleton tHash) m)
    Just ths -> putDependentTxDB (M.insert bHash (S.insert tHash ths) m)

insertDependentTxs :: HasPrivateHashDB m => SHA -> S.Set SHA -> m ()
insertDependentTxs bHash ths = do
  liftIO $ withLabel txMetrics "dependent_tx" (flip unsafeAddCounter . fromIntegral . S.size $ ths)
  getDependentTxDB >>= putDependentTxDB . M.insert bHash ths

clearDependentTxs :: HasPrivateHashDB m => SHA -> m ()
clearDependentTxs bHash = do
  liftIO $ withLabel txMetrics "dependent_tx_removed" incCounter
  getDependentTxDB >>= putDependentTxDB . M.delete bHash
