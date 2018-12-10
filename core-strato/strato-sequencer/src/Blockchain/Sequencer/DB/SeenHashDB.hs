{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE OverloadedStrings #-}

module Blockchain.Sequencer.DB.SeenHashDB where


import           Control.Lens           ((.~))
import           Control.Monad
import           Control.Monad.Catch
import           Control.Monad.IO.Class
import           Prometheus

import           Blockchain.Sequencer.DB.PrivateHashDB
import           Blockchain.Sequencer.DB.Metrics
import           Blockchain.SHA

lookupSeenTxHash :: (HasPrivateHashDB m, MonadThrow m) => SHA -> m (Maybe SHA)
lookupSeenTxHash tHash = join . fmap _chainHash <$> getTxHashEntry tHash

insertSeenTxHash :: HasPrivateHashDB m => SHA -> SHA -> m ()
insertSeenTxHash tHash cHash = do
  liftIO $ withLabel txMetrics "seen_tx_hash" incCounter
  repsertTxHashEntry_ tHash $ \case
    Nothing -> return $ txHashEntryWithChainHash cHash
    Just the -> return $ (chainHash .~ Just cHash) the
