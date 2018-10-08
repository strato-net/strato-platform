
module Blockchain.Sequencer.DB.MissingChainDB where

import           Blockchain.ExtWord           (Word256)
import           Blockchain.SHA

import           Control.Monad
import           Control.Monad.IO.Class
import           Data.Map.Strict              (Map)
import qualified Data.Map.Strict              as M
import           Data.Maybe                   (fromMaybe)
import           Prometheus

import           Blockchain.Sequencer.DB.PrivateHashDB
import           Blockchain.Sequencer.DB.Metrics

getMissingChainsDB :: HasPrivateHashDB m => m (Map Word256 [SHA])
getMissingChainsDB = missingChainDB <$> getPrivateHashDB

putMissingChainsDB :: HasPrivateHashDB m => Map Word256 [SHA] -> m ()
putMissingChainsDB m = getPrivateHashDB >>= \db -> putPrivateHashDB db{ missingChainDB = m }

lookupMissingChainTxs :: HasPrivateHashDB m => Word256 -> m [SHA]
lookupMissingChainTxs chainId = fromMaybe [] . M.lookup chainId <$> getMissingChainsDB

insertMissingChainTx :: HasPrivateHashDB m => Word256 -> SHA -> m ()
insertMissingChainTx chainId th = do
  liftIO $ withLabel "missing_chain_tx" incCounter chainMetrics
  m <- getMissingChainsDB
  case M.lookup chainId m of
    Nothing -> putMissingChainsDB (M.insert chainId [th] m)
    Just ths -> putMissingChainsDB (M.insert chainId (th:ths) m)

insertMissingChainTxs :: HasPrivateHashDB m => Word256 -> [SHA] -> m ()
insertMissingChainTxs chainId ths = do
  let num = fromIntegral . length $ ths
  liftIO $ withLabel "missing_chain_tx" (void . addCounter num) chainMetrics
  getMissingChainsDB >>= putMissingChainsDB . M.insert chainId ths

clearMissingChainTxs :: HasPrivateHashDB m => Word256 -> m ()
clearMissingChainTxs chainId = do
  liftIO $ withLabel "missing_chain_tx_removed" incCounter chainMetrics
  getMissingChainsDB >>= putMissingChainsDB . M.delete chainId
