{-# LANGUAGE OverloadedStrings #-}
module Blockchain.Sequencer.DB.PrivateTxDB where

import           Blockchain.SHA
import           Control.Lens           ((.~))
import           Control.Monad          (join)
import           Control.Monad.IO.Class
import           Prometheus

import           Blockchain.Sequencer.DB.ChainHashDB
import           Blockchain.Sequencer.DB.Metrics
import           Blockchain.Sequencer.DB.PrivateHashDB
import           Blockchain.Sequencer.Event
import           Blockchain.Strato.Model.Class

lookupTransaction :: HasRegistry m => SHA -> m (Maybe OutputTx)
lookupTransaction tHash = join . fmap _outputTx <$> getTxHashEntry tHash

insertTransaction :: HasRegistry m => OutputTx -> m ()
insertTransaction tx = do
  let tHash = txHash tx
      otx = Just tx
  repsertTxHashEntry_ tHash $ return . maybe (TxHashEntry otx Nothing) (outputTx .~ otx)

insertPrivateHash :: HasRegistry m => OutputTx -> m ()
insertPrivateHash tx = case txChainId tx of
  Nothing -> error "insertPrivateHash: Trying to insert a public transaction"
  Just chainId -> do
    liftIO $ withLabel txMetrics "private_hash" incCounter
    cHashes <- generateChainHashes tx
    mapM_ (flip insertChainHash chainId) cHashes
    mapM_ (insertChainBufferEntry chainId) cHashes
