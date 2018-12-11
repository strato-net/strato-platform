{-# LANGUAGE OverloadedStrings #-}
module Blockchain.Sequencer.DB.MissingChainDB where

import           Blockchain.ExtWord           (Word256)
import           Blockchain.SHA

import           Control.Lens
import           Control.Monad                (mapM_)
import           Control.Monad.IO.Class
import           Data.Foldable                (traverse_)
import qualified Data.Set                     as S
import           Prometheus

import           Blockchain.Sequencer.DB.PrivateHashDB
import           Blockchain.Sequencer.DB.Metrics

lookupMissingChainTxs :: HasPrivateHashDB m => Word256 -> m [SHA]
lookupMissingChainTxs chainId = maybe [] (S.toList . _missingTXs) <$> getChainIdEntry chainId

insertMissingChainTx :: HasPrivateHashDB m => Word256 -> SHA -> m ()
insertMissingChainTx chainId th = do
  liftIO $ withLabel chainMetrics "missing_chain_tx" incCounter
  modifyChainIdEntryState_ chainId $ missingTXs %= S.insert th

insertMissingChainTxs :: HasPrivateHashDB m => Word256 -> [SHA] -> m ()
insertMissingChainTxs chainId ths = do
  liftIO $ withLabel chainMetrics "missing_chain_tx" (flip unsafeAddCounter . fromIntegral . length $ ths)
  modifyChainIdEntryState_ chainId $ missingTXs .= S.fromList ths

clearMissingChainTxs :: HasPrivateHashDB m => Word256 -> m ()
clearMissingChainTxs chainId = do
  liftIO $ withLabel chainMetrics "missing_chain_tx_removed" incCounter
  traverse_ (mapM_ removeTransaction . _missingTXs) =<< getChainIdEntry chainId
