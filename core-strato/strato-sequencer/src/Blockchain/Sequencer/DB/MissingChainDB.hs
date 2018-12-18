{-# LANGUAGE LambdaCase        #-}
{-# LANGUAGE OverloadedStrings #-}

module Blockchain.Sequencer.DB.MissingChainDB where

import           Blockchain.ExtWord           (Word256)
import           Blockchain.SHA

import           Control.Lens
import           Control.Monad.IO.Class
import qualified Data.Set                     as S
import           Prometheus

import           Blockchain.Sequencer.DB.PrivateHashDB
import           Blockchain.Sequencer.DB.Metrics

lookupMissingChainTxs :: HasPrivateHashDB m => Word256 -> m [SHA]
lookupMissingChainTxs chainId = maybe [] (S.toList . _missingTXs) <$> getChainIdEntry chainId

insertMissingChainTx :: HasPrivateHashDB m => Word256 -> SHA -> m ()
insertMissingChainTx chainId th = insertMissingChainTxs chainId [th]

insertMissingChainTxs :: HasPrivateHashDB m => Word256 -> [SHA] -> m ()
insertMissingChainTxs chainId ths = do
  liftIO $ withLabel chainMetrics "missing_chain_tx" (flip unsafeAddCounter . fromIntegral . length $ ths)
  repsertChainIdEntry_ chainId $ \case
    Nothing -> return . chainIdEntryWithMissingTXs $ S.fromList ths
    Just cie -> return $ (missingTXs %~ S.union (S.fromList ths)) cie

clearMissingChainTxs :: HasPrivateHashDB m => Word256 -> m ()
clearMissingChainTxs chainId = do
  liftIO $ withLabel chainMetrics "missing_chain_tx_removed" incCounter
  modifyChainIdEntryState_ chainId $ missingTXs .= S.empty
