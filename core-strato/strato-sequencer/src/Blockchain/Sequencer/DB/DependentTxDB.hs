
module Blockchain.Sequencer.DB.DependentTxDB where

import           Blockchain.SHA

import           Control.Monad
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
  liftIO $ withLabel "dependent_tx" incCounter txMetrics
  m <- getDependentTxDB
  case M.lookup bHash m of
    Nothing -> putDependentTxDB (M.insert bHash (S.singleton tHash) m)
    Just ths -> putDependentTxDB (M.insert bHash (S.insert tHash ths) m)

insertDependentTxs :: HasPrivateHashDB m => SHA -> S.Set SHA -> m ()
insertDependentTxs bHash ths = do
  let num = fromIntegral . S.size $ ths
  liftIO $ withLabel "dependent_tx" (void . addCounter num) txMetrics
  getDependentTxDB >>= putDependentTxDB . M.insert bHash ths

clearDependentTxs :: HasPrivateHashDB m => SHA -> m ()
clearDependentTxs bHash = do
  liftIO $ withLabel "dependent_tx_removed" incCounter txMetrics
  getDependentTxDB >>= putDependentTxDB . M.delete bHash
