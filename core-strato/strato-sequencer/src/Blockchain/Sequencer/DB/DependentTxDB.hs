{-# LANGUAGE OverloadedStrings #-}
module Blockchain.Sequencer.DB.DependentTxDB where

import           Blockchain.ExtWord
import           Blockchain.Format
import           Blockchain.SHA

import           Control.Lens
import           Control.Monad          (join)
import           Control.Monad.IO.Class
import qualified Data.Map.Strict        as M
import           Data.Maybe             (fromMaybe)
import           Data.Set               (Set)
import qualified Data.Set               as S
import           Prometheus

import           Blockchain.Sequencer.DB.PrivateHashDB
import           Blockchain.Sequencer.DB.Metrics

insertDependentTx :: HasPrivateHashDB m => SHA -> Word256 -> SHA -> m ()
insertDependentTx bHash chainId tHash = do
  liftIO $ withLabel txMetrics "dependent_tx" incCounter
  modifyBlockHashEntryState_ bHash $
    dependentTXs %= M.alter (Just . maybe (S.singleton tHash) (S.insert tHash)) chainId

insertDependentTxs :: HasPrivateHashDB m => SHA -> Word256 -> Set SHA -> m ()
insertDependentTxs bHash chainId tHashes = do
  liftIO $ withLabel txMetrics "dependent_tx" (flip unsafeAddCounter . fromIntegral . S.size $ tHashes)
  repsertBlockHashEntry_ bHash $ \entry -> do
    case entry of
      Nothing -> error $ "insertDependentTXs: Block hash " ++ format bHash ++ " not found"
      Just b -> return $
        (dependentTXs %~ M.insert chainId tHashes) b

lookupDependentTxs :: HasPrivateHashDB m => SHA -> Word256 -> m (Set SHA)
lookupDependentTxs bHash chainId = do
  fromMaybe S.empty . join . fmap (M.lookup chainId . _dependentTXs) <$> getBlockHashEntry bHash

removeDependentTx :: HasPrivateHashDB m => SHA -> Word256 -> SHA -> m ()
removeDependentTx bHash chainId tHash = do
  liftIO $ withLabel txMetrics "dependent_tx" incCounter
  modifyBlockHashEntryState_ bHash $
    dependentTXs %= M.alter (fmap (S.delete tHash)) chainId

clearDependentTxs :: HasPrivateHashDB m => SHA -> Word256 -> m ()
clearDependentTxs bHash chainId = do
  liftIO $ withLabel txMetrics "dependent_tx_removed" incCounter
  modifyBlockHashEntryState_ bHash $
    dependentTXs %= M.delete chainId
