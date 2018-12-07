{-# LANGUAGE OverloadedStrings #-}
module Blockchain.Sequencer.DB.DependentTxDB where

import           Blockchain.Format
import           Blockchain.SHA

import           Control.Lens           ((%~), (%=))
import           Control.Monad          (mapM_)
import           Control.Monad.IO.Class
import           Data.Foldable          (traverse_)
import           Data.Set               (Set)
import qualified Data.Set               as S
import           Prometheus

import           Blockchain.Sequencer.DB.PrivateHashDB
import           Blockchain.Sequencer.DB.Metrics

insertDependentTx :: HasRegistry m => SHA -> SHA -> m ()
insertDependentTx bHash tHash = do
  liftIO $ withLabel txMetrics "dependent_tx" incCounter
  modifyBlockHashEntryState_ bHash $ dependentTXs %= S.insert tHash

insertDependentTxs :: HasRegistry m => SHA -> Set SHA -> m ()
insertDependentTxs bHash tHashes = do
  liftIO $ withLabel txMetrics "dependent_tx" (flip unsafeAddCounter . fromIntegral . S.size $ tHashes)
  repsertBlockHashEntry_ bHash $ \entry -> do
    case entry of
      Nothing -> error $ "insertDependentTXs: Block hash " ++ format bHash ++ " not found"
      Just b -> return $ (dependentTXs %~ S.union tHashes) b

lookupDependentTxs :: HasRegistry m => SHA -> m (Maybe (Set SHA))
lookupDependentTxs bHash = fmap _dependentTXs <$> getBlockHashEntry bHash

clearDependentTxs :: HasRegistry m => SHA -> m ()
clearDependentTxs bHash = do
  liftIO $ withLabel txMetrics "dependent_tx_removed" incCounter
  traverse_ (mapM_ removeTransaction . _dependentTXs) =<< getBlockHashEntry bHash
